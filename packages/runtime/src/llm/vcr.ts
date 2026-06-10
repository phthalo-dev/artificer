/**
 * VCR (Video Cassette Recorder) for HTTP requests.
 *
 * Patches `globalThis.fetch` to record and replay HTTP interactions for
 * deterministic tests without real API calls.
 *
 * Environment variables:
 *   RUNTIME_VCR           - "record" or "playback"
 *   RUNTIME_VCR_CASSETTE  - Path to cassette JSON file
 *   RUNTIME_VCR_FILTER    - Optional URL substring filter (only matching requests intercepted)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type VcrMode = 'record' | 'playback';

export interface VcrConfig {
  mode: VcrMode;
  cassettePath: string;
  filter?: string;
}

export interface VcrRecording {
  url: string;
  method: string;
  status: number;
  body: string;
  headers?: Record<string, string>;
}

const AUTH_HEADER_NAMES = new Set([
  'authorization',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'proxy-authorization',
]);

const REDACT_JSON_KEYS = new Set([
  'authorization',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'secret',
  'token',
]);

const SENSITIVE_VALUE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-REDACTED' },
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: 'AKIA_REDACTED' },
];

function resolveUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return String(input);
}

function resolveMethod(
  input: string | URL | Request,
  init?: RequestInit,
): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

function shouldIntercept(url: string, filter?: string): boolean {
  if (!filter) {
    return true;
  }
  return url.includes(filter);
}

function sanitizeStringValue(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeStringValue(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_JSON_KEYS.has(key.toLowerCase())) {
        result[key] = 'REDACTED';
      } else {
        result[key] = sanitizeJsonValue(nested);
      }
    }
    return result;
  }
  return value;
}

function sanitizeBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(sanitizeJsonValue(parsed));
  } catch {
    return sanitizeStringValue(body);
  }
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!AUTH_HEADER_NAMES.has(key.toLowerCase())) {
      result[key] = value;
    }
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

function loadExistingRecordings(cassettePath: string): VcrRecording[] {
  if (!existsSync(cassettePath)) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(cassettePath, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as VcrRecording[]) : [];
  } catch {
    return [];
  }
}

function saveRecordings(cassettePath: string, recordings: VcrRecording[]): void {
  const dir = dirname(cassettePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(cassettePath, JSON.stringify(recordings, null, 2));
}

export function loadVcrConfig(env: NodeJS.ProcessEnv = process.env): VcrConfig | null {
  const mode = env.RUNTIME_VCR;
  if (!mode) {
    return null;
  }

  if (mode !== 'record' && mode !== 'playback') {
    throw new Error(
      `Invalid RUNTIME_VCR value: "${mode}". Expected "record" or "playback".`,
    );
  }

  const cassettePath = env.RUNTIME_VCR_CASSETTE;
  if (!cassettePath) {
    return null;
  }

  const filter = env.RUNTIME_VCR_FILTER?.trim();
  return {
    mode,
    cassettePath: resolve(cassettePath),
    filter: filter || undefined,
  };
}

export function installVcr(config: VcrConfig): () => void {
  const originalFetch = globalThis.fetch;
  const { mode, cassettePath, filter } = config;

  if (mode === 'record') {
    const recordings = loadExistingRecordings(cassettePath);

    globalThis.fetch = Object.assign(
      async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = resolveUrl(input);
        const method = resolveMethod(input, init);
        const response = await originalFetch(input, init);

        if (!shouldIntercept(url, filter)) {
          return response;
        }

        const body = await response.clone().text();
        recordings.push({
          url,
          method,
          status: response.status,
          body: sanitizeBody(body),
          headers: sanitizeResponseHeaders(response.headers),
        });

        return response;
      },
      { preconnect: (_url: string | URL) => {} },
    );

    return () => {
      globalThis.fetch = originalFetch;
      saveRecordings(cassettePath, recordings);
    };
  }

  if (!existsSync(cassettePath)) {
    throw new Error(`VCR cassette not found: ${cassettePath}`);
  }

  const recordings = loadExistingRecordings(cassettePath);
  const consumed = new Array<boolean>(recordings.length).fill(false);

  globalThis.fetch = Object.assign(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = resolveUrl(input);
      const method = resolveMethod(input, init);

      if (!shouldIntercept(url, filter)) {
        return originalFetch(input, init);
      }

      const matchIndex = recordings.findIndex((rec, index) => {
        if (consumed[index]) {
          return false;
        }
        return rec.method === method && rec.url === url;
      });

      if (matchIndex < 0) {
        throw new Error(
          `[VCR] No matching recording for ${method} ${url}. ` +
            `${recordings.length} recording(s) in ${cassettePath}.`,
        );
      }

      consumed[matchIndex] = true;
      const rec = recordings[matchIndex]!;
      const headers = new Headers(rec.headers);
      return new Response(rec.body, { status: rec.status, headers });
    },
    { preconnect: (_url: string | URL) => {} },
  );

  return () => {
    globalThis.fetch = originalFetch;
  };
}
