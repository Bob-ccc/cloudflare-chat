#!/usr/bin/env python3
"""本地静态服务 + API 代理。用法: python3 proxy_server.py"""

from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


SSL_CONTEXT = _ssl_context()
PORT = int(os.getenv("PORT", "8765"))
UPSTREAM = os.getenv(
    "UPSTREAM_BASE", "https://easy.bangdao-tech.com/sub2api"
).rstrip("/")
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _origin(self) -> str:
        return self.headers.get("Origin") or "*"

    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", self._origin())
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Authorization, Content-Type, X-Upstream-Base"
        )
        self.send_header("Access-Control-Max-Age", "86400")

    def do_OPTIONS(self):
        if self.path.startswith("/v1/"):
            self.send_response(204)
            self._send_cors()
            self.end_headers()
            return
        super().do_OPTIONS()

    def do_POST(self):
        if self.path.startswith("/v1/"):
            self._proxy()
            return
        super().do_POST()

    def do_GET(self):
        if self.path.startswith("/v1/"):
            self._proxy()
            return
        super().do_GET()

    def _proxy(self):
        upstream_base = (self.headers.get("X-Upstream-Base") or UPSTREAM).rstrip("/")
        path = self.path
        if upstream_base.endswith("/v1") and path.startswith("/v1/"):
            path = path[3:]
        upstream_url = f"{upstream_base}{path}"
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        headers = {}
        if auth := self.headers.get("Authorization"):
            headers["Authorization"] = auth
        if ctype := self.headers.get("Content-Type"):
            headers["Content-Type"] = ctype

        req = urllib.request.Request(
            upstream_url, data=body, headers=headers, method=self.command
        )
        try:
            with urllib.request.urlopen(req, timeout=600, context=SSL_CONTEXT) as resp:
                content_type = resp.headers.get("Content-Type", "application/json")
                self.send_response(resp.status)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-cache")
                self.send_header("X-Accel-Buffering", "no")
                self._send_cors()
                self.end_headers()
                if "text/event-stream" in content_type.lower():
                    for line in resp:
                        self.wfile.write(line)
                        self.wfile.flush()
                else:
                    while True:
                        chunk = resp.read(8192)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                return
        except urllib.error.HTTPError as e:
            data = e.read()
            status = e.code
            content_type = e.headers.get("Content-Type", "application/json")
        except Exception as e:
            payload = json.dumps({"error": {"message": str(e)}}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self._send_cors()
            self.end_headers()
            self.wfile.write(payload)
            return

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-cache")
        self._send_cors()
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"http://127.0.0.1:{PORT}  Base URL: http://127.0.0.1:{PORT}/v1")
    server.serve_forever()


if __name__ == "__main__":
    main()
