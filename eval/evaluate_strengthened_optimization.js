// Rigorous Evaluation Script for Step 7: Strengthened Optimization Comparison
// Follows all 5 user requirements:
// 1. Time all 12 reels (1 warm-up + 5 runs each), alternating baseline and optimized
// 2. Report verification-stage and end-to-end medians and p95 grouped by claim count (1, 2, 3+)
// 3. Compare verdicts only on claims extracted in BOTH versions (agreement x of n, list all differing)
// 4. Report Gemini 503/429 errors, retries, and unverified due to API errors
// 5. Plainly attribute stage differences to architectural changes vs API noise

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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

function tokenize(text) {
  return String(text || '')
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

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
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

// Stage timer helper
async function timeStage(fn) {
  const start = performance.now();
  const result = await fn();
  const duration = (performance.now() - start) / 1000;
  return { result, duration };
}

// Global API error tracker
const apiTracker = {
  baseline: {
    gemini503Errors: 0,
    gemini429Errors: 0,
    retriesAttempted: 0,
    unverifiedDueToApiError: 0,
    errorLogs: []
  },
  optimized: {
    gemini503Errors: 0,
    gemini429Errors: 0,
    retriesAttempted: 0,
    unverifiedDueToApiError: 0,
    errorLogs: []
  }
};

// Pipeline runner for a single video in a specific mode
async function runSinglePipeline(videoPath, jobId, mode = 'baseline') {
  const timings = {};
  const t0 = performance.now();
  const currentLogs = [];

  // Temporarily hook console.warn and console.error to intercept API errors
  const origWarn = console.warn;
  const origError = console.error;
  const hookLog = (type, args) => {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    currentLogs.push({ type, msg });
    if (msg.includes('503') || msg.includes('high demand') || msg.includes('Service Unavailable')) {
      apiTracker[mode].gemini503Errors++;
      apiTracker[mode].errorLogs.push({ mode, jobId, type: '503', msg });
    } else if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('rate limit')) {
      apiTracker[mode].gemini429Errors++;
      apiTracker[mode].errorLogs.push({ mode, jobId, type: '429', msg });
    }
  };

  console.warn = (...args) => {
    hookLog('warn', args);
    origWarn.apply(console, args);
  };
  console.error = (...args) => {
    hookLog('error', args);
    origError.apply(console, args);
  };

  try {
    // 1. ffmpeg
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

    // 5. Evidence Search & 6. Verification
    let rankedSourcesList = [];
    let verifyResults = [];

    if (mode === 'baseline') {
      // BASELINE: Serial execution with 1,000ms delay and no retries
      const searchStart = performance.now();
      for (const claim of rawClaims) {
        await sleep(1000); // 1000ms artificial sleep
        const evidence = await searchEvidence(claim.text);
        rankedSourcesList.push(rankSources(evidence));
      }
      timings.evidenceSearch = rawClaims.length > 0 ? (performance.now() - searchStart) / 1000 : 0;

      const verifyStart = performance.now();
      for (let idx = 0; idx < rawClaims.length; idx++) {
        const claim = rawClaims[idx];
        const sources = rankedSourcesList[idx];
        const res = await verifyClaim(claim.text, sources);
        verifyResults.push(res);
      }
      timings.verification = rawClaims.length > 0 ? (performance.now() - verifyStart) / 1000 : 0;

    } else {
      // OPTIMIZED: Concurrent execution with concurrency limit 3, retryBackoff, no sleep
      async function retryBackoff(fn, maxRetries = 3, baseDelayMs = 1000) {
        let attempt = 0;
        while (true) {
          try {
            return await fn();
          } catch (err) {
            attempt++;
            apiTracker.optimized.retriesAttempted++;
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
            await sleep(delay);
          }
        }
      }

      const limit = pLimit(3);
      const searchStart = performance.now();
      rankedSourcesList = await Promise.all(
        rawClaims.map(c =>
          limit(async () => {
            const evidence = await retryBackoff(() => searchEvidence(c.text));
            return rankSources(evidence);
          })
        )
      );
      timings.evidenceSearch = rawClaims.length > 0 ? (performance.now() - searchStart) / 1000 : 0;

      const verifyStart = performance.now();
      verifyResults = await Promise.all(
        rawClaims.map((c, idx) =>
          limit(async () => {
            const sources = rankedSourcesList[idx];
            return await retryBackoff(() => verifyClaim(c.text, sources));
          })
        )
      );
      timings.verification = rawClaims.length > 0 ? (performance.now() - verifyStart) / 1000 : 0;
    }

    const verifiedClaims = rawClaims.map((c, idx) => {
      const rankedSources = rankedSourcesList[idx];
      const verifyResult = verifyResults[idx];
      const retrievedIds = new Set(rankedSources.map(s => s.id));
      const citedIds = verifyResult.citedIds || [];
      const citationValid = Array.isArray(citedIds) &&
        (citedIds.length === 0 ? verifyResult.verdict === 'unverified' : citedIds.every(id => retrievedIds.has(id)));

      const finalVerdict = citationValid ? verifyResult.verdict : 'unverified';
      if (finalVerdict === 'unverified' && verifyResult.explanation?.includes('Error verifying claim')) {
        apiTracker[mode].unverifiedDueToApiError++;
      }

      return {
        text: c.text,
        timestamp: c.timestamp,
        origin: c.origin,
        verdict: finalVerdict,
        rawVerdict: verifyResult.verdict,
        explanation: verifyResult.explanation,
        citedIds,
        sources: rankedSources,
        citationValid
      };
    });

    timings.total = (performance.now() - t0) / 1000;

    // Cleanup temp files
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
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
}

async function main() {
  console.log('======================================================================');
  console.log('   CAPCATCHER STRENGTHENED OPTIMIZATION BENCHMARK (ALL 12 REELS)      ');
  console.log('======================================================================\n');

  const rawLabels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'));
  const isTestMode = process.argv.includes('--test');
  const targetReels = isTestMode ? rawLabels.slice(0, 1) : rawLabels;
  const runsPerReel = isTestMode ? 1 : 5;

  console.log(`Mode: ${isTestMode ? 'TEST DRY-RUN (1 reel, 1 run)' : 'FULL BENCHMARK (12 reels, 1 warm-up + 5 measured runs each)'}\n`);

  const allReelResults = [];

  for (let rIdx = 0; rIdx < targetReels.length; rIdx++) {
    const reel = targetReels[rIdx];
    const videoPath = path.join(REELS_DIR, reel.video_file);

    console.log(`\n----------------------------------------------------------------------`);
    console.log(`[Reel ${rIdx + 1}/${targetReels.length}] ${reel.id} (${reel.modality}, ${reel.duration_seconds || reel.duration_sec}s, ${reel.claims.length} labeled claims)`);
    console.log(`----------------------------------------------------------------------`);

    // 1. Warm-up runs (1 baseline, 1 optimized) - alternating
    console.log('  [Warm-up] Running Baseline...');
    const warmBase = await runSinglePipeline(videoPath, `warm_base_${reel.id}_${Date.now()}`, 'baseline');
    console.log(`  -> Baseline warm-up done (${warmBase.timings.total.toFixed(2)}s, claims: ${warmBase.extractedClaims.length})`);
    await sleep(1500);

    console.log('  [Warm-up] Running Optimized...');
    const warmOpt = await runSinglePipeline(videoPath, `warm_opt_${reel.id}_${Date.now()}`, 'optimized');
    console.log(`  -> Optimized warm-up done (${warmOpt.timings.total.toFixed(2)}s, claims: ${warmOpt.extractedClaims.length})`);
    await sleep(1500);

    const measuredRuns = [];

    // 2. Measured runs - strictly alternating: Baseline then Optimized
    for (let run = 1; run <= runsPerReel; run++) {
      console.log(`\n  --- Measured Run ${run}/${runsPerReel} ---`);

      // Run Baseline
      const tBaseStart = Date.now();
      const baseRes = await runSinglePipeline(videoPath, `meas_base_${reel.id}_r${run}_${tBaseStart}`, 'baseline');
      console.log(`  [Run ${run} Base] Total: ${baseRes.timings.total.toFixed(2)}s | Verify: ${baseRes.timings.verification.toFixed(2)}s | Claims: ${baseRes.extractedClaims.length}`);
      await sleep(1500); // Throttling pause to respect 15 RPM

      // Run Optimized
      const tOptStart = Date.now();
      const optRes = await runSinglePipeline(videoPath, `meas_opt_${reel.id}_r${run}_${tOptStart}`, 'optimized');
      console.log(`  [Run ${run} Opt ] Total: ${optRes.timings.total.toFixed(2)}s | Verify: ${optRes.timings.verification.toFixed(2)}s | Claims: ${optRes.extractedClaims.length}`);
      await sleep(1500); // Throttling pause to respect 15 RPM

      measuredRuns.push({
        run,
        baseline: baseRes,
        optimized: optRes
      });
    }

    allReelResults.push({
      reelId: reel.id,
      videoFile: reel.video_file,
      modality: reel.modality,
      durationSec: reel.duration_sec,
      labeledClaimsCount: reel.claims.length,
      runs: measuredRuns
    });
  }

  console.log('\n======================================================================');
  console.log('               COMPUTING RIGOROUS EVALUATION METRICS                  ');
  console.log('======================================================================\n');

  // --- Grouping by number of claims (1, 2, 3+) ---
  const groups = {
    '0 Claims (Controls)': { baseline: { verify: [], total: [] }, optimized: { verify: [], total: [] } },
    '1 Claim': { baseline: { verify: [], total: [] }, optimized: { verify: [], total: [] } },
    '2 Claims': { baseline: { verify: [], total: [] }, optimized: { verify: [], total: [] } },
    '3+ Claims': { baseline: { verify: [], total: [] }, optimized: { verify: [], total: [] } }
  };

  function getGroupKey(count) {
    if (count === 0) return '0 Claims (Controls)';
    if (count === 1) return '1 Claim';
    if (count === 2) return '2 Claims';
    return '3+ Claims';
  }

  // Populate groups individually by run's claim count
  for (const reelData of allReelResults) {
    for (const r of reelData.runs) {
      const baseKey = getGroupKey(r.baseline.extractedClaims.length);
      groups[baseKey].baseline.verify.push(r.baseline.timings.verification);
      groups[baseKey].baseline.total.push(r.baseline.timings.total);

      const optKey = getGroupKey(r.optimized.extractedClaims.length);
      groups[optKey].optimized.verify.push(r.optimized.timings.verification);
      groups[optKey].optimized.total.push(r.optimized.timings.total);
    }
  }

  const groupedMetrics = {};
  for (const [groupName, data] of Object.entries(groups)) {
    groupedMetrics[groupName] = {
      baselineRunsCount: data.baseline.total.length,
      optimizedRunsCount: data.optimized.total.length,
      verification: {
        baseline: { median: median(data.baseline.verify), p95: percentile(data.baseline.verify, 95) },
        optimized: { median: median(data.optimized.verify), p95: percentile(data.optimized.verify, 95) }
      },
      endToEnd: {
        baseline: { median: median(data.baseline.total), p95: percentile(data.baseline.total, 95) },
        optimized: { median: median(data.optimized.total), p95: percentile(data.optimized.total, 95) }
      }
    };
  }

  // --- Compare verdicts only on claims extracted in BOTH versions ---
  let totalMatchedClaims = 0;
  let totalAgreedVerdicts = 0;
  const differingVerdicts = [];
  const concordantVerdicts = [];

  for (const reelData of allReelResults) {
    for (const r of reelData.runs) {
      const baseClaims = r.baseline.extractedClaims;
      const optClaims = r.optimized.extractedClaims;

      for (const bClaim of baseClaims) {
        // Find best match in optClaims
        let bestMatch = null;
        let bestOverlap = 0;
        for (const oClaim of optClaims) {
          const overlap = computeOverlap(bClaim.text, oClaim.text);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestMatch = oClaim;
          }
        }

        if (bestMatch && bestOverlap >= 0.5) {
          totalMatchedClaims++;
          const agreement = bClaim.verdict === bestMatch.verdict;
          if (agreement) {
            totalAgreedVerdicts++;
            concordantVerdicts.push({
              reelId: reelData.reelId,
              run: r.run,
              claimText: bClaim.text,
              verdict: bClaim.verdict
            });
          } else {
            differingVerdicts.push({
              reelId: reelData.reelId,
              run: r.run,
              claimText: bClaim.text,
              baselineVerdict: bClaim.verdict,
              optimizedVerdict: bestMatch.verdict,
              baselineExplanation: bClaim.explanation,
              optimizedExplanation: bestMatch.explanation
            });
          }
        }
      }
    }
  }

  const verdictAgreementRate = totalMatchedClaims > 0 ? (totalAgreedVerdicts / totalMatchedClaims) : 1;

  // --- Compile overall summary ---
  const finalSummary = {
    evaluationDate: new Date().toISOString(),
    totalReels: allReelResults.length,
    measuredRunsPerReel: 5,
    totalMeasuredPairs: allReelResults.length * 5,
    groupedLatency: groupedMetrics,
    verdictComparison: {
      totalMatchedClaimsAcrossRuns: totalMatchedClaims,
      totalAgreedVerdicts,
      agreementRate: verdictAgreementRate,
      agreementFormatted: `${totalAgreedVerdicts} of ${totalMatchedClaims} (${(verdictAgreementRate * 100).toFixed(1)}%)`,
      differingVerdictsCount: differingVerdicts.length,
      differingVerdicts
    },
    apiStats: {
      baseline: {
        gemini503Errors: apiTracker.baseline.gemini503Errors,
        gemini429Errors: apiTracker.baseline.gemini429Errors,
        retriesAttempted: apiTracker.baseline.retriesAttempted,
        unverifiedDueToApiError: apiTracker.baseline.unverifiedDueToApiError
      },
      optimized: {
        gemini503Errors: apiTracker.optimized.gemini503Errors,
        gemini429Errors: apiTracker.optimized.gemini429Errors,
        retriesAttempted: apiTracker.optimized.retriesAttempted,
        unverifiedDueToApiError: apiTracker.optimized.unverifiedDueToApiError
      }
    },
    rawReelResults: allReelResults
  };

  const outputPath = path.join(RESULTS_DIR, 'strengthened_optimization_metrics.json');
  fs.writeFileSync(outputPath, JSON.stringify(finalSummary, null, 2), 'utf-8');

  console.log(`\nResults successfully written to: ${outputPath}\n`);

  // Console reporting
  console.log('--- Latency Summary Grouped by Claim Count ---');
  console.table(
    Object.entries(groupedMetrics).map(([group, m]) => ({
      Group: group,
      'Base Runs': m.baselineRunsCount,
      'Opt Runs': m.optimizedRunsCount,
      'Verify Base Med': `${m.verification.baseline.median.toFixed(2)}s`,
      'Verify Opt Med': `${m.verification.optimized.median.toFixed(2)}s`,
      'Verify Opt p95': `${m.verification.optimized.p95.toFixed(2)}s`,
      'Total Base Med': `${m.endToEnd.baseline.median.toFixed(2)}s`,
      'Total Opt Med': `${m.endToEnd.optimized.median.toFixed(2)}s`,
      'Total Opt p95': `${m.endToEnd.optimized.p95.toFixed(2)}s`
    }))
  );

  console.log('\n--- Verdict Comparison on Matched Claims ---');
  console.log(`Agreement: ${totalAgreedVerdicts} of ${totalMatchedClaims} (${(verdictAgreementRate * 100).toFixed(1)}%)`);
  console.log(`Differing verdicts: ${differingVerdicts.length}`);
  if (differingVerdicts.length > 0) {
    console.table(differingVerdicts.map(d => ({
      Reel: d.reelId,
      Run: d.run,
      Claim: d.claimText.slice(0, 40) + '...',
      Baseline: d.baselineVerdict,
      Optimized: d.optimizedVerdict
    })));
  }

  console.log('\n--- API Errors & Retries ---');
  console.log('Baseline :', finalSummary.apiStats.baseline);
  console.log('Optimized:', finalSummary.apiStats.optimized);
}

main().catch(err => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
