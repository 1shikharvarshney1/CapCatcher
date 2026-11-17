import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = path.join(__dirname, 'whisper_worker.py');

let workerProcess = null;
let rl = null;
let currentRequest = null;
const requestQueue = [];
let isStarting = false;
let initError = null;

function startWorker() {
  if (workerProcess || isStarting) return;
  isStarting = true;
  initError = null;

  const model = process.env.WHISPER_LOCAL_MODEL || 'base';
  const computeType = process.env.WHISPER_COMPUTE_TYPE || 'int8';

  const env = {
    ...process.env,
    WHISPER_LOCAL_MODEL: model,
    WHISPER_COMPUTE_TYPE: computeType,
    PYTHONUNBUFFERED: '1'
  };

  workerProcess = spawn('python', ['-u', WORKER_SCRIPT], {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  workerProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[LocalWhisper] ${msg}`);
  });

  rl = readline.createInterface({
    input: workerProcess.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;

    try {
      const parsed = JSON.parse(line);
      if (parsed.status === 'ready') {
        console.log(`[LocalWhisper] Worker ready using engine='${parsed.engine}', model='${parsed.model}'`);
        if (parsed.warning) {
          console.warn(`[LocalWhisper] Worker warning: ${parsed.warning}`);
        }
        return;
      }

      if (parsed.status === 'init_error') {
        initError = new Error(`Local Whisper worker initialization failed: ${parsed.error}`);
        if (currentRequest) {
          currentRequest.reject(initError);
          currentRequest = null;
        }
        processNext();
        return;
      }

      if (currentRequest) {
        if (parsed.status === 'ok') {
          currentRequest.resolve({
            text: parsed.text || '',
            segments: Array.isArray(parsed.segments) ? parsed.segments : []
          });
        } else {
          currentRequest.reject(new Error(parsed.error || 'Local Whisper transcription failed'));
        }
        currentRequest = null;
      }
    } catch (err) {
      if (currentRequest) {
        currentRequest.reject(new Error(`Failed to parse worker response: ${err.message}`));
        currentRequest = null;
      }
    }

    processNext();
  });

  workerProcess.on('exit', (code, signal) => {
    console.warn(`[LocalWhisper] Worker exited with code ${code}, signal ${signal}`);
    workerProcess = null;
    rl = null;
    isStarting = false;

    if (currentRequest) {
      const err = initError || new Error(`Local Whisper worker terminated unexpectedly (exit code ${code})`);
      currentRequest.reject(err);
      currentRequest = null;
    }

    // Flush any pending requests in queue
    while (requestQueue.length > 0) {
      const item = requestQueue.shift();
      item.reject(new Error(`Local Whisper worker unavailable (exit code ${code})`));
    }
  });

  workerProcess.on('error', (err) => {
    console.error('[LocalWhisper] Process spawn error:', err.message);
    initError = err;
    if (currentRequest) {
      currentRequest.reject(err);
      currentRequest = null;
    }
  });

  isStarting = false;
}

function processNext() {
  if (currentRequest || requestQueue.length === 0) return;
  if (!workerProcess) startWorker();

  currentRequest = requestQueue.shift();
  try {
    const payload = JSON.stringify({ audio_path: currentRequest.audioPath }) + '\n';
    workerProcess.stdin.write(payload);
  } catch (err) {
    currentRequest.reject(err);
    currentRequest = null;
    processNext();
  }
}

export function transcribeLocalAudio(audioPath) {
  return new Promise((resolve, reject) => {
    const absoluteAudioPath = path.resolve(audioPath);
    requestQueue.push({ audioPath: absoluteAudioPath, resolve, reject });
    if (!currentRequest) {
      processNext();
    }
  });
}

export function shutdownLocalWorker() {
  if (workerProcess) {
    try {
      workerProcess.stdin.end();
      workerProcess.kill('SIGTERM');
    } catch {}
    workerProcess = null;
    rl = null;
  }
}
