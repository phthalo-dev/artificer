#!/usr/bin/env bash
# Grade the benchmark predictions with the official SWE-bench harness.
#
# Prerequisites:
#   - Docker daemon running
#   - Python env with `swebench` installed (see requirements.txt)
#
# Usage:
#   bash bench/eval/run-eval.sh
#
# Environment overrides:
#   DATASET      HF dataset name        (default: princeton-nlp/SWE-bench_Lite)
#   SPLIT        dataset split          (default: test)
#   RUN_ID       evaluation run id      (default: artificer-bench)
#   MAX_WORKERS  parallel eval workers  (default: 4)
#   PYTHON       python executable      (default: python)
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "${EVAL_DIR}/.." && pwd)"
RESULTS_DIR="${RESULTS_DIR:-${BENCH_DIR}/results}"
PREDICTIONS="${PREDICTIONS:-${RESULTS_DIR}/predictions.jsonl}"

DATASET="${DATASET:-princeton-nlp/SWE-bench_Lite}"
SPLIT="${SPLIT:-test}"
RUN_ID="${RUN_ID:-artificer-bench}"
MAX_WORKERS="${MAX_WORKERS:-4}"
PYTHON="${PYTHON:-python}"

if [ ! -f "${PREDICTIONS}" ]; then
  echo "error: predictions not found at ${PREDICTIONS} (run \`pnpm bench\` first)" >&2
  exit 1
fi

echo "[eval] dataset=${DATASET} split=${SPLIT} run_id=${RUN_ID}"
echo "[eval] predictions=${PREDICTIONS}"

# The harness writes <model_name_or_path>.<run_id>.json into the cwd, plus
# per-instance logs under logs/run_evaluation/<run_id>/. Run from RESULTS_DIR
# so all artifacts collect there.
cd "${RESULTS_DIR}"

"${PYTHON}" -m swebench.harness.run_evaluation \
  --dataset_name "${DATASET}" \
  --split "${SPLIT}" \
  --predictions_path "${PREDICTIONS}" \
  --run_id "${RUN_ID}" \
  --max_workers "${MAX_WORKERS}"

# Locate the report file the harness just produced and normalize its name so
# the report generator can find it deterministically.
REPORT_FILE="$(ls -t "${RESULTS_DIR}"/*."${RUN_ID}".json 2>/dev/null | head -n1 || true)"
if [ -n "${REPORT_FILE}" ]; then
  cp "${REPORT_FILE}" "${RESULTS_DIR}/eval-report.json"
  echo "[eval] report -> ${RESULTS_DIR}/eval-report.json"
else
  echo "[eval] warning: could not locate the harness report (*.${RUN_ID}.json)" >&2
fi
