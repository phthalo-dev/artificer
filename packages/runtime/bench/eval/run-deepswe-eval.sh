#!/usr/bin/env bash
# Grade DeepSWE predictions in Docker using cached Harbor task metadata.
set -euo pipefail
EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "${EVAL_DIR}/.." && pwd)"
cd "${BENCH_DIR}/.."
pnpm exec tsx bench/src/eval-deepswe.ts "$@"
