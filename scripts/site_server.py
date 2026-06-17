#!/usr/bin/env python3
"""Serve the static site from a chosen directory for local QA checks."""

from __future__ import annotations

import contextlib
import os
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A003
        pass


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def serve_site(root: str, port: int | None = None):
    root = os.path.abspath(root)
    chosen = port or free_port()
    server = HTTPServer(("127.0.0.1", chosen), _QuietHandler)

    def _run() -> None:
        os.chdir(root)
        server.serve_forever(poll_interval=0.05)

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{chosen}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)