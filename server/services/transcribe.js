import Groq from 'groq-sdk';
import fs from 'fs';
import dotenv from 'dotenv';
import { transcribeLocalAudio } from './local_whisper.js';

dotenv.config();

let groqClient = null;
function getGroqClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY environment variable is required for Groq Whisper transcription.');
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

export async function transcribeAudioGroq(audioPath) {
  const groq = getGroqClient();
  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });

  return {
    text: response.text || '',
    segments: Array.isArray(response.segments)
      ? response.segments.map(s => ({
          start: typeof s.start === 'number' ? s.start : 0,
          end: typeof s.end === 'number' ? s.end : 0,
          text: (s.text || '').trim()
        }))
      : []
  };
}

export async function transcribeAudio(audioPath) {
  const provider = (process.env.WHISPER_PROVIDER || 'local').toLowerCase().trim();

  if (provider === 'groq') {
    return await transcribeAudioGroq(audioPath);
  }

  // Default: local faster-whisper worker
  return await transcribeLocalAudio(audioPath);
}

export { transcribeLocalAudio };
