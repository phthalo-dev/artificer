/**
 * Dev tool: record a sanitized ACP transcript from a real agent. Never run in CI.
 *
 *   tsx src/scripts/record-acp-transcript.ts --out <file> --cwd <dir> \
 *     --prompt <text> [--resume <sessionId>] [--reject <regex>] -- <cmd> [args...]
 *
 * Every JSON-RPC line, both directions, is written as JSONL
 * `{ t, dir: 'in'|'out', msg }` (in = agent to us, out = us to agent).
 * Permission requests are answered `reject_once` when the toolCall JSON
 * matches --reject (default `rm -rf`), otherwise `allow_once`. The cwd, its
 * parent, and the home directory are replaced with {{WS}} / {{PARENT}} /
 * {{HOME}} in the output.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { sanitizeTranscriptPaths } from './acp-transcript-sanitize.js';

interface Args {
  out: string;
  cwd: string;
  prompt: string;
  resume?: string;
  reject: RegExp;
  command: string[];
}

function parseArgs(argv: string[]): Args {
  const sep = argv.indexOf('--');
  const flags = sep === -1 ? argv : argv.slice(0, sep);
  const command = sep === -1 ? [] : argv.slice(sep + 1);
  const get = (name: string): string | undefined => {
    const i = flags.indexOf(`--${name}`);
    return i === -1 ? undefined : flags[i + 1];
  };
  const out = get('out');
  const cwd = get('cwd');
  const prompt = get('prompt');
  if (!out || !cwd || !prompt || command.length === 0) {
    console.error(
      'usage: record-acp-transcript --out <file> --cwd <dir> --prompt <text> [--resume <id>] [--reject <regex>] -- <cmd> [args...]',
    );
    process.exit(2);
  }
  return {
    out,
    cwd: fs.realpathSync(cwd),
    prompt,
    resume: get('resume'),
    reject: new RegExp(get('reject') ?? 'rm -rf'),
    command,
  };
}

const args = parseArgs(process.argv.slice(2));
const parent = path.dirname(args.cwd);
const lines: string[] = [];

const home = os.homedir();

function sanitize(text: string): string {
  return sanitizeTranscriptPaths(text, { cwd: args.cwd, parent, home });
}

function log(dir: 'in' | 'out', raw: string): void {
  let msg: unknown = raw;
  try {
    msg = JSON.parse(raw);
  } catch {
    /* keep raw text */
  }
  lines.push(sanitize(JSON.stringify({ t: Date.now(), dir, msg })));
}

const child = spawn(args.command[0]!, args.command.slice(1), {
  cwd: args.cwd,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let nextId = 1;
const pending = new Map<number, (msg: any) => void>();

function write(msg: object): void {
  const raw = JSON.stringify({ jsonrpc: '2.0', ...msg });
  log('out', raw);
  child.stdin.write(raw + '\n');
}

function request(method: string, params: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    write({ id, method, params });
  });
}

function answerPermission(msg: any): void {
  const options: Array<{ optionId: string; kind: string }> =
    msg.params?.options ?? [];
  const reject = args.reject.test(JSON.stringify(msg.params?.toolCall ?? {}));
  const wanted = reject ? 'reject_once' : 'allow_once';
  const chosen = options.find((o) => o.kind === wanted);
  write({
    id: msg.id,
    result: {
      outcome: chosen
        ? { outcome: 'selected', optionId: chosen.optionId }
        : { outcome: 'cancelled' },
    },
  });
}

readline.createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  log('in', line);
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === 'session/request_permission' && msg.id !== undefined) {
    answerPermission(msg);
  } else if (msg.method && msg.id !== undefined) {
    write({
      id: msg.id,
      error: { code: -32601, message: `not supported: ${msg.method}` },
    });
  } else if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)!(msg);
    pending.delete(msg.id);
  }
});

function finish(code: number): never {
  fs.writeFileSync(args.out, lines.join('\n') + '\n');
  child.kill();
  process.exit(code);
}

child.on('exit', () => finish(1));

async function main(): Promise<void> {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    },
    clientInfo: { name: 'artificer-recorder', version: '0.0.0' },
  });
  if (init.error) throw new Error(`initialize: ${init.error.message}`);
  let sessionId = args.resume;
  if (sessionId) {
    const r = await request('session/load', {
      sessionId,
      cwd: args.cwd,
      mcpServers: [],
    });
    if (r.error) throw new Error(`session/load: ${r.error.message}`);
  } else {
    const r = await request('session/new', { cwd: args.cwd, mcpServers: [] });
    if (r.error) throw new Error(`session/new: ${r.error.message}`);
    sessionId = r.result.sessionId as string;
  }
  const res = await request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: args.prompt }],
  });
  if (res.error) throw new Error(`session/prompt: ${res.error.message}`);
  console.error(`recorded ${lines.length} lines to ${args.out}`);
}

main().then(
  () => finish(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    finish(1);
  },
);
