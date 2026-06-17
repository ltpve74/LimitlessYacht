#!/bin/sh
# Start the local dev server from the repo root.
set -e
cd "$(dirname "$0")/.."
exec python3 scripts/dev-server.py "$@"