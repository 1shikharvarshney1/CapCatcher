// Complete CapCatcher Benchmark Evaluation Script
// Executes Steps 2, 3, 4, 5, 6 and produces structured metric outputs in eval/results/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '../server');
dotenv.config({ path: path.join(serverDir, '.env') });

import { runPipelineForVideo, LABELS_PATH, REELS_DIR, RESULTS_DIR, computeOverlap } from './pipeline_runner.js';

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
  console.log('=== CapCatcher Evaluation Benchmark Starting ===\n');

  const rawLabels = JSON.parse(fs.readFileSync(LABELS_PATH, 'utf-8'));
  console.log(`Loaded ${rawLabels.length} reels from ground truth labels.\n`);

  // --- 1. Run Pipeline on all 12 Reels ---
  const pipelineOutputs = [];
  const reelResults = [];

  for (let i = 0; i < rawLabels.length; i++) {
    const reel = rawLabels[i];
    const videoPath = path.join(REELS_DIR, reel.video_file);
    const jobId = `eval_job_${reel.id}_${Date.now()}`;

    console.log(`[Reel ${i + 1}/${rawLabels.length}] Processing ${reel.id} (${reel.video_file}, ${reel.modality})...`);
    const output = await runPipelineForVideo(videoPath, jobId);

    pipelineOutputs.push({
      reelId: reel.id,
      videoFile: reel.video_file,
      modality: reel.modality,
      ...output
    });

    console.log(`  -> Extracted ${output.extractedClaims.length} claims in ${output.timings.total.toFixed(2)}s`);
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'raw_pipeline_output.json'),
    JSON.stringify(pipelineOutputs, null, 2)
  );
  console.log('\n[Saved] eval/results/raw_pipeline_output.json');

  // --- Step 2: Claim Extraction & Matching ---
  console.log('\n--- Step 2: Claim Extraction & Matching ---');
  let totalTP = 0;
  let totalFP = 0;
  let totalFN = 0;
  const matchedClaims = [];
  const ambiguousMatches = [];
  const perReelMetrics = [];

  for (const label of rawLabels) {
    const runData = pipelineOutputs.find(p => p.reelId === label.id);
    const gtClaims = label.claims || [];
    const predClaims = runData ? runData.extractedClaims : [];

    const matchedPredIndices = new Set();
    const matchedGtIndices = new Set();
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
        matchedGtIndices.add(gIdx);
        matchedPredIndices.add(bestPIdx);
        reelTP++;
        matchedClaims.push({
          reelId: label.id,
          gtClaimId: gt.claim_id,
          gtText: gt.claim_text,
          predText: predClaims[bestPIdx].text,
          gtVerdict: gt.verdict.toLowerCase(),
          predVerdict: predClaims[bestPIdx].verdict.toLowerCase(),
          gtTimestamp: gt.timestamp_start_sec,
          predTimestamp: predClaims[bestPIdx].timestamp,
          gtSource: gt.source_url,
          predSources: predClaims[bestPIdx].sources || [],
          citedIds: predClaims[bestPIdx].citedIds || [],
          explanation: predClaims[bestPIdx].explanation || '',
          score: bestScore
        });
      } else if (bestScore >= 0.25) {
        ambiguousMatches.push({
          reelId: label.id,
          gtClaimId: gt.claim_id,
          gtText: gt.claim_text,
          candidatePredText: predClaims[bestPIdx]?.text,
          score: bestScore,
          verdict: 'unmatched_due_to_low_overlap'
        });
      }
    }

    const reelFN = gtClaims.length - reelTP;
    const reelFP = predClaims.length - reelTP;
    const prec = (reelTP + reelFP) > 0 ? reelTP / (reelTP + reelFP) : (gtClaims.length === 0 && predClaims.length === 0 ? 1.0 : 0);
    const rec = (reelTP + reelFN) > 0 ? reelTP / (reelTP + reelFN) : (gtClaims.length === 0 && predClaims.length === 0 ? 1.0 : 0);
    const f1 = (prec + rec) > 0 ? (2 * prec * rec) / (prec + rec) : 0;

    totalTP += reelTP;
    totalFP += reelFP;
    totalFN += reelFN;

    perReelMetrics.push({
      reelId: label.id,
      modality: label.modality,
      groundTruthCount: gtClaims.length,
      extractedCount: predClaims.length,
      tp: reelTP,
      fp: reelFP,
      fn: reelFN,
      precision: prec,
      recall: rec,
      f1
    });
  }

  const overallPrecision = (totalTP + totalFP) > 0 ? totalTP / (totalTP + totalFP) : 0;
  const overallRecall = (totalTP + totalFN) > 0 ? totalTP / (totalTP + totalFN) : 0;
  const overallF1 = (overallPrecision + overallRecall) > 0 ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall) : 0;

  const extractionResults = {
    totalGroundTruthClaims: 24,
    totalExtractedClaims: totalTP + totalFP,
    totalTP,
    totalFP,
    totalFN,
    overallPrecision,
    overallRecall,
    overallF1,
    perReel: perReelMetrics,
    ambiguousMatches
  };

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'claim_extraction_metrics.json'),
    JSON.stringify(extractionResults, null, 2)
  );
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'ambiguous_matches.json'),
    JSON.stringify(ambiguousMatches, null, 2)
  );
  console.log(`Extraction Metrics: TP=${totalTP}, FP=${totalFP}, FN=${totalFN}, P=${(overallPrecision * 100).toFixed(1)}%, R=${(overallRecall * 100).toFixed(1)}%, F1=${(overallF1 * 100).toFixed(1)}%`);

  // --- Step 3: Verdict Accuracy ---
  console.log('\n--- Step 3: Verdict Accuracy ---');
  const validVerdicts = ['true', 'false', 'misleading', 'unverified'];
  const confusionMatrix = {};
  for (const v1 of validVerdicts) {
    confusionMatrix[v1] = {};
    for (const v2 of validVerdicts) {
      confusionMatrix[v1][v2] = 0;
    }
  }

  let correctVerdicts = 0;
  const wrongVerdicts = [];

  for (const m of matchedClaims) {
    const gt = m.gtVerdict;
    const pred = m.predVerdict;
    if (confusionMatrix[gt] && confusionMatrix[gt][pred] !== undefined) {
      confusionMatrix[gt][pred]++;
    }

    if (gt === pred) {
      correctVerdicts++;
    } else {
      let cause = 'model error';
      if (!m.predSources || m.predSources.length === 0) {
        cause = 'bad retrieval (no sources returned)';
      } else if (pred === 'unverified') {
        cause = 'bad retrieval / evidence gap (retrieved sources did not suffice or citations missing)';
      } else if (m.predSources.some(s => s.tier > 2)) {
        cause = 'wrong source tier / unranked domain';
      } else if (m.score < 0.65) {
        cause = 'claim ambiguity / nuance mismatch';
      }

      wrongVerdicts.push({
        reelId: m.reelId,
        gtClaimId: m.gtClaimId,
        claim: m.predText,
        groundTruth: gt,
        predicted: pred,
        cause,
        explanation: m.explanation,
        sourcesRetrieved: m.predSources.map(s => ({ id: s.id, url: s.url, domain: s.domain, tier: s.tier }))
      });
    }
  }

  const accuracy = matchedClaims.length > 0 ? correctVerdicts / matchedClaims.length : 0;
  const verdictResults = {
    sampleSizeMatched: matchedClaims.length,
    correctVerdicts,
    accuracy,
    confusionMatrix,
    wrongVerdicts
  };

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'verdict_accuracy_metrics.json'),
    JSON.stringify(verdictResults, null, 2)
  );
  console.log(`Verdict Accuracy: ${correctVerdicts} of ${matchedClaims.length} (${(accuracy * 100).toFixed(1)}%)`);

  // --- Step 4: Citations Check ---
  console.log('\n--- Step 4: Citations Evaluation ---');
  const citedUrls = [];
  for (const p of pipelineOutputs) {
    for (const c of p.extractedClaims) {
      const citedIds = new Set(c.citedIds || []);
      const sources = c.sources || [];
      for (const s of sources) {
        if (citedIds.has(s.id)) {
          citedUrls.push({
            reelId: p.reelId,
            claimText: c.text,
            verdict: c.verdict,
            url: s.url,
            domain: s.domain,
            tier: s.tier,
            snippet: s.snippet
          });
        }
      }
    }
  }

  console.log(`Checking ${citedUrls.length} cited source URLs...`);
  const citationChecks = [];

  for (const cite of citedUrls) {
    let http200 = false;
    let statusCode = 0;
    let supportsTopic = false;
    let responseText = '';

    try {
      const res = await fetch(cite.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000)
      });
      statusCode = res.status;
      http200 = res.status === 200;
      if (http200) {
        responseText = await res.text();
        const tokens = tokenize(cite.claimText);
        const textLower = responseText.toLowerCase();
        let matches = 0;
        for (const t of tokens) {
          if (textLower.includes(t)) matches++;
        }
        supportsTopic = tokens.length > 0 ? (matches / tokens.length >= 0.35) : false;
      }
    } catch (err) {
      statusCode = 0;
      http200 = false;
      supportsTopic = false;
    }

    citationChecks.push({
      ...cite,
      http200,
      statusCode,
      supportsTopic,
      agentJudgedSupport: supportsTopic ? 'supports' : 'weak/unsupported'
    });
  }

  const http200Count = citationChecks.filter(c => c.http200).length;
  const supportCount = citationChecks.filter(c => c.supportsTopic).length;
  const httpRate = citationChecks.length > 0 ? http200Count / citationChecks.length : 0;
  const supportRate = citationChecks.length > 0 ? supportCount / citationChecks.length : 0;

  // 10 Weakest citation cases
  const weakestCitations = citationChecks
    .filter(c => !c.http200 || !c.supportsTopic)
    .slice(0, 10);
  if (weakestCitations.length < 10) {
    const supportedOnes = citationChecks.filter(c => c.http200 && c.supportsTopic);
    weakestCitations.push(...supportedOnes.slice(0, 10 - weakestCitations.length));
  }

  const citationMetrics = {
    totalCitationsEvaluated: citationChecks.length,
    http200Count,
    http200Rate: httpRate,
    supportCount,
    supportRate,
    weakestCitations,
    allChecks: citationChecks
  };

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'citation_metrics.json'),
    JSON.stringify(citationMetrics, null, 2)
  );
  console.log(`Citations: HTTP 200 = ${http200Count}/${citationChecks.length} (${(httpRate * 100).toFixed(1)}%), Page Support = ${supportCount}/${citationChecks.length} (${(supportRate * 100).toFixed(1)}%)`);

  // --- Step 5: Timestamp Alignment ---
  console.log('\n--- Step 5: Timestamp Alignment ---');
  const timestampErrors = [];
  for (const m of matchedClaims) {
    const error = Math.abs(m.predTimestamp - m.gtTimestamp);
    timestampErrors.push({
      reelId: m.reelId,
      gtClaimId: m.gtClaimId,
      claim: m.gtText,
      gtTimestamp: m.gtTimestamp,
      predTimestamp: m.predTimestamp,
      errorSeconds: error
    });
  }

  const errValues = timestampErrors.map(e => e.errorSeconds);
  const meanError = errValues.length > 0 ? errValues.reduce((a, b) => a + b, 0) / errValues.length : 0;
  const medianError = median(errValues);
  const maxError = errValues.length > 0 ? Math.max(...errValues) : 0;

  const timestampMetrics = {
    sampleSize: timestampErrors.length,
    meanErrorSeconds: meanError,
    medianErrorSeconds: medianError,
    maxErrorSeconds: maxError,
    details: timestampErrors
  };

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'timestamp_metrics.json'),
    JSON.stringify(timestampMetrics, null, 2)
  );
  console.log(`Timestamps (n=${timestampErrors.length}): Mean Error = ${meanError.toFixed(2)}s, Median = ${medianError.toFixed(2)}s, Max = ${maxError.toFixed(2)}s`);

  // --- Step 6: Latency Benchmarking ---
  console.log('\n--- Step 6: Latency Benchmarking (1 warm-up + 5 measured runs per class) ---');
  const latencyClasses = [
    { name: '30s Class (Reel 01)', file: 'reel_01.mp4' },
    { name: '38s Class (Reel 07)', file: 'reel_07.mp4' }
  ];

  const latencyResults = {};

  for (const lc of latencyClasses) {
    console.log(`\nBenchmarking ${lc.name}...`);
    const videoPath = path.join(REELS_DIR, lc.file);

    // Warm-up run
    console.log('  Running 1 warm-up run...');
    await runPipelineForVideo(videoPath, `warmup_${Date.now()}`);

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
      const res = await runPipelineForVideo(videoPath, `latency_${lc.name}_${r}_${Date.now()}`);
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

    latencyResults[lc.name] = {
      frameSamplingRate: '0.5 fps (1 frame every 2 seconds, max 30 frames)',
      summary
    };
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, 'latency_metrics.json'),
    JSON.stringify(latencyResults, null, 2)
  );
  console.log('\n[Saved] eval/results/latency_metrics.json');
  console.log('Latency benchmark complete!');

  console.log('\n=== Evaluation Completed Successfully! ===');
}

main().catch(err => {
  console.error('Fatal Evaluation Error:', err);
  process.exit(1);
});

