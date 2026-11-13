// Dedicated Citation Evaluator
// Evaluates all citations cited by the model across all benchmark runs
// Checks HTTP 200 resolution and page content topical support

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawOutputPath = path.join(__dirname, 'results/raw_pipeline_output.json');
const resultsPath = path.join(__dirname, 'results/citation_metrics.json');

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

async function runCitationEvaluation() {
  const rawOutputs = JSON.parse(fs.readFileSync(rawOutputPath, 'utf-8'));
  const citedUrls = [];

  for (const p of rawOutputs) {
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

  console.log(`Evaluating ${citedUrls.length} model-cited URLs...`);
  const citationChecks = [];

  for (let i = 0; i < citedUrls.length; i++) {
    const cite = citedUrls[i];
    let http200 = false;
    let statusCode = 0;
    let supportsTopic = false;
    let errorMsg = null;

    try {
      const res = await fetch(cite.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(6000)
      });
      statusCode = res.status;
      http200 = res.status === 200;
      if (http200) {
        const text = await res.text();
        const textLower = text.toLowerCase();
        const tokens = tokenize(cite.claimText);
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
      errorMsg = err.message;
    }

    citationChecks.push({
      ...cite,
      http200,
      statusCode,
      supportsTopic,
      agentJudgedSupport: supportsTopic ? 'supports' : 'weak/unsupported',
      error: errorMsg
    });

    if ((i + 1) % 10 === 0 || i === citedUrls.length - 1) {
      console.log(`  Processed ${i + 1}/${citedUrls.length}...`);
    }
  }

  const http200Count = citationChecks.filter(c => c.http200).length;
  const supportCount = citationChecks.filter(c => c.supportsTopic).length;
  const http200Rate = citationChecks.length > 0 ? http200Count / citationChecks.length : 0;
  const supportRate = citationChecks.length > 0 ? supportCount / citationChecks.length : 0;

  // Identify 10 weakest citation cases
  const weakestCitations = citationChecks
    .filter(c => !c.http200 || !c.supportsTopic)
    .slice(0, 10);
  if (weakestCitations.length < 10) {
    const remaining = citationChecks.filter(c => c.http200 && c.supportsTopic);
    weakestCitations.push(...remaining.slice(0, 10 - weakestCitations.length));
  }

  const summary = {
    sampleSize: citationChecks.length,
    http200Count,
    http200Rate,
    supportCount,
    supportRate,
    weakestCitations,
    details: citationChecks
  };

  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2));
  console.log(`\nCitation Metrics Results:`);
  console.log(`  Total Cited URLs (n): ${citationChecks.length}`);
  console.log(`  Resolves HTTP 200: ${http200Count}/${citationChecks.length} (${(http200Rate * 100).toFixed(1)}%)`);
  console.log(`  Topic & Verdict Support (Agent-Judged): ${supportCount}/${citationChecks.length} (${(supportRate * 100).toFixed(1)}%)`);
}

runCitationEvaluation().catch(console.error);

