#!/usr/bin/env bash
# L2 smoke harness — short agent scenarios against a live runtime (or VCR playback).
#
# Prerequisites:
#   - LLM credentials in packages/runtime/.env (unless using RUNTIME_VCR=playback)
#   - ripgrep on PATH (RUNTIME_REQUIRE_RG=true by default)
#
# Usage (from packages/runtime):
#   pnpm test:smoke
#
# Environment:
#   SKIP_SMOKE=1              Skip all scenarios (CI escape hatch)
#   RUNTIME_URL               Use an existing runtime instead of spawning one
#   SMOKE_TIMEOUT_MS          Per-scenario timeout (default: 120000)
#   RUNTIME_VCR               record | playback — forwarded to spawned runtime
#   RUNTIME_VCR_CASSETTE      Cassette path for VCR mode
#   RUNTIME_VCR_FILTER        Optional URL substring filter for VCR
#
# Example CI playback (no API key):
#   RUNTIME_VCR=playback RUNTIME_VCR_CASSETTE=bench/smoke/fixtures/default.json pnpm test:smoke
set -euo pipefail

if [ "${SKIP_SMOKE:-}" = "1" ]; then
  echo "[smoke] SKIP_SMOKE=1 — skipping"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SCENARIOS="${SCRIPT_DIR}/scenarios.json"
SMOKE_TIMEOUT_MS="${SMOKE_TIMEOUT_MS:-120000}"
POLL_MS="${SMOKE_POLL_MS:-2000}"

if [ -f "${RUNTIME_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${RUNTIME_ROOT}/.env"
  set +a
fi

RUNTIME_PID=""
RUNTIME_DATA_DIR=""
OWNED_RUNTIME=false

cleanup() {
  if [ -n "${RUNTIME_PID}" ] && kill -0 "${RUNTIME_PID}" 2>/dev/null; then
    kill "${RUNTIME_PID}" 2>/dev/null || true
    wait "${RUNTIME_PID}" 2>/dev/null || true
  fi
  if [ "${OWNED_RUNTIME}" = true ] && [ -n "${RUNTIME_DATA_DIR}" ]; then
    rm -rf "${RUNTIME_DATA_DIR}"
  fi
}
trap cleanup EXIT

wait_for_health() {
  local url="$1"
  local deadline=$((SECONDS + 30))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if curl -sf "${url}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "[smoke] runtime did not become healthy at ${url}" >&2
  return 1
}

pick_port() {
  node -e "
    const net = require('node:net');
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => process.stdout.write(String(port)));
    });
  "
}

start_runtime() {
  local single_loop="${1:-false}"
  local require_git_diff="${2:-true}"

  RUNTIME_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/artificer-smoke-XXXXXX")"
  local port
  port="$(pick_port)"
  RUNTIME_URL="http://127.0.0.1:${port}"
  OWNED_RUNTIME=true

  (
    cd "${RUNTIME_ROOT}"
    ARTIFICER_DATA_DIR="${RUNTIME_DATA_DIR}" \
      PORT="${port}" \
      RUNTIME_CONCURRENCY=1 \
      RUNTIME_RESUME_ON_STARTUP=false \
      RUNTIME_MAX_RUNS_PER_WORKSTREAM=20 \
      RUNTIME_SINGLE_LOOP="${single_loop}" \
      RUNTIME_REQUIRE_GIT_DIFF_FOR_DONE="${require_git_diff}" \
      node --import tsx src/index.ts
  ) >/tmp/artificer-smoke-runtime.log 2>&1 &
  RUNTIME_PID=$!

  wait_for_health "${RUNTIME_URL}"
  echo "[smoke] runtime ready at ${RUNTIME_URL} (singleLoop=${single_loop})"
}

stop_owned_runtime() {
  if [ "${OWNED_RUNTIME}" != true ]; then
    return 0
  fi
  cleanup
  RUNTIME_PID=""
  RUNTIME_DATA_DIR=""
  OWNED_RUNTIME=false
  trap - EXIT
  trap cleanup EXIT
}

