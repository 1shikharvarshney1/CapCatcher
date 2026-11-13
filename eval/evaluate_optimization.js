// Evaluation script for Step 7: Optimization Benchmark
// Runs Step 6 latency benchmark and verdict comparison on opt-parallel-verification branch

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '../server');
dotenv.config({ path: path.join(serverDir, '.env') });

import { runPipelineForVideo, LABELS_PATH, REELS_DIR, RESULTS_DIR, computeOverlap, apiStats } from './pipeline_runner.js';

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function main() {
  console.log('=== CapCatcher Optimization Benchmark (opt-parallel-verification) ===\n');

  const baselineRaw = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'raw_pipeline_output.json'), 'utf-8'));
  const baselineVerdicts = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'verdict_accuracy_metrics.json'), 'utf-8'));
  const baselineLatency = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'latency_metrics.json'), 'utf-8'));
  const rawLabels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'));

  // 1. Run pipeline on the 12 reels to compare verdicts and check stability
  console.log('--- 1. Evaluating Optimized Pipeline Across Benchmark Reels ---');
  const optOutputs = [];

  for (let i = 0; i < rawLabels.length; i++) {
    const reel = rawLabels[i];
    const videoPath = path.join(REELS_DIR, reel.video_file);
    const jobId = `opt_eval_${reel.id}_${Date.now()}`;

    console.log(`[Reel ${i + 1}/${rawLabels.length}] Processing ${reel.id} (${reel.modality})...`);
    const output = await runPipelineForVideo(videoPath, jobId);

    optOutputs.push({
      reelId: reel.id,
      videoFile: reel.video_file,
      modality: reel.modality,
      ...output
    });
    console.log(`  -> Extracted ${output.extractedClaims.length} claims in ${output.timings.total.toFixed(2)}s (verify: ${output.timings.verification.toFixed(2)}s)`);
  }

  // Compare verdicts between baseline and optimized
  console.log('\n--- 2. Verdict Concordance & Accuracy Comparison ---');
  const matchedClaims = [];
  const verdictChanges = [];
  let correctOptVerdicts = 0;

  for (const label of rawLabels) {
    const optRun = optOutputs.find(p => p.reelId === label.id);
    const baseRun = baselineRaw.find(p => p.reelId === label.id);
    const gtClaims = label.claims || [];
    const predClaims = optRun ? optRun.extractedClaims : [];
    const basePredClaims = baseRun ? baseRun.extractedClaims : [];

    for (let gIdx = 0; gIdx < gtClaims.length; gIdx++) {
      const gt = gtClaims[gIdx];
      let bestScore = 0;
      let bestPIdx = -1;

      for (let pIdx = 0; pIdx < predClaims.length; pIdx++) {
        const pred = predClaims[pIdx];
        const score = computeOverlap(gt.claim_text, pred.text);
        if (score > bestScore) {
          bestScore = score;
          bestPIdx = pIdx;
        }
      }

      if (bestScore >= 0.45) {
        const optPred = predClaims[bestPIdx];

        // Find baseline equivalent
        let basePredVerdict = 'not_extracted';
        for (const bp of basePredClaims) {
          if (computeOverlap(gt.claim_text, bp.text) >= 0.45) {
            basePredVerdict = bp.verdict.toLowerCase();
            break;
          }
        }

        const isCorrect = optPred.verdict.toLowerCase() === gt.verdict.toLowerCase();
        if (isCorrect) correctOptVerdicts++;

        const changed = optPred.verdict.toLowerCase() !== basePredVerdict;
        if (changed) {
          verdictChanges.push({
            reelId: label.id,
            claim: gt.claim_text,
            groundTruth: gt.verdict.toLowerCase(),
            baselineVerdict: basePredVerdict,
            optimizedVerdict: optPred.verdict.toLowerCase()
          });
        }

        matchedClaims.push({
          reelId: label.id,
          gtClaimId: gt.claim_id,
          claim: gt.claim_text,
          groundTruth: gt.verdict.toLowerCase(),
          baselineVerdict: basePredVerdict,
          optimizedVerdict: optPred.verdict.toLowerCase(),
          isCorrect
        });
      }
    }
  }

  const optAccuracy = matchedClaims.length > 0 ? correctOptVerdicts / matchedClaims.length : 0;
  console.log(`Optimized Verdict Accuracy: ${correctOptVerdicts} of ${matchedClaims.length} (${(optAccuracy * 100).toFixed(1)}%)`);
  console.log(`Baseline Verdict Accuracy: ${baselineVerdicts.correctVerdicts} of ${baselineVerdicts.sampleSizeMatched} (${(baselineVerdicts.accuracy * 100).toFixed(1)}%)`);
  console.log(`Verdict Changes between versions: ${verdictChanges.length}`);

  // 2. Re-run Step 6: Latency Benchmark (1 warm-up + 5 measured runs per class)
  console.log('\n--- 3. Re-running Step 6 Latency Benchmark (1 warm-up + 5 runs) ---');
  const latencyClasses = [
    { name: '30s Class (Reel 01)', file: 'reel_01.mp4' },
    { name: '38s Class (Reel 07)', file: 'reel_07.mp4' }
  ];

  const optLatencyResults = {};

  for (const lc of latencyClasses) {
    console.log(`\nBenchmarking ${lc.name}...`);
    const videoPath = path.join(REELS_DIR, lc.file);

    // Warm-up run
    console.log('  Running 1 warm-up run...');
    await runPipelineForVideo(videoPath, `opt_warmup_${Date.now()}`);

    // 5 Measured runs
    const stageRuns = {
      ffmpeg: [],
      transcription: [],
      ocr: [],
      claimExtraction: [],
      evidenceSearch: [],
      verification: [],
      total: []
    };

    for (let r = 1; r <= 5; r++) {
      console.log(`  Measured run ${r}/5...`);
      const res = await runPipelineForVideo(videoPath, `opt_latency_${lc.name}_${r}_${Date.now()}`);
      for (const k of Object.keys(stageRuns)) {
        stageRuns[k].push(res.timings[k] || 0);
      }
    }

    const summary = {};
    for (const [stage, runs] of Object.entries(stageRuns)) {
      summary[stage] = {
        runs,
        median: median(runs),
        p95: percentile(runs, 95)
      };
    }

    optLatencyResults[lc.name] = {
      frameSamplingRate: '0.5 fps (1 frame every 2 seconds, max 30 frames)',
      summary
    };
  }

  // Construct Before / After Comparison
  const comparison = {
    method: 'Concurrency limit 3 with retryBackoff for 429/503; removed 1000ms artificial sleep',
    baselineAccuracy: {
      sampleSize: baselineVerdicts.sampleSizeMatched,
      correct: baselineVerdicts.correctVerdicts,
      accuracy: baselineVerdicts.accuracy
    },
    optimizedAccuracy: {
      sampleSize: matchedClaims.length,
      correct: correctOptVerdicts,
      accuracy: optAccuracy,
      verdictChanges
    },
    apiStats: {
      retries: apiStats.retries,
      errors: apiStats.errors
    },
    latencyComparison: {
      '30s Class': {
        baseline: baselineLatency['30s Class (Reel 01)'].summary,
        optimized: optLatencyResults['30s Class (Reel 01)'].summary
      },
      '38s Class': {
        baseline: baselineLatency['38s Class (Reel 07)'].summary,
        optimized: optLatencyResults['38s Class (Reel 07)'].summary
      }
    }
  };

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'optimized_latency_metrics.json'),
    JSON.stringify(optLatencyResults, null, 2)
  );
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'optimization_comparison.json'),
    JSON.stringify(comparison, null, 2)
  );

  console.log('\n=== Optimization Evaluation Complete! ===');
  console.log('Results saved to eval/results/optimized_latency_metrics.json and optimization_comparison.json');
}

main().catch(err => {
  console.error('Optimization evaluation error:', err);
  process.exit(1);
});

