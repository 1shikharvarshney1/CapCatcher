// CapCatcher Whisper Provider Comparison Benchmark (Step 2)
// Runs the 12-reel synthetic benchmark with WHISPER_PROVIDER=local
// Compares against baseline Groq results on:
// 1. Claims recovered (TP out of 24)
// 2. False positives (FP)
// 3. Verdicts matching labels
// 4. Timestamp error (median, min, max)
// 5. Transcription time
// 6. End-to-end time

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '../server');
dotenv.config({ path: path.join(serverDir, '.env') });

import { runPipelineForVideo, LABELS_PATH, REELS_DIR, RESULTS_DIR, computeOverlap } from './pipeline_runner.js';
import { shutdownLocalWorker } from '../server/services/local_whisper.js';
import { transcribeAudioGroq } from '../server/services/transcribe.js';
import { extractAudio } from '../server/services/media.js';

function median(values) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function runBenchmark() {
  console.log('===========================================================');
  console.log('CapCatcher Step 2: 12-Reel Benchmark (Local vs. Groq Whisper)');
  console.log('===========================================================\n');

  // Verify labels.json
  const rawLabels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'));
  console.log(`Loaded ${rawLabels.length} ground-truth reel labels from: ${LABELS_PATH}`);

  // Set provider to local
  process.env.WHISPER_PROVIDER = 'local';
  process.env.WHISPER_LOCAL_MODEL = 'base';
  console.log(`Configured WHISPER_PROVIDER=${process.env.WHISPER_PROVIDER}, MODEL=${process.env.WHISPER_LOCAL_MODEL}\n`);

  const localOutputs = [];
  const groqTranscriptionTimes = [];

  // Iterate over all 12 reels
  for (let i = 0; i < rawLabels.length; i++) {
    const reel = rawLabels[i];
    const videoPath = path.join(REELS_DIR, reel.video_file);
    const jobId = `whisper_eval_${reel.id}_${Date.now()}`;

    console.log(`[Reel ${i + 1}/${rawLabels.length}] ${reel.id} (${reel.video_file}, ${reel.modality})...`);

    // Run full local pipeline
    const output = await runPipelineForVideo(videoPath, jobId);
    localOutputs.push({
      reelId: reel.id,
      videoFile: reel.video_file,
      modality: reel.modality,
      ...output
    });

    console.log(`  -> Local: ${output.extractedClaims.length} claims extracted | Transcription: ${output.timings.transcription.toFixed(2)}s | Total: ${output.timings.total.toFixed(2)}s`);

    // Also benchmark Groq transcription on same extracted audio if Groq API key is present
    try {
      const audioPath = await extractAudio(videoPath, `groq_test_${reel.id}`);
      const t0 = performance.now();
      await transcribeAudioGroq(audioPath);
      const groqDuration = (performance.now() - t0) / 1000;
      groqTranscriptionTimes.push(groqDuration);
      console.log(`  -> Groq Whisper-large-v3 transcription time: ${groqDuration.toFixed(2)}s`);
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
    } catch (gErr) {
      console.warn(`  -> Groq benchmark failed for ${reel.id}: ${gErr.message}`);
    }
  }

  // Shutdown local worker
  shutdownLocalWorker();

  // Save raw outputs
  const localOutputPath = path.join(RESULTS_DIR, 'local_whisper_pipeline_output.json');
  fs.writeFileSync(localOutputPath, JSON.stringify(localOutputs, null, 2));
  console.log(`\n[Saved] ${localOutputPath}`);

  // Load baseline Groq outputs
  const baselinePath = path.join(RESULTS_DIR, 'raw_pipeline_output.json');
  let baselineOutputs = [];
  if (fs.existsSync(baselinePath)) {
    baselineOutputs = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  }

  // --- Evaluate Local Claims against ground truth ---
  let localTP = 0;
  let localFP = 0;
  let localFN = 0;
  let localVerdictsMatching = 0;
  const localTimestampErrors = [];
  const matchedClaimsLocal = [];

  for (const label of rawLabels) {
    const runData = localOutputs.find(p => p.reelId === label.id);
    const gtClaims = label.claims || [];
    const predClaims = runData ? runData.extractedClaims : [];

    const matchedPredIndices = new Set();
    let reelTP = 0;

    for (let gIdx = 0; gIdx < gtClaims.length; gIdx++) {
      const gt = gtClaims[gIdx];
      let bestScore = 0;
      let bestPIdx = -1;

      for (let pIdx = 0; pIdx < predClaims.length; pIdx++) {
        if (matchedPredIndices.has(pIdx)) continue;
        const pred = predClaims[pIdx];
        const score = computeOverlap(gt.claim_text, pred.text);
        if (score > bestScore) {
          bestScore = score;
          bestPIdx = pIdx;
        }
      }

      if (bestScore >= 0.45) {
        matchedPredIndices.add(bestPIdx);
        reelTP++;
        const pred = predClaims[bestPIdx];

        const isVerdictMatch = (gt.verdict.toLowerCase() === pred.verdict.toLowerCase());
        if (isVerdictMatch) {
          localVerdictsMatching++;
        }

        // Timestamp error for speech/multimodal claims
        let tsError = null;
        if (gt.timestamp_start_sec != null && pred.timestamp != null) {
          tsError = Math.abs(pred.timestamp - gt.timestamp_start_sec);
          localTimestampErrors.push(tsError);
        }

        matchedClaimsLocal.push({
          reelId: label.id,
          gtText: gt.claim_text,
          predText: pred.text,
          gtVerdict: gt.verdict,
          predVerdict: pred.verdict,
          verdictMatch: isVerdictMatch,
          gtTimestamp: gt.timestamp_start_sec,
          predTimestamp: pred.timestamp,
          timestampError: tsError,
          score: bestScore
        });
      }
    }

    const reelFN = gtClaims.length - reelTP;
    const reelFP = predClaims.length - reelTP;

    localTP += reelTP;
    localFP += reelFP;
    localFN += reelFN;
  }

  // Baseline Groq numbers from RESULTS.md & raw_pipeline_output.json
  const groqTP = 21;
  const groqFP = 0;
  const groqFN = 3;
  const groqVerdictsMatching = 18;
  const groqTimestampMedian = 3.0; // from RESULTS.md: median 3.0s, range 0.0 - 5.0s

  const localTranscriptionTimes = localOutputs.map(o => o.timings.transcription);
  const localTotalTimes = localOutputs.map(o => o.timings.total);

  const baselineTranscriptionTimes = baselineOutputs.map(o => o.timings.transcription);
  const baselineTotalTimes = baselineOutputs.map(o => o.timings.total);

  const finalComparison = {
    evaluatedReels: 12,
    totalGroundTruthClaims: 24,
    metrics: {
      claimsRecovered: {
        description: 'True Positives (recovered checkable claims)',
        groq: `${groqTP} of 24 (${((groqTP / 24) * 100).toFixed(1)}%)`,
        local: `${localTP} of 24 (${((localTP / 24) * 100).toFixed(1)}%)`
      },
      falsePositives: {
        description: 'False Positives (extraneous claims detected)',
        groq: groqFP,
        local: localFP
      },
      falseNegatives: {
        description: 'False Negatives (missed checkable claims)',
        groq: groqFN,
        local: localFN
      },
      verdictAccuracy: {
        description: 'Verdicts matching ground truth labels',
        groq: `${groqVerdictsMatching} of ${groqTP} (${((groqVerdictsMatching / groqTP) * 100).toFixed(1)}%)`,
        local: `${localVerdictsMatching} of ${localTP} (${localTP > 0 ? ((localVerdictsMatching / localTP) * 100).toFixed(1) : 0}%)`
      },
      timestampErrorSec: {
        description: 'Speech claim timestamp error (|pred - gt|)',
        groqMedian: groqTimestampMedian,
        localMedian: localTimestampErrors.length > 0 ? median(localTimestampErrors) : null,
        localMin: localTimestampErrors.length > 0 ? Math.min(...localTimestampErrors) : null,
        localMax: localTimestampErrors.length > 0 ? Math.max(...localTimestampErrors) : null,
        localMean: localTimestampErrors.length > 0 ? Number(mean(localTimestampErrors).toFixed(2)) : null
      },
      transcriptionTimeSec: {
        description: 'Audio transcription duration per reel',
        groqMedian: Number(median(baselineTranscriptionTimes.length > 0 ? baselineTranscriptionTimes : groqTranscriptionTimes).toFixed(2)),
        groqMean: Number(mean(baselineTranscriptionTimes.length > 0 ? baselineTranscriptionTimes : groqTranscriptionTimes).toFixed(2)),
        localMedian: Number(median(localTranscriptionTimes).toFixed(2)),
        localMean: Number(mean(localTranscriptionTimes).toFixed(2)),
        localMin: Number(Math.min(...localTranscriptionTimes).toFixed(2)),
        localMax: Number(Math.max(...localTranscriptionTimes).toFixed(2))
      },
      endToEndTimeSec: {
        description: 'Total pipeline duration per reel',
        groqMedian: Number(median(baselineTotalTimes).toFixed(2)),
        groqMean: Number(mean(baselineTotalTimes).toFixed(2)),
        localMedian: Number(median(localTotalTimes).toFixed(2)),
        localMean: Number(mean(localTotalTimes).toFixed(2)),
        localMin: Number(Math.min(...localTotalTimes).toFixed(2)),
        localMax: Number(Math.max(...localTotalTimes).toFixed(2))
      }
    },
    matchedClaims: matchedClaimsLocal
  };

  const comparisonJsonPath = path.join(RESULTS_DIR, 'whisper_comparison_results.json');
  fs.writeFileSync(comparisonJsonPath, JSON.stringify(finalComparison, null, 2));
  console.log(`\n[Saved] ${comparisonJsonPath}\n`);

  console.log('===========================================================');
  console.log('             BENCHMARK COMPARISON RESULTS                  ');
  console.log('===========================================================');
  console.table({
    'Claims Recovered (TP)': {
      'Groq Whisper (large-v3)': finalComparison.metrics.claimsRecovered.groq,
      'Local Whisper (base, CPU)': finalComparison.metrics.claimsRecovered.local
    },
    'False Positives (FP)': {
      'Groq Whisper (large-v3)': finalComparison.metrics.falsePositives.groq,
      'Local Whisper (base, CPU)': finalComparison.metrics.falsePositives.local
    },
    'Verdicts Matching Labels': {
      'Groq Whisper (large-v3)': finalComparison.metrics.verdictAccuracy.groq,
      'Local Whisper (base, CPU)': finalComparison.metrics.verdictAccuracy.local
    },
    'Timestamp Error Median': {
      'Groq Whisper (large-v3)': `${finalComparison.metrics.timestampErrorSec.groqMedian}s`,
      'Local Whisper (base, CPU)': `${finalComparison.metrics.timestampErrorSec.localMedian}s`
    },
    'Transcription Time (Median)': {
      'Groq Whisper (large-v3)': `${finalComparison.metrics.transcriptionTimeSec.groqMedian}s`,
      'Local Whisper (base, CPU)': `${finalComparison.metrics.transcriptionTimeSec.localMedian}s`
    },
    'Transcription Time (Mean)': {
      'Groq Whisper (large-v3)': `${finalComparison.metrics.transcriptionTimeSec.groqMean}s`,
      'Local Whisper (base, CPU)': `${finalComparison.metrics.transcriptionTimeSec.localMean}s`
    },
    'End-to-End Time (Median)': {
      'Groq Whisper (large-v3)': `${finalComparison.metrics.endToEndTimeSec.groqMedian}s`,
      'Local Whisper (base, CPU)': `${finalComparison.metrics.endToEndTimeSec.localMedian}s`
    },
    'End-to-End Time (Mean)': {
      'Groq Whisper (large-v3)': `${finalComparison.metrics.endToEndTimeSec.groqMean}s`,
      'Local Whisper (base, CPU)': `${finalComparison.metrics.endToEndTimeSec.localMean}s`
    }
  });

  return finalComparison;
}

runBenchmark().catch(err => {
  console.error('[Benchmark Error]', err);
  shutdownLocalWorker();
  process.exit(1);
});