run_scenario() {
  local id="$1"
  local message="$2"
  local expected_tools_json="$3"
  local single_loop="${4:-false}"

  echo "[smoke] scenario: ${id}"

  if [ "${OWNED_RUNTIME}" = true ] || [ -z "${RUNTIME_URL:-}" ]; then
    stop_owned_runtime
    if [ "${single_loop}" = "true" ]; then
      start_runtime true false
    else
      start_runtime false true
    fi
  elif [ "${single_loop}" = "true" ]; then
    echo "[smoke]   warn: declare-done needs RUNTIME_SINGLE_LOOP=true on ${RUNTIME_URL}" >&2
  fi

  local base_url="${RUNTIME_URL}"
  local deadline=$((SECONDS + SMOKE_TIMEOUT_MS / 1000))
  local workstream_id=""
  local terminal_status=""

  local post_body
  post_body="$(node -e "console.log(JSON.stringify({ content: process.argv[1] }))" "${message}")"

  curl -sf -X POST "${base_url}/messages" \
    -H 'content-type: application/json' \
    -d "${post_body}" >/dev/null

  while [ "${SECONDS}" -lt "${deadline}" ]; do
    local state_json
    state_json="$(curl -sf "${base_url}/state")"
    local result
    result="$(node -e "
      const state = JSON.parse(process.argv[1]);
      const ws = state.workstreams?.[0];
      const terminal = new Set(['done', 'blocked', 'failed', 'cancelled']);
      if (ws && terminal.has(ws.status)) {
        console.log(JSON.stringify({ done: true, id: ws.id, status: ws.status }));
      } else if (ws) {
        console.log(JSON.stringify({ done: false, id: ws.id, status: ws.status }));
      } else {
        console.log(JSON.stringify({ done: false }));
      }
    " "${state_json}")"

    terminal_status="$(node -e "console.log(JSON.parse(process.argv[1]).status || '')" "${result}")"
    workstream_id="$(node -e "console.log(JSON.parse(process.argv[1]).id || '')" "${result}")"

    if [ "$(node -e "console.log(JSON.parse(process.argv[1]).done)" "${result}")" = "true" ]; then
      break
    fi
    sleep $((POLL_MS / 1000))
  done

  if [ -z "${terminal_status}" ]; then
    echo "[smoke]   FAIL ${id}: timed out after ${SMOKE_TIMEOUT_MS}ms" >&2
    return 1
  fi

  if [ "${terminal_status}" != "done" ] && [ "${terminal_status}" != "blocked" ]; then
    echo "[smoke]   FAIL ${id}: workstream ended with status=${terminal_status}" >&2
    return 1
  fi

  local detail_json
  detail_json="$(curl -sf "${base_url}/workstreams/${workstream_id}")"

  node -e "
    const detail = JSON.parse(process.argv[1]);
    const expected = JSON.parse(process.argv[2]);
    const names = new Set();
    for (const run of detail.runs ?? []) {
      for (const call of run.toolCalls ?? []) {
        names.add(call.name);
      }
    }
    const missing = expected.filter((t) => !names.has(t));
    if (missing.length > 0) {
      console.error('[smoke]   FAIL ${id}: missing tools: ' + missing.join(', '));
      console.error('[smoke]   seen: ' + [...names].sort().join(', '));
      process.exit(1);
    }
    console.log('[smoke]   OK ${id}: status=' + '${terminal_status}' + ' tools=' + expected.join(', '));
  " "${detail_json}" "${expected_tools_json}"
}

if [ -z "${RUNTIME_URL:-}" ]; then
  start_runtime false true
else
  echo "[smoke] using existing runtime at ${RUNTIME_URL}"
  wait_for_health "${RUNTIME_URL}"
fi

failures=0
while IFS= read -r line; do
  id="$(node -e "const s=JSON.parse(process.argv[1]); console.log(s.id)" "${line}")"
  message="$(node -e "const s=JSON.parse(process.argv[1]); console.log(s.message)" "${line}")"
  expected="$(node -e "const s=JSON.parse(process.argv[1]); console.log(JSON.stringify(s.expectedTools))" "${line}")"
  single_loop="$(node -e "const s=JSON.parse(process.argv[1]); console.log(s.singleLoop ? 'true' : 'false')" "${line}")"
  if ! run_scenario "${id}" "${message}" "${expected}" "${single_loop}"; then
    failures=$((failures + 1))
  fi
done < <(node -e "
  const scenarios = JSON.parse(require('node:fs').readFileSync('${SCENARIOS}', 'utf8'));
  for (const s of scenarios) console.log(JSON.stringify(s));
")

if [ "${failures}" -gt 0 ]; then
  echo "[smoke] ${failures} scenario(s) failed" >&2
  exit 1
fi

echo "[smoke] all scenarios passed"
