# GM 받아쓰기 서버 (faster-whisper, 이 서버 안에서만 동작 · 녹음이 밖으로 나가지 않음)
#   POST /transcribe?language=ko   본문: 녹음 파일 그대로, 헤더 X-Prompt: 현장 용어(선택)
#   → { "duration": 초, "segments": [{ "start", "end", "text" }] }
#   GET /health
import json, os, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

MODEL = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
THREADS = int(os.environ.get("WHISPER_THREADS", "0"))
_model, _lock = None, threading.Lock()

def model():
    global _model
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel
            print(f"모델 불러오는 중: {MODEL} ({DEVICE}/{COMPUTE}) — 처음 한 번은 내려받느라 오래 걸립니다", flush=True)
            _model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=THREADS, download_root="/models")
        return _model

class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._send(200, {"ok": True, "model": MODEL, "loaded": _model is not None})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        q = parse_qs(u.query)
        n = int(self.headers.get("Content-Length", "0"))
        if n <= 0 or n > 1024 * 1024 * 1024:
            return self._send(400, {"error": "녹음 파일이 비었거나 너무 큽니다"})
        prompt = unquote(self.headers.get("X-Prompt", ""))[:800] or None
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=True) as f:
            left = n
            while left > 0:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk: break
                f.write(chunk); left -= len(chunk)
            f.flush()
            t0 = time.time()
            try:
                segs, info = model().transcribe(f.name, language=q.get("language", ["ko"])[0], initial_prompt=prompt,
                                                vad_filter=True, beam_size=5, condition_on_previous_text=False)
                out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
            except Exception as e:  # noqa
                return self._send(500, {"error": f"받아쓰기 실패: {e}"})
        print(f"받아쓰기 {info.duration:.0f}초 → {time.time() - t0:.0f}초 걸림, {len(out)}문장", flush=True)
        self._send(200, {"duration": info.duration, "segments": out})

    def log_message(self, *a):
        pass

if __name__ == "__main__":
    print(f"GM 받아쓰기 서버 :9000 (모델 {MODEL})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 9000), H).serve_forever()
