import time
import os
import sys

def benchmark():
    from transformers import pipeline

    audio_path = os.path.abspath('server/uploads/test_worker_audio.wav')
    if not os.path.exists(audio_path):
        print(f"Audio file not found: {audio_path}")
        return

    models = [
        ('openai/whisper-base', 'base'),
        ('openai/whisper-small', 'small')
    ]

    for model_id, name in models:
        print(f"\n==========================================")
        print(f"Benchmarking Whisper '{name}' ({model_id}) on CPU")
        print(f"==========================================")
        
        t0 = time.time()
        pipe = pipeline('automatic-speech-recognition', model=model_id, device='cpu')
        load_time = time.time() - t0
        print(f"Load time: {load_time:.2f}s")

        # First run (warmup + inference)
        t1 = time.time()
        res = pipe(audio_path, return_timestamps=True)
        infer_time = time.time() - t1
        
        chunks = res.get('chunks', [])
        print(f"Inference time (32.7s audio): {infer_time:.2f}s")
        print(f"Real-time factor (RTF): {infer_time / 32.7:.2f}x")
        print(f"Segments detected: {len(chunks)}")
        print(f"Transcript preview: {res.get('text', '').strip()[:140]}...")
        if chunks:
            print("First 2 segments:")
            for c in chunks[:2]:
                print(f"  [{c.get('timestamp')}] {c.get('text', '').strip()}")

if __name__ == '__main__':
    benchmark()
