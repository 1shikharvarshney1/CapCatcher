import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = (apiKey && apiKey !== 'PASTE_KEY_HERE') ? new GoogleGenerativeAI(apiKey) : null;

export async function verifyClaim(claim, sources = []) {
  if (!genAI) {
    return {
      verdict: 'unverified',
      explanation: 'Gemini API key is not configured.',
      citedIds: []
    };
  }

  if (!sources || sources.length === 0) {
    return {
      verdict: 'unverified',
      explanation: 'No sources available to verify this claim.',
      citedIds: []
    };
  }

  const sourceListText = sources
    .map(s => `[${s.id}] Title: ${s.title || 'Untitled'}\nURL: ${s.url}\nDomain: ${s.domain} (Tier ${s.tier})\nEvidence: ${s.snippet || 'None'}`)
    .join('\n\n');

  const prompt = `You are a fact-checking verification model.
Evaluate the claim below using ONLY the provided sources. Do NOT use outside knowledge or unstated assumptions.

Claim: "${claim}"

Available Sources:
${sourceListText}

Verification Rules:
1. Base your determination solely on evidence provided in the sources above.
2. If the provided sources are insufficient or do not directly confirm or contradict the claim, set verdict to "unverified".
3. Valid verdicts are strictly: "true", "false", "misleading", "unverified".
4. In "citedIds", include an array of source IDs (e.g. ["S1", "S2"]) that provide the evidence for your verdict.
5. In "explanation", provide a concise 1-2 sentence explanation summarizing why the evidence supports this verdict.

Respond ONLY with a JSON object in this format:
{
  "verdict": "true" | "false" | "misleading" | "unverified",
  "explanation": "concise explanation",
  "citedIds": ["S1"]
}`;

  try {
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1
      }
    });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      const cleanJson = responseText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      parsed = JSON.parse(cleanJson);
    }

    let verdict = String(parsed?.verdict || 'unverified').toLowerCase();
    const validVerdicts = ['true', 'false', 'misleading', 'unverified'];
    if (!validVerdicts.includes(verdict)) {
      verdict = 'unverified';
    }

    const explanation = String(parsed?.explanation || 'No explanation provided.');
    const rawCited = Array.isArray(parsed?.citedIds) ? parsed.citedIds : [];
    const citedIds = rawCited.map(String).filter(Boolean);

    // Code check: every citedId must exist in the provided sources
    const retrievedIds = new Set(sources.map(s => s.id));
    const allCitedExist = citedIds.length > 0
      ? citedIds.every(id => retrievedIds.has(id))
      : (verdict === 'unverified');

    if (!allCitedExist) {
      verdict = 'unverified';
    }

    return {
      verdict,
      explanation,
      citedIds
    };
  } catch (err) {
    console.warn('[Verify] Claim verification failed:', err.message);
    return {
      verdict: 'unverified',
      explanation: 'Error verifying claim with sources.',
      citedIds: []
    };
  }
}
