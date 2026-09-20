#!/usr/bin/env bash
# Rebuild the reviewed corpus and train with the best completed 48-context setup.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

model_python=.venv/bin/python
integrate=(
  "$model_python" -m harmony_model integrate-corpora
  --processed-root data/processed
  --output-dir data/processed/integrated-public-v1
  --publication-policy datasets/publication_corpus_v1.json
)
train=(
  "$model_python" -m harmony_model train-transformer
  --corpus-manifest data/processed/integrated-public-v1/corpus_manifest.json
  --candidate-manifest datasets/chordscape_candidates.v1.json
  --output-root runs/transformer
  --context 48 --dropout 0.2 --d-model 128 --layers 4 --heads 4
  --batch-size 64 --weight-decay 0.01 --seed 42 --device auto
  --learning-rate 0.0003 --epochs 24 --patience 5
  --lr-schedule plateau --lr-factor 0.5 --lr-patience 1
  --lr-threshold 0.0001 --min-learning-rate 0.00001
)

if [[ "${1:-}" == --dry-run && $# == 1 ]]; then
  printf '%q ' "${integrate[@]}"
  printf '\n'
  printf '%q ' "${train[@]}"
  printf '\n'
  exit 0
fi
if (($#)); then
  echo "usage: bash scripts/run_publication_training.sh [--dry-run]" >&2
  exit 2
fi
if [[ ! -x "$model_python" ]]; then
  echo "Missing .venv/bin/python; run: uv sync --extra train --locked --python 3.12" >&2
  exit 2
fi

"${integrate[@]}"
"${train[@]}"
