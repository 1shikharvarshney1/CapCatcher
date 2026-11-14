import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export async function extractClaims(transcript, ocrText = [], segments = []) {
  if (!genAI) {
    console.warn('[Claims] GEMINI_API_KEY is not configured');
    return [];
  }

  // Handle case where transcript is an object with { text, segments }
  let transcriptText = '';
  let transcriptSegments = segments;
  if (typeof transcript === 'object' && transcript !== null) {
    transcriptText = transcript.text || '';
    if (!transcriptSegments || transcriptSegments.length === 0) {
      transcriptSegments = transcript.segments || [];
    }
  } else {
    transcriptText = transcript || '';
  }

  const ocrList = Array.isArray(ocrText) ? ocrText.filter(Boolean) : (ocrText ? [String(ocrText)] : []);

  if (!transcriptText && ocrList.length === 0) {
    return [];
  }

  let speechSection = transcriptText;
  if (transcriptSegments && transcriptSegments.length > 0) {
    speechSection = transcriptSegments
      .map(s => `[${typeof s.start === 'number' ? s.start.toFixed(1) : '0.0'}s] ${s.text || ''}`.trim())
      .join('\n');
  }

  const hasOcr = ocrList.length > 0;

  const prompt = hasOcr
    ? `You are a fact-checking claim extraction assistant.
Analyze the video content below (speech transcript and on-screen OCR text) and extract all verifiable factual claims.

Extraction Guidelines:
1. Extract checkable factual assertions (statements concerning science, history, health, public figures, statistics, or events).
2. Exclude personal opinions, subjective beliefs, greetings, jokes, questions, or vague conversational phrases.
3. For each claim identify:
   - "text": Standalone, concise statement of the factual claim.
   - "timestamp": Start time in seconds (number, e.g. 4.2) where the claim is spoken/shown. If unknown, use 0.
   - "origin": "speech" (if spoken in audio) or "screen" (if from on-screen OCR text).
4. If a claim appears in on-screen text, set "origin" to "screen". If spoken in the transcript, set "origin" to "speech".
5. If no verifiable factual claims are made, return an empty array [].

Video Speech Transcript:
${speechSection || '(None)'}

On-Screen OCR Text:
${ocrList.join('\n')}

Respond ONLY with a JSON array in this exact schema:
[
  {
    "text": "Factual claim statement",
    "timestamp": 0.0,
    "origin": "speech"
  }
]`
    : `You are a fact-checking claim extraction assistant.
Analyze the video speech transcript below and extract all verifiable factual claims.

Extraction Guidelines:
1. Extract checkable factual assertions (statements concerning science, history, health, public figures, statistics, or events).
2. Exclude personal opinions, subjective beliefs, greetings, jokes, questions, or vague conversational phrases.
3. For each claim identify:
   - "text": Standalone, concise statement of the factual claim.
   - "timestamp": Start time in seconds (number, e.g. 4.2) where the claim is spoken. If unknown, use 0.
   - "origin": "speech"
4. If no verifiable factual claims are made, return an empty array [].

Video Speech Transcript:
${speechSection || '(None)'}

Respond ONLY with a JSON array in this exact schema:
[
  {
    "text": "Factual claim statement",
    "timestamp": 0.0,
    "origin": "speech"
  }
]`;

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

    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.claims) ? parsed.claims : []);

    return items
      .map(item => {
        const text = String(item.text || '').trim();
        let origin = item.origin === 'screen' ? 'screen' : 'speech';

        const hasSpeech = Boolean(speechSection && speechSection !== '(None)');
        if (!hasSpeech && ocrList.length > 0) {
          origin = 'screen';
        } else if (origin !== 'screen' && ocrList.length > 0) {
          const lowerText = text.toLowerCase();
          const cleanSpeech = (speechSection || '').toLowerCase();
          const matchesOcr = ocrList.some(line => {
            const cleanLine = line.replace(/^\[\d+(\.\d+)?s\]\s*/i, '').toLowerCase();
            return cleanLine.includes(lowerText) || lowerText.includes(cleanLine);
          });
          const matchesSpeech = cleanSpeech.includes(lowerText);
          if (matchesOcr && !matchesSpeech) {
            origin = 'screen';
          }
        }

        return {
          text,
          timestamp: typeof item.timestamp === 'number' ? item.timestamp : (parseFloat(item.timestamp) || 0),
          origin
        };
      })
      .filter(item => Boolean(item.text));
  } catch (err) {
    console.error('[Claims] Error extracting claims:', err.message);
    return [];
  }
}
