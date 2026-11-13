// CapCatcher Rigorous Evaluation Benchmark Runner
// Runs full pipeline on all 12 benchmark reels, collects metrics, and saves raw results to eval/results/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load server environment
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '../server');
dotenv.config({ path: path.join(serverDir, '.env') });

import { extractAudio, extractFrames } from '../server/services/media.js';
import { transcribeAudio } from '../server/services/transcribe.js';
import { runOCR } from '../server/services/ocr.js';
import { extractClaims } from '../server/services/claims.js';
import { searchEvidence } from '../server/services/search.js';
import { rankSources } from '../server/services/rank.js';
import { verifyClaim } from '../server/services/verify.js';

const LABELS_PATH = path.join(__dirname, 'capcatcher/labels.json');
const REELS_DIR = path.join(__dirname, 'capcatcher/reels');
const RESULTS_DIR = path.join(__dirname, 'results');

if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Token-based matching helper
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function computeOverlap(textA, textB) {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const minSize = Math.min(tokensA.size, tokensB.size);
  return intersection / minSize;
}

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

export const apiStats = { retries: 0, errors: 0 };

async function retryBackoff(fn, maxRetries = 3, baseDelayMs = 1000) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      apiStats.retries++;
      const isRateLimit =
        err?.status === 429 ||
        err?.status === 503 ||
        err?.message?.includes('429') ||
        err?.message?.includes('503') ||
        err?.message?.includes('high demand') ||
        err?.message?.includes('rate limit');
      if (attempt > maxRetries || !isRateLimit) {
        apiStats.errors++;
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      console.warn(`[Retry] API rate limit/503 hit. Retrying in ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Stage execution with high-resolution timer
async function timeStage(fn) {
  const start = performance.now();
  const result = await fn();
  const duration = (performance.now() - start) / 1000;
  return { result, duration };
}

async function runPipelineForVideo(videoPath, jobId) {
  const timings = {};
  const t0 = performance.now();

  // 1. ffmpeg extraction
  const ffmpegRes = await timeStage(async () => {
    const audio = await extractAudio(videoPath, jobId);
    const frames = await extractFrames(videoPath, jobId);
    return { audio, frames };
  });
  timings.ffmpeg = ffmpegRes.duration;
  const { audio: audioPath, frames: framePaths } = ffmpegRes.result;

  // 2. Transcription
  const whisperRes = await timeStage(async () => {
    return await transcribeAudio(audioPath);
  });
  timings.transcription = whisperRes.duration;
  const transcription = whisperRes.result || {};
  const transcriptText = transcription.text || '';

  // 3. OCR
  const ocrRes = await timeStage(async () => {
    return await runOCR(framePaths);
  });
  timings.ocr = ocrRes.duration;
  const ocrText = ocrRes.result || [];

  // 4. Claim Extraction
  const claimRes = await timeStage(async () => {
    return await extractClaims(
      transcriptText,
      ocrText.length > 0 ? ocrText : [],
      transcription?.segments
    );
  });
  timings.claimExtraction = claimRes.duration;
  const rawClaims = claimRes.result || [];

  // 5. Evidence Search & 6. Verification (Concurrent limit: 3)
  const limit = pLimit(3);
  const searchStart = performance.now();
  const rankedSourcesList = await Promise.all(
    rawClaims.map(c =>
      limit(async () => {
        const evidence = await retryBackoff(() => searchEvidence(c.text));
        return rankSources(evidence);
      })
    )
  );
  timings.evidenceSearch = rawClaims.length > 0 ? (performance.now() - searchStart) / 1000 : 0;

  const verifyStart = performance.now();
  const verifyResults = await Promise.all(
    rawClaims.map((c, idx) =>
      limit(async () => {
        const sources = rankedSourcesList[idx];
        return await retryBackoff(() => verifyClaim(c.text, sources));
      })
    )
  );
  timings.verification = rawClaims.length > 0 ? (performance.now() - verifyStart) / 1000 : 0;

  const verifiedClaims = rawClaims.map((c, idx) => {
    const rankedSources = rankedSourcesList[idx];
    const verifyResult = verifyResults[idx];
    const retrievedIds = new Set(rankedSources.map(s => s.id));
    const citedIds = verifyResult.citedIds || [];
    const citationValid = Array.isArray(citedIds) &&
      (citedIds.length === 0 ? verifyResult.verdict === 'unverified' : citedIds.every(id => retrievedIds.has(id)));

    return {
      ...c,
      verdict: citationValid ? verifyResult.verdict : 'unverified',
      rawVerdict: verifyResult.verdict,
      explanation: verifyResult.explanation,
      citedIds,
      sources: rankedSources,
      citationValid
    };
  });
  timings.total = (performance.now() - t0) / 1000;

  // Clean up extracted artifacts
  try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
  for (const f of framePaths) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }

  return {
    transcript: transcriptText,
    ocrText,
    extractedClaims: verifiedClaims,
    timings
  };
}

export { runPipelineForVideo, LABELS_PATH, REELS_DIR, RESULTS_DIR, computeOverlap };

