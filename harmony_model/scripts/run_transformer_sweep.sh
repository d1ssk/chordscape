#!/usr/bin/env bash
# Run a controlled first sweep. Every run uses the same split, seed, model,
# and plateau scheduler; only the named parameter changes.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

dry_run=0
start_at=1
while (($#)); do
  case "$1" in
    --dry-run)
      dry_run=1
      shift
      ;;
    --from)
      if (($# < 2)); then
        echo "--from requires a run number from 1 to 5" >&2
        exit 2
      fi
      start_at="$2"
      shift 2
      ;;
    *)
      echo "usage: bash scripts/run_transformer_sweep.sh [--dry-run] [--from 1-5]" >&2
      exit 2
      ;;
  esac
done
if [[ ! "$start_at" =~ ^[1-5]$ ]]; then
  echo "--from requires a run number from 1 to 5" >&2
  exit 2
fi

common=(
  .venv/bin/python -m harmony_model train-transformer
  --corpus-manifest data/processed/integrated-v1/corpus_manifest.json
  --candidate-manifest datasets/chordscape_candidates.v1.json
  --output-root runs/transformer
  --d-model 128 --layers 4 --heads 4 --batch-size 64
  --weight-decay 0.01 --seed 42 --device auto
  --epochs 12 --patience 5
  --lr-schedule plateau --lr-factor 0.5 --lr-patience 1
  --lr-threshold 0.0001 --min-learning-rate 0.00001
)

if ((dry_run == 0)); then
  if [[ ! -x .venv/bin/python ]]; then
    echo "Missing .venv/bin/python; run: uv sync --extra train --locked --python 3.12" >&2
    exit 2
  fi
  mkdir -p runs/transformer/experiment-logs
  log_dir="runs/transformer/experiment-logs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir "$log_dir"
  echo "Log directory: $log_dir"
fi

run_one() {
  local number="$1"
  local name="$2"
  shift 2
  if ((number < start_at)); then
    return
  fi
  local command=("${common[@]}" "$@")
  if ((dry_run)); then
    printf '[%s] ' "$name"
    printf '%q ' "${command[@]}"
    printf '\n'
  else
    {
      printf '[%s] ' "$name"
      printf '%q ' "${command[@]}"
      printf '\n'
      "${command[@]}"
    } 2>&1 | tee "$log_dir/$name.log"
  fi
}

run_one 1 01-context32-plateau --context 32 --learning-rate 0.0003 --dropout 0.1
run_one 2 02-context16-plateau --context 16 --learning-rate 0.0003 --dropout 0.1
run_one 3 03-context24-plateau --context 24 --learning-rate 0.0003 --dropout 0.1
run_one 4 04-context32-lr2e4 --context 32 --learning-rate 0.0002 --dropout 0.1
run_one 5 05-context32-dropout02 --context 32 --learning-rate 0.0003 --dropout 0.2
