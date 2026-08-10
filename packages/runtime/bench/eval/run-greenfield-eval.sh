#!/usr/bin/env bash
# Grade greenfield predictions locally (no Docker) using cached fixture scaffolds.
set -euo pipefail
EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "${EVAL_DIR}/.." && pwd)"
cd "${BENCH_DIR}/.."
pnpm exec tsx bench/src/eval-greenfield.ts "$@"
