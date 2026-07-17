import { timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';

export function bearerAuth(key: string | undefined) {
  return async (c: Context, next: Next) => {
    if (!key) return next();

    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = header.slice(7);
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(key);

    if (
      tokenBuf.length !== keyBuf.length ||
      !timingSafeEqual(tokenBuf, keyBuf)
    ) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}

// SSE auth: EventSource can't set custom headers, so accept the key via
// ?key= query param in addition to the Authorization Bearer header.
export function sseAuth(key: string | undefined) {
  return async (c: Context, next: Next) => {
    if (!key) return next();

    const header = c.req.header('Authorization');
    const queryKey = c.req.query('key');
    const token =
      (header?.startsWith('Bearer ') ? header.slice(7) : null) ??
      queryKey ??
      '';

    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(key);

    if (
      !token ||
      tokenBuf.length !== keyBuf.length ||
      !timingSafeEqual(tokenBuf, keyBuf)
    ) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}
