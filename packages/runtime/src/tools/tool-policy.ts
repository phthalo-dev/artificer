import fs from 'node:fs';
import path from 'node:path';

export type PolicyEffect = 'allow' | 'deny';

export type PolicyRule = {
  id: string;
  tool: string;
  pattern: string;
  effect: PolicyEffect;
  scope: 'agent';
  createdAt: string;
  note?: string;
};

export type ToolPolicyFile = {
  version: 1;
  rules: PolicyRule[];
};

const EMPTY_POLICY: ToolPolicyFile = { version: 1, rules: [] };

function shellTokens(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function withoutSurroundingQuotes(token: string): string {
  const first = token[0];
  return token.length >= 2 &&
    (first === '"' || first === "'") &&
    token.at(-1) === first
    ? token.slice(1, -1)
    : token;
}

function splitCommandSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[\n\r]+|;|\||&)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function tokenExecutable(token: string): string {
  const unquoted = withoutSurroundingQuotes(token);
  const base = unquoted.split(/[/\\]/).filter(Boolean).pop() ?? unquoted;
  return base.toLowerCase();
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(withoutSurroundingQuotes(token));
}

function indexOfExecutable(tokens: string[], name: string): number {
  return tokens.findIndex(
    (token) => !isEnvAssignment(token) && tokenExecutable(token) === name,
  );
}

function isSecretValue(token: string): boolean {
  const unquoted = withoutSurroundingQuotes(token);
  return (
    /^(?:gh[pousr]_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+)$/i.test(unquoted) ||
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(unquoted) ||
    (unquoted.length >= 24 &&
      /^[A-Za-z0-9+/=_-]+$/.test(unquoted) &&
      /[A-Za-z]/.test(unquoted) &&
      /\d/.test(unquoted))
  );
}

function redactShellTokens(tokens: string[]): string[] {
  const redacted: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || isSecretValue(token)) {
      continue;
    }
    if (
      /^--?(?:token|secret|password|pass|api[-_]?key|auth|credential)=/i.test(
        token,
      )
    ) {
      continue;
    }
    if (
      /^--?(?:token|secret|password|pass|api[-_]?key|auth|credential)$/i.test(
        token,
      )
    ) {
      index += 1;
      continue;
    }
    if (/^bearer$/i.test(token) && index + 1 < tokens.length) {
      index += 1;
      continue;
    }
    redacted.push(token);
  }

  if (redacted[0] === 'env') {
    redacted.shift();
  }
  return redacted;
}

function keySingleSegment(segment: string): string {
  const tokens = redactShellTokens(shellTokens(segment.trim()));
  if (tokens.length === 0) return '';

  const executable = tokenExecutable(tokens[0]!);
  const rest = tokens.slice(1);
  if (executable === 'rm' || executable === 'rmdir') {
    return [executable, ...rest].join(' ');
  }

  const arity =
    executable === 'docker-compose' ||
    (executable === 'docker' && rest[0]?.toLowerCase() === 'compose')
      ? 3
      : 2;

  return [executable, ...rest].slice(0, arity).join(' ');
}

/**
 * Produces a stable, non-secret command prefix for approval matching.
 * `rm`/`rmdir` keep flags and path operands so distinct targets do not
 * collapse. Docker Compose retains its subcommand as a third token.
 * Other commands use a two-token prefix. Chained commands are keyed
 * per segment so a leading safe command cannot stand in for a later
 * dangerous one.
 */
export function shellApprovalKey(command: string): string {
  const segments = splitCommandSegments(command);
  if (segments.length === 0) return '';
  return segments.map(keySingleSegment).filter(Boolean).join(' && ');
}

export function fetchApprovalKey(method: string, url: string): string {
  try {
    const parsed = new URL(url);
    return `${method.toUpperCase()} ${parsed.origin}${parsed.pathname}`;
  } catch {
    return `${method.toUpperCase()} <invalid-url>`;
  }
}

function hasDangerousRm(command: string): boolean {
  return splitCommandSegments(command).some((segment) => {
    const tokens = shellTokens(segment.toLowerCase());
    const rmIndex = indexOfExecutable(tokens, 'rm');
    if (rmIndex < 0) return false;

    const flags = tokens
      .slice(rmIndex + 1)
      .filter((token) => token.startsWith('-'));
    const recursive = flags.some(
      (flag) => flag === '--recursive' || /^-[^-]*r/.test(flag),
    );
    const force = flags.some(
      (flag) => flag === '--force' || /^-[^-]*f/.test(flag),
    );
    return recursive && force;
  });
}

function hasDangerousGitCommand(command: string): boolean {
  return splitCommandSegments(command).some((segment) => {
    const tokens = shellTokens(segment.toLowerCase());
    let index = indexOfExecutable(tokens, 'git');
    if (index < 0) return false;
    index += 1;

    while (tokens[index]?.startsWith('-')) {
      const option = tokens[index]!;
      index += 1;
      if (
        !option.includes('=') &&
        ['-c', '--git-dir', '--work-tree', '--namespace'].includes(option)
      ) {
        index += 1;
      }
    }

    return ['push', 'reset', 'rebase', 'clean'].includes(tokens[index] ?? '');
  });
}

