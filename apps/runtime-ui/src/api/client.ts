export const RUNTIME_URL =
  import.meta.env.VITE_RUNTIME_URL ?? 'http://localhost:4100';

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
  const res = await fetch(`${RUNTIME_URL}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
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
};
