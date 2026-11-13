import { createWorker } from 'tesseract.js';
import path from 'path';

function normalizeLine(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, Math.min(prev + 1, row[j] + 1));
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

function isNearDuplicate(line1, line2, threshold = 0.8) {
  const n1 = normalizeLine(line1);
  const n2 = normalizeLine(line2);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  if (n1.includes(n2) || n2.includes(n1)) {
    const minLen = Math.min(n1.length, n2.length);
    const maxLen = Math.max(n1.length, n2.length);
    if (minLen / maxLen >= threshold) return true;
  }

  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return true;
  const dist = levenshteinDistance(n1, n2);
  const similarity = 1 - (dist / maxLen);
  return similarity >= threshold;
}

function isValidOcrLine(text, confidence) {
  // Tesseract confidence is 70 or higher
  if (typeof confidence !== 'number' || confidence < 70) {
    return false;
  }

  if (!text || typeof text !== 'string') {
    return false;
  }

  const trimmed = text.trim();

  // length is at least 8 characters
  if (trimmed.length < 8) {
    return false;
  }

  // at least 70% of its characters are letters or digits
  const alnumMatches = trimmed.match(/[a-zA-Z0-9]/g) || [];
  if (alnumMatches.length / trimmed.length < 0.7) {
    return false;
  }

  // it contains at least one word of 3+ letters
  if (!/[a-zA-Z]{3,}/.test(trimmed)) {
    return false;
  }

  return true;
}

export async function runOCR(framePaths = []) {
  if (!framePaths || framePaths.length === 0) {
    return [];
  }

  console.log(`[OCR] Starting OCR on ${framePaths.length} frames`);
  const worker = await createWorker('eng');
  const uniqueLines = []; // [{ text, timestamp }]

  // Sort frames chronologically by extracted index
  const sortedFramePaths = [...framePaths].sort((a, b) => {
    const matchA = path.basename(a).match(/_frame_(\d+)\.jpg$/i);
    const matchB = path.basename(b).match(/_frame_(\d+)\.jpg$/i);
    const idxA = matchA ? parseInt(matchA[1], 10) : 0;
    const idxB = matchB ? parseInt(matchB[1], 10) : 0;
    return idxA - idxB;
  });

  try {
    for (let i = 0; i < sortedFramePaths.length; i++) {
      const framePath = sortedFramePaths[i];

      // Extract timestamp: frame pattern %03d at fps=0.5 (one frame every 2 seconds)
      const match = path.basename(framePath).match(/_frame_(\d+)\.jpg$/i);
      const frameIndex = match ? parseInt(match[1], 10) - 1 : i;
      const timestamp = Math.max(0, frameIndex * 2.0);

      try {
        const { data } = await worker.recognize(framePath);

        // Extract lines with their confidence scores
        const rawLines = [];
        if (Array.isArray(data?.lines) && data.lines.length > 0) {
          for (const lineObj of data.lines) {
            const raw = (lineObj.text || '').replace(/[\r\n]+/g, ' ').trim();
            const conf = typeof lineObj.confidence === 'number'
              ? lineObj.confidence
              : (typeof data.confidence === 'number' ? data.confidence : 0);
            if (raw) {
              rawLines.push({ text: raw, confidence: conf });
            }
          }
        } else if (data?.text) {
          const defaultConf = typeof data.confidence === 'number' ? data.confidence : 0;
          for (const raw of data.text.split(/\r?\n/)) {
            const trimmed = raw.trim();
            if (trimmed) {
              rawLines.push({ text: trimmed, confidence: defaultConf });
            }
          }
        }

        for (const { text, confidence } of rawLines) {
          if (!isValidOcrLine(text, confidence)) {
            continue;
          }

          // Dedupe near-identical lines across frames and keep the earliest timestamp
          const existingIndex = uniqueLines.findIndex(prev => isNearDuplicate(prev.text, text));
          if (existingIndex === -1) {
            uniqueLines.push({ text, timestamp });
          } else if (timestamp < uniqueLines[existingIndex].timestamp) {
            uniqueLines[existingIndex].timestamp = timestamp;
          }
        }
      } catch (err) {
        console.warn(`[OCR] Failed recognizing frame ${framePath}:`, err.message);
      }
    }
  } finally {
    await worker.terminate();
  }

  // Format with earliest timestamps: "[0.0s] Extracted text"
  uniqueLines.sort((a, b) => a.timestamp - b.timestamp);
  const formatted = uniqueLines.map(item => `[${item.timestamp.toFixed(1)}s] ${item.text}`);
  console.log(`[OCR] Completed. Found ${formatted.length} unique text lines`);
  return formatted;
}
