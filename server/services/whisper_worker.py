"""
Persistent local Whisper Python worker for CapCatcher.
Loads the model once into memory on CPU.
Communicates with Node.js via stdin/stdout using newline-delimited JSON.

Supports:
1. faster-whisper (CTranslate2, int8, CPU) as primary high-performance engine.
2. transformers/PyTorch pipeline fallback when CTranslate2 native DLLs cannot be
   loaded (e.g., Windows 11 Smart App Control / Code Integrity blocking unsigned DLLs).
Both engines return segments in the EXACT same shape as Groq Whisper:
{
  "text": "...",
  "segments": [
    { "start": 0.0, "end": 3.04, "text": "..." }
  ]
}
"""

import sys
import json
import os
import traceback

def main():
    model_name = os.environ.get("WHISPER_LOCAL_MODEL", "base").strip().lower()
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8").strip().lower()

    sys.stderr.write(f"[LocalWhisper Worker] Initializing model='{model_name}', compute_type='{compute_type}', device='cpu'...\n")
    sys.stderr.flush()

    engine = None
    model_instance = None
    init_warning = None

    # Try faster-whisper first
    try:
        from faster_whisper import WhisperModel
        model_instance = WhisperModel(model_name, device="cpu", compute_type=compute_type)
        engine = "faster-whisper"
        sys.stderr.write(f"[LocalWhisper Worker] Loaded faster-whisper model '{model_name}' (CPU, {compute_type}).\n")
        sys.stderr.flush()
    except Exception as fw_err:
        fw_msg = str(fw_err)
        sys.stderr.write(f"[LocalWhisper Worker] faster-whisper unavailable ({fw_msg}). Attempting PyTorch/Transformers fallback...\n")
        sys.stderr.flush()
        init_warning = f"faster-whisper unavailable: {fw_msg}"

        # Fallback to PyTorch/Transformers
        try:
            from transformers import pipeline
            hf_model_id = f"openai/whisper-{model_name}"
            model_instance = pipeline(
                "automatic-speech-recognition",
                model=hf_model_id,
                device="cpu"
            )
            engine = "transformers"
            sys.stderr.write(f"[LocalWhisper Worker] Loaded HuggingFace Whisper model '{hf_model_id}' (CPU).\n")
            sys.stderr.flush()
        except Exception as pt_err:
            pt_msg = str(pt_err)
            sys.stderr.write(f"[LocalWhisper Worker] PyTorch fallback also failed: {pt_msg}\n")
            sys.stderr.flush()
            sys.stdout.write(json.dumps({
                "status": "init_error",
                "error": f"Failed to initialize local Whisper: faster-whisper error: {fw_msg}; PyTorch error: {pt_msg}",
                "traceback": traceback.format_exc()
            }) + "\n")
            sys.stdout.flush()

    # Inform Node that worker is ready
    sys.stdout.write(json.dumps({
        "status": "ready",
        "engine": engine,
        "model": model_name,
        "warning": init_warning
    }) + "\n")
    sys.stdout.flush()

    # Main request processing loop
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break

            line = line.strip()
            if not line:
                continue

            req = json.loads(line)
            audio_path = req.get("audio_path")

            if model_instance is None:
                sys.stdout.write(json.dumps({
                    "status": "error",
                    "error": "Local Whisper model is not loaded (worker initialization failed)."
                }) + "\n")
                sys.stdout.flush()
                continue

            if not audio_path or not os.path.exists(audio_path):
                sys.stdout.write(json.dumps({
                    "status": "error",
                    "error": f"Audio file not found: {audio_path}"
                }) + "\n")
                sys.stdout.flush()
                continue

            seg_list = []
            full_text = ""

            if engine == "faster-whisper":
                segments, info = model_instance.transcribe(
                    audio_path,
                    beam_size=5,
                    word_timestamps=False,
                    vad_filter=True
                )
                text_parts = []
                for s in segments:
                    cleaned_text = (s.text or "").strip()
                    if cleaned_text:
                        seg_list.append({
                            "start": round(float(s.start), 2),
                            "end": round(float(s.end), 2),
                            "text": cleaned_text
                        })
                        text_parts.append(cleaned_text)
                full_text = " ".join(text_parts).strip()

            elif engine == "transformers":
                result = model_instance(
                    audio_path,
                    return_timestamps=True,
                    generate_kwargs={"language": "en", "task": "transcribe"}
                )
                full_text = (result.get("text") or "").strip()
                chunks = result.get("chunks") or []
                for c in chunks:
                    cleaned_text = (c.get("text") or "").strip()
                    ts = c.get("timestamp") or (0.0, 0.0)
                    start = round(float(ts[0]) if ts[0] is not None else 0.0, 2)
                    end = round(float(ts[1]) if ts[1] is not None else start, 2)
                    if cleaned_text:
                        seg_list.append({
                            "start": start,
                            "end": end,
                            "text": cleaned_text
                        })

            sys.stdout.write(json.dumps({
                "status": "ok",
                "text": full_text,
                "segments": seg_list,
                "engine": engine,
                "model": model_name
            }) + "\n")
            sys.stdout.flush()

        except Exception as e:
            sys.stdout.write(json.dumps({
                "status": "error",
                "error": f"Transcription error: {str(e)}",
                "traceback": traceback.format_exc()
            }) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
