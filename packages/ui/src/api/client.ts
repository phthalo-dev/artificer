import { getApiKey } from './auth';

export const baseOrigin =
  import.meta.env.VITE_MOCK_API === 'true'
    ? window.location.origin
    : (import.meta.env.VITE_RUNTIME_URL ?? window.location.origin);
export const RUNTIME_URL = `${baseOrigin.replace(/\/$/, '')}/api`;

/** When set, outbound messages go through the wake API (queue + start EC2). */
export const WAKE_API_URL = import.meta.env.VITE_WAKE_API_URL as
  | string
  | undefined;

export const WAKE_API_TOKEN = import.meta.env.VITE_WAKE_API_TOKEN as
  | string
  | undefined;

export const CLOUD_MODE = Boolean(WAKE_API_URL);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getApiKey();
  const res = await fetch(`${RUNTIME_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ? JSON.stringify(body.error) : detail;
    } catch {
      // non-JSON error body; keep status text
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export async function sendWork(content: string): Promise<{ queued: boolean }> {
  if (WAKE_API_URL) {
    const res = await fetch(`${WAKE_API_URL.replace(/\/$/, '')}/work`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(WAKE_API_TOKEN
          ? { authorization: `Bearer ${WAKE_API_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ content, source: 'http' }),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = body?.error ?? body?.message ?? detail;
      } catch {
        // ignore
      }
      throw new ApiError(String(detail), res.status);
    }
    return { queued: true };
  }

  await request<{ message: unknown }>('/messages', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  return { queued: false };
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

interface ArtifactContentResult {
  content: string;
  contentType: string;
  truncated: boolean;
}

/** Fetches raw artifact version bytes (not JSON). */
export async function fetchArtifactContent(
  workstreamId: string,
  key: string,
  version: string,
): Promise<ArtifactContentResult> {
  const authKey = getApiKey();
  const res = await fetch(
    `${RUNTIME_URL}/workstreams/${encodeURIComponent(workstreamId)}/artifacts/${encodeURIComponent(key)}/versions/${encodeURIComponent(version)}/content`,
    {
      headers: authKey ? { authorization: `Bearer ${authKey}` } : {},
    },
  );
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ? JSON.stringify(body.error) : detail;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status);
  }
  const contentType =
    res.headers.get('content-type') ?? 'application/octet-stream';
  const truncated = res.headers.get('x-artificer-truncated') === 'true';
  const buffer = await res.arrayBuffer();
  const content =
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('markdown') ||
    contentType.includes('javascript')
      ? new TextDecoder().decode(buffer)
      : `[binary content, ${buffer.byteLength} bytes]`;
  return { content, contentType, truncated };
}
