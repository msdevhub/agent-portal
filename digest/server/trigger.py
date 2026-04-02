#!/usr/bin/env python3
"""
HTTP trigger server for the Digest pipeline.

The portal's "Refresh" button POSTs here to kick off a pipeline run.

Port: 18790 (override with TRIGGER_PORT env var)
Endpoints:
  POST /api/refresh  — trigger a full pipeline run
  GET  /api/status   — last run status
  GET  /health       — liveness probe
"""

import json
import os
import subprocess
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone, timedelta

TZ_SHANGHAI = timezone(timedelta(hours=8))
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("TRIGGER_PORT", "18790"))

# Global state
_state = {
    "running": False,
    "last_run": None,
    "last_exit_code": None,
    "last_duration": None,
    "last_error": None,
}
_lock = threading.Lock()


def run_pipeline():
    global _state
    with _lock:
        if _state["running"]:
            return False
        _state["running"] = True

    start = time.time()
    date_str = datetime.now(TZ_SHANGHAI).strftime("%Y-%m-%d")
    try:
        result = subprocess.run(
            [sys.executable, "digest.py", "--date", date_str],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=300,
        )
        with _lock:
            _state["running"] = False
            _state["last_run"] = datetime.now(TZ_SHANGHAI).isoformat()
            _state["last_exit_code"] = result.returncode
            _state["last_duration"] = round(time.time() - start, 1)
            _state["last_error"] = result.stderr[-500:] if result.returncode != 0 else None
    except Exception as e:
        with _lock:
            _state["running"] = False
            _state["last_run"] = datetime.now(TZ_SHANGHAI).isoformat()
            _state["last_exit_code"] = -1
            _state["last_duration"] = round(time.time() - start, 1)
            _state["last_error"] = str(e)
    return True


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/refresh":
            with _lock:
                if _state["running"]:
                    self.send_response(409)
                    self._cors()
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "ok": False,
                        "message": "Pipeline 正在运行中，请稍后再试",
                    }).encode())
                    return

            t = threading.Thread(target=run_pipeline, daemon=True)
            t.start()

            self.send_response(202)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "message": "Pipeline 已触发，预计 1-3 分钟完成",
            }).encode())
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def do_GET(self):
        if self.path == "/api/status":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            with _lock:
                self.wfile.write(json.dumps(_state).encode())
        elif self.path == "/health":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()

    def log_message(self, fmt, *args):
        ts = datetime.now(TZ_SHANGHAI).strftime("%H:%M:%S")
        print(f"[{ts}] {args[0]}")


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"🚀 Digest Trigger Server listening on :{PORT}")
    print(f"   POST /api/refresh  — trigger pipeline")
    print(f"   GET  /api/status   — last run status")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n⏹ Server stopped")
