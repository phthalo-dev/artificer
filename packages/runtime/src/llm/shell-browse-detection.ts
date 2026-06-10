/** Tools that count as editing source (resets browse counters). */
export const EDIT_TOOL_NAMES = new Set(['edit_file', 'write_file', 'apply_patch']);

export interface WorkerBrowseState {
  hasEdited: boolean;
  browseShellCount: number;
  lastBrowseTarget: string;
  consecutiveSameFileBrowse: number;
}

export interface WorkerBrowseConfig {
  /** Inject edit reminder after this many browse shells without an edit. */
  nudgeThreshold: number;
  /** Soft loop warning after this many consecutive browses of the same file. */
  sameFileLoopThreshold: number;
}

export const DEFAULT_WORKER_BROWSE_CONFIG: WorkerBrowseConfig = {
  nudgeThreshold: 10,
  sameFileLoopThreshold: 3,
};

export const SHELL_BROWSE_LOOP_WARNING =
  'You are re-reading the same file via run_shell. Use read_file instead, then call edit_file to implement.';

export const WORKER_EDIT_NUDGE_TEXT =
  '[SYSTEM] You have run many shell read commands without editing. Stop browsing. ' +
  'Use read_file for source inspection, then call edit_file or write_file NOW to implement the plan. ' +
  'Reserve run_shell for builds, tests, and git only.';

export function createWorkerBrowseState(): WorkerBrowseState {
  return {
    hasEdited: false,
    browseShellCount: 0,
    lastBrowseTarget: '',
    consecutiveSameFileBrowse: 0,
  };
}

/** True when a shell command is used to read/inspect source rather than build or test. */
export function isShellBrowseCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;

  if (/\b(npm|pnpm|yarn|cargo|pytest|make|tsc|vitest|jest|mocha|deno\s+test)\b/i.test(c)) {
    return false;
  }
  if (/\bgit\s+(diff|status|show|log|rev-parse)\b/i.test(c)) return false;
  if (/\b(cd\s+\S+\s+&&\s+)?(npm|pnpm|yarn|cargo|make)\b/i.test(c)) return false;

  return (
    /\bsed\b/.test(c) ||
    /\bgrep\b/.test(c) ||
    /\btail\b/.test(c) ||
    /\bhead\b/.test(c) ||
    /\bcat\b/.test(c) ||
    /\bwc\s+-l\b/.test(c) ||
    /\bless\b/.test(c) ||
    /\bmore\b/.test(c) ||
    /\bfind\b/.test(c)
  );
}

/** Normalize a browse command to a stable file key for loop detection. */
export function shellBrowseTarget(command: string): string | null {
  const paths = command.match(
    /(?:^|[\s'"`])(?:\.\/)?(?:repo\/|src\/|app\/src\/)[\w./-]+\.(?:ts|tsx|js|jsx|go|rs|py|java|kt|rb|cs|cpp|c|h|md)/g,
  );
  if (!paths?.length) {
    const fallback = command.match(
      /(?:^|[\s'"`])(?:\.\/)?[\w./-]+\.(?:ts|tsx|js|jsx|go|rs|py|java|kt|rb|cs)/,
    );
    return fallback ? normalizeBrowsePath(fallback[0]) : null;
  }
  const normalized = paths.map((p) => normalizeBrowsePath(p));
  return [...new Set(normalized)].sort().join('|');
}

function normalizeBrowsePath(raw: string): string {
  return raw.replace(/^[\s'"`]+/, '').replace(/^repo\//, '').replace(/^app\//, '');
}

export interface WorkerBrowseCheckResult {
  editNudge: boolean;
  sameFileLoopWarning: boolean;
  loopTarget?: string;
}

export function recordWorkerToolCall(
  state: WorkerBrowseState,
  toolName: string,
  input: Record<string, unknown>,
  config: WorkerBrowseConfig = DEFAULT_WORKER_BROWSE_CONFIG,
): WorkerBrowseCheckResult {
  if (EDIT_TOOL_NAMES.has(toolName)) {
    state.hasEdited = true;
    state.browseShellCount = 0;
    state.lastBrowseTarget = '';
    state.consecutiveSameFileBrowse = 0;
    return { editNudge: false, sameFileLoopWarning: false };
  }

  if (toolName !== 'run_shell' || state.hasEdited) {
    return { editNudge: false, sameFileLoopWarning: false };
  }

  const command = typeof input.command === 'string' ? input.command : '';
  if (!isShellBrowseCommand(command)) {
    return { editNudge: false, sameFileLoopWarning: false };
  }

  state.browseShellCount++;

  const target = shellBrowseTarget(command);
  if (target && target === state.lastBrowseTarget) {
    state.consecutiveSameFileBrowse++;
  } else if (target) {
    state.lastBrowseTarget = target;
    state.consecutiveSameFileBrowse = 1;
  } else {
    state.lastBrowseTarget = '';
    state.consecutiveSameFileBrowse = 0;
  }

  return {
    editNudge: state.browseShellCount >= config.nudgeThreshold,
    sameFileLoopWarning:
      target != null &&
      state.consecutiveSameFileBrowse >= config.sameFileLoopThreshold,
    loopTarget: target ?? undefined,
  };
}
