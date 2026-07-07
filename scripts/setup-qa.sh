#!/bin/sh
# Optional setup for manual UX / Lighthouse checks (not run on publish).
set -e
cd "$(dirname "$0")/.."

if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
  PIP=".venv/bin/pip"
else
  python3 -m venv .venv
  PY=".venv/bin/python"
  PIP=".venv/bin/pip"
fi

"$PIP" install -r scripts/dev-requirements.txt
"$PY" -m playwright install chromium

if command -v npm >/dev/null 2>&1; then
  npm install --prefix scripts
else
  echo "npm not found — install Node.js for Lighthouse checks." >&2
  exit 1
fi

echo "Optional QA tooling ready."
echo "  Publish gate:        $PY scripts/publish-gate.py"
echo "  + UX smoke:          $PY scripts/publish-gate.py --with-ux"
echo "  + Lighthouse:        $PY scripts/publish-gate.py --with-lighthouse"