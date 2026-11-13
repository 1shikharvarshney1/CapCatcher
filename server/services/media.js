import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import path from 'path';
import fs from 'fs';

ffmpeg.setFfmpegPath(ffmpegStatic);

export function extractAudio(videoPath, jobId) {
  const audioPath = path.join('uploads', `${jobId}_audio.wav`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .audioChannels(1)
      .audioFrequency(16000)
      .output(audioPath)
      .on('end', () => resolve(audioPath))
      .on('error', reject)
      .run();
  });
}

export function extractFrames(videoPath, jobId) {
  const framesDir = path.join('uploads', 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const pattern = path.join(framesDir, `${jobId}_frame_%03d.jpg`);
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(['-vf', 'fps=0.5', '-vframes', '30'])
      .output(pattern)
      .on('end', () => {
        const files = fs.readdirSync(framesDir)
          .filter(f => f.startsWith(`${jobId}_frame_`))
          .map(f => path.join(framesDir, f))
          .sort();
        resolve(files);
      })
      .on('error', reject)
      .run();
  });
}