function hasDangerousCurlCommand(command: string): boolean {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  return splitCommandSegments(command).some((segment) => {
    const tokens = shellTokens(segment);
    const curlIndex = indexOfExecutable(tokens, 'curl');
    if (curlIndex < 0) return false;

    for (let index = curlIndex + 1; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (
        /^-(?:d|F|T|o)(?:.|$)/.test(token) ||
        /^--(?:data(?:-[a-z-]+)?|form|upload-file|output)(?:=|$)/.test(token)
      ) {
        return true;
      }

      if (token === '-X' || token === '--request') {
        if (writeMethods.has(tokens[index + 1]?.toUpperCase() ?? '')) {
          return true;
        }
      } else if (token.startsWith('-X')) {
        if (writeMethods.has(token.slice(2).toUpperCase())) return true;
      } else if (token.startsWith('--request=')) {
        if (writeMethods.has(token.slice('--request='.length).toUpperCase())) {
          return true;
        }
      }
    }

    return false;
  });
}

function hasSubcommandAfterGlobalOptions(
  command: string,
  executable: string,
  subcommand: string,
): boolean {
  return splitCommandSegments(command).some((segment) => {
    const tokens = shellTokens(segment.toLowerCase());
    let index = indexOfExecutable(tokens, executable);
    if (index < 0) return false;
    index += 1;

    while (tokens[index]?.startsWith('-')) {
      const option = tokens[index]!;
      if (option.includes('=') || tokens[index + 1]?.startsWith('-')) {
        index += 1;
      } else {
        index += 2;
      }
    }

    return tokens[index] === subcommand;
  });
}

export function isDangerousShellCommand(command: string): boolean {
  const normalized = command.toLowerCase();

  if (hasDangerousRm(command) || hasDangerousGitCommand(command)) return true;

  if (hasDangerousCurlCommand(command)) return true;
  if (
    /\bwget\b[^;&|\n]*(?:--(?:post-data|post-file|output-document)(?:=|\s)|--method(?:=|\s+)(?:post|put|patch|delete)|\s-o(?:\s|$))/i.test(
      command,
    )
  ) {
    return true;
  }

  return (
    /\bssh\b/.test(normalized) ||
    hasSubcommandAfterGlobalOptions(command, 'kubectl', 'apply') ||
    hasSubcommandAfterGlobalOptions(command, 'terraform', 'apply') ||
    hasSubcommandAfterGlobalOptions(command, 'helm', 'upgrade')
  );
}

function isPolicyRule(value: unknown): value is PolicyRule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.tool === 'string' &&
    typeof candidate.pattern === 'string' &&
    (candidate.effect === 'allow' || candidate.effect === 'deny') &&
    candidate.scope === 'agent' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.note === undefined || typeof candidate.note === 'string')
  );
}

function isToolPolicyFile(value: unknown): value is ToolPolicyFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.rules) &&
    candidate.rules.every(isPolicyRule)
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function loadPolicyFile(filePath: string | undefined): ToolPolicyFile {
  if (!filePath) return EMPTY_POLICY;
  if (!fs.existsSync(filePath)) return EMPTY_POLICY;

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!isToolPolicyFile(parsed)) {
      throw new Error('invalid policy file shape');
    }
    return parsed;
  } catch (error) {
    if (isMissingPathError(error)) return EMPTY_POLICY;
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Could not load tool policy file ${filePath}: ${detail}`);
    return EMPTY_POLICY;
  }
}

export function loadEffectivePolicy(opts: {
  execPath: string;
  identityPath?: string;
}): ToolPolicyFile {
  const identity = loadPolicyFile(opts.identityPath);
  const exec = loadPolicyFile(opts.execPath);
  const overridden = new Set(
    exec.rules.map((candidate) => `${candidate.tool}\0${candidate.pattern}`),
  );

  return {
    version: 1,
    rules: [
      ...identity.rules.filter(
        (candidate) =>
          !overridden.has(`${candidate.tool}\0${candidate.pattern}`),
      ),
      ...exec.rules,
    ],
  };
}

function globMatches(pattern: string, value: string): boolean {
  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${expression}$`).test(value);
}

function toolMatches(candidate: PolicyRule, tool: string): boolean {
  return candidate.tool === tool || candidate.tool === '*';
}

function matchSingleKey(
  policy: ToolPolicyFile,
  tool: string,
  approvalKey: string,
  rules: PolicyRule[],
): PolicyRule | undefined {
  let lastAllow: PolicyRule | undefined;

  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const candidate = rules[index]!;
    if (
      toolMatches(candidate, tool) &&
      globMatches(candidate.pattern, approvalKey)
    ) {
      if (candidate.effect === 'deny') return candidate;
      lastAllow ??= candidate;
    }
  }

  return lastAllow;
}

export function matchRule(
  policy: ToolPolicyFile,
  tool: string,
  approvalKey: string,
): PolicyRule | undefined {
  const segments = approvalKey.split(' && ');
  if (segments.length === 1) {
    return matchSingleKey(policy, tool, approvalKey, policy.rules);
  }

  const chainRules = policy.rules.filter((candidate) =>
    candidate.pattern.includes(' && '),
  );
  const segmentRules = policy.rules.filter(
    (candidate) => !candidate.pattern.includes(' && '),
  );

  const whole = matchSingleKey(policy, tool, approvalKey, chainRules);
  if (whole?.effect === 'deny') return whole;

  const segmentMatches = segments.map((segment) =>
    matchSingleKey(policy, tool, segment, segmentRules),
  );
  const denied = segmentMatches.find((match) => match?.effect === 'deny');
  if (denied) return denied;
  if (whole?.effect === 'allow') return whole;
  if (segmentMatches.every((match) => match?.effect === 'allow')) {
    return segmentMatches.at(-1);
  }
  return undefined;
}

export function saveExecPolicy(execPath: string, file: ToolPolicyFile): void {
  fs.mkdirSync(path.dirname(execPath), { recursive: true });
  fs.writeFileSync(execPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}
