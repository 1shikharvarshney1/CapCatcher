import Groq from 'groq-sdk';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function transcribeAudio(audioPath) {
  const response = await groq.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment']
  });
  return response; // { text, segments: [{start, end, text}] }
}
