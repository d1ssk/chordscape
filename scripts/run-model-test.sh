#!/usr/bin/env bash
# Start the loopback checkpoint API and Vite's local preview page together.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ ! -x harmony_model/.venv/bin/python ]]; then
  echo "Missing harmony_model/.venv; run uv sync --extra train --locked --python 3.12 in harmony_model" >&2
  exit 2
fi

(cd harmony_model && exec .venv/bin/python -m harmony_model.preview_server) &
api_pid=$!
cleanup() {
  kill "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT

echo "Open the Vite URL followed by /model-test.html (usually http://127.0.0.1:5173/model-test.html)"
npm run dev -- --strictPort
