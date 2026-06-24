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

    if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  };
}
