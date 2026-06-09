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
#   RESULTS_DIR / BENCH_RESULTS_DIR  bench output directory (default: bench/results)
#   DATASET      HF dataset name        (default: princeton-nlp/SWE-bench_Lite)
#   SPLIT        dataset split          (default: test)
#   RUN_ID       evaluation run id      (default: artificer-bench)
#   MAX_WORKERS  parallel eval workers  (default: 4)
#   PYTHON       python executable      (default: bench/eval/.venv, else python3/python)
set -euo pipefail

EVAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(cd "${EVAL_DIR}/.." && pwd)"
RESULTS_DIR="$(cd "${RESULTS_DIR:-${BENCH_RESULTS_DIR:-${BENCH_DIR}/results}}" && pwd)"
PREDICTIONS="${PREDICTIONS:-${RESULTS_DIR}/predictions.jsonl}"

DATASET="${DATASET:-princeton-nlp/SWE-bench_Lite}"
SPLIT="${SPLIT:-test}"
RUN_ID="${RUN_ID:-artificer-bench}"
MAX_WORKERS="${MAX_WORKERS:-4}"

resolve_python() {
  if [ -n "${PYTHON:-}" ]; then
    echo "${PYTHON}"
    return
  fi
  if [ -x "${EVAL_DIR}/.venv/bin/python" ]; then
    echo "${EVAL_DIR}/.venv/bin/python"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    echo python3
    return
  fi
  if command -v python >/dev/null 2>&1; then
    echo python
    return
  fi
  echo "error: no python interpreter found (install Python 3.11+ or set PYTHON=...)" >&2
  exit 1
}

PYTHON="$(resolve_python)"

if [ ! -f "${PREDICTIONS}" ]; then
  echo "error: predictions not found at ${PREDICTIONS} (run \`pnpm bench\` first)" >&2
  exit 1
fi

echo "[eval] dataset=${DATASET} split=${SPLIT} run_id=${RUN_ID}"
echo "[eval] predictions=${PREDICTIONS}"
echo "[eval] python=${PYTHON}"

if ! "${PYTHON}" -c "import swebench" 2>/dev/null; then
  cat >&2 <<EOF
error: swebench is not installed for ${PYTHON}

Create the eval virtualenv once from packages/runtime:

  python3 -m venv bench/eval/.venv
  bench/eval/.venv/bin/pip install -r bench/eval/requirements.txt

Or set PYTHON to an interpreter that already has swebench installed.
EOF
  exit 1
fi

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
