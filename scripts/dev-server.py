#!/usr/bin/env python3
"""Local static server for daily development (no GitHub Pages wait).

Serves the repo root with the same /api/availability path the site expects.
Analytics are suppressed automatically on localhost via js/analytics-env.js.

Usage:
  python3 scripts/dev-server.py
  python3 scripts/dev-server.py --port 8765
  python3 scripts/serve.sh
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from site_server import free_port  # noqa: E402

AVAILABILITY_STUB = {
    "booked": [],
    "tentative": [],
    "note": "local dev server — calendar shows all dates available",
}
AVAILABILITY_PROXY_URL = os.environ.get(
    "LY_AVAILABILITY_PROXY",
    "https://limitlessyachtcharter.com/api/availability",
)


class DevSiteHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        if os.environ.get("DEV_SERVER_QUIET"):
            return
        sys.stdout.write(
            f"[dev] {self.address_string()} {format % args}\n"
        )
        sys.stdout.flush()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/availability":
            payload = AVAILABILITY_STUB
            try:
                with urllib.request.urlopen(AVAILABILITY_PROXY_URL, timeout=8) as res:
                    if 200 <= res.status < 300:
                        payload = json.loads(res.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
                pass
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Limitless site locally")
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port to bind (default: 8765)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1)",
    )
    args = parser.parse_args()

    os.chdir(ROOT)
    port = args.port
    server = None
    for attempt in range(2):
        try:
            server = HTTPServer((args.host, port), DevSiteHandler)
            break
        except OSError as exc:
            if attempt == 0 and port == args.port:
                fallback = free_port()
                print(
                    f"Port {port} busy ({exc}) — trying {fallback} instead.",
                    file=sys.stderr,
                )
                port = fallback
                continue
            print(f"dev-server: could not bind {args.host}:{port} — {exc}", file=sys.stderr)
            return 1
    if server is None:
        return 1

    url = f"http://{args.host}:{port}/"
    print("Limitless local dev server")
    print(f"  EN:  {url}")
    print(f"  DE:  {url}de/")
    print(f"  FR:  {url}fr/")
    print(f"  ES:  {url}es/")
    print("  Analytics suppressed on localhost. Ctrl+C to stop.")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nStopping…")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())