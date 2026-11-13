import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Job from '../models/Job.js';
import { extractAudio, extractFrames } from '../services/media.js';
import { transcribeAudio } from '../services/transcribe.js';
import { runOCR } from '../services/ocr.js';
import { extractClaims } from '../services/claims.js';
import { searchEvidence } from '../services/search.js';
import { rankSources } from '../services/rank.js';
import { verifyClaim } from '../services/verify.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync('uploads', { recursive: true });
    cb(null, 'uploads');
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') cb(null, true);
    else cb(new Error('Only mp4 files allowed'));
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runPipeline(jobId, videoPath) {
  try {
    // Step 1: Extract audio and frames
    const audioPath = await extractAudio(videoPath, jobId);
    const framePaths = await extractFrames(videoPath, jobId);
    console.log(`[Job ${jobId}] Extracted audio and ${framePaths.length} frames`);

    // Step 1: Transcribe
    await sleep(1000);
    const transcription = await transcribeAudio(audioPath);
    const transcript = transcription.text || '';
    console.log(`[Job ${jobId}] Transcript: ${transcript.slice(0, 80)}...`);

    // Step 4: OCR
    const rawOcr = await runOCR(framePaths);
    const ocrText = Array.isArray(rawOcr) && rawOcr.length > 0 ? rawOcr : [];

    // Step 2: Extract claims (do not send OCR text if empty)
    const rawClaims = await extractClaims(
      transcript,
      ocrText.length > 0 ? ocrText : [],
      transcription?.segments
    );
    console.log(`[Job ${jobId}] Extracted ${rawClaims.length} claims`);

    // Step 3: Concurrent Search, rank, verify with concurrency limit 3 and retry backoff
    function pLimit(concurrency = 3) {
      let active = 0;
      const queue = [];
      const next = () => {
        if (active < concurrency && queue.length > 0) {
          active++;
          const { fn, resolve, reject } = queue.shift();
          fn().then(resolve, reject).finally(() => {
            active--;
            next();
          });
        }
      };
      return (fn) => new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    }

    async function retryBackoff(fn, maxRetries = 3, baseDelayMs = 1000) {
      let attempt = 0;
      while (true) {
        try {
          return await fn();
        } catch (err) {
          attempt++;
          const isRateLimit =
            err?.status === 429 ||
            err?.status === 503 ||
            err?.message?.includes('429') ||
            err?.message?.includes('503') ||
            err?.message?.includes('high demand') ||
            err?.message?.includes('rate limit');
          if (attempt > maxRetries || !isRateLimit) throw err;
          const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
          console.warn(`[Retry] API rate limit/503 hit. Retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    const limit = pLimit(3);
    const claims = await Promise.all(
      rawClaims.map(claim =>
        limit(async () => {
          const evidence = await retryBackoff(() => searchEvidence(claim.text));
          const ranked = rankSources(evidence);
          const { verdict, explanation, citedIds = [] } = await retryBackoff(() => verifyClaim(claim.text, ranked));
          const retrievedIds = new Set(ranked.map(s => s.id));
          const citationValid = Array.isArray(citedIds) &&
            (citedIds.length === 0 ? verdict === 'unverified' : citedIds.every(id => retrievedIds.has(id)));
          return {
            ...claim,
            verdict: citationValid ? verdict : 'unverified',
            explanation,
            sources: ranked,
            citationValid
          };
        })
      )
    );

    // Cleanup uploads
    try { fs.unlinkSync(videoPath); } catch {}
    try { fs.unlinkSync(audioPath); } catch {}
    for (const f of framePaths) { try { fs.unlinkSync(f); } catch {} }

    await Job.findByIdAndUpdate(jobId, { status: 'done', transcript, ocrText, claims });
    console.log(`[Job ${jobId}] Done.`);
  } catch (err) {
    console.error(`[Job ${jobId}] Failed:`, err.message);
    await Job.findByIdAndUpdate(jobId, { status: 'failed', error: err.message });
  }
}

// POST /api/jobs
router.post('/', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided' });
    const job = await Job.create({ videoPath: req.file.path, status: 'processing' });
    res.json({ jobId: job._id });
    // Run pipeline in background (no await)
    runPipeline(job._id.toString(), req.file.path).catch(console.error);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/jobs/:id
router.get('/:id', async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
