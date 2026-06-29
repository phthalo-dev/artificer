import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'hono';
import type { Context, Next } from 'hono';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

export function serveUI(distDir: string): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    if (
      c.req.path.startsWith('/api/') ||
      c.req.path.startsWith('/channels/') ||
      c.req.path === '/events'
    ) {
      return next();
    }

    const filePath = path.join(
      distDir,
      c.req.path === '/' ? 'index.html' : c.req.path,
    );

    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath);
        const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
        return new Response(content, {
          headers: { 'Content-Type': contentType },
        });
      }
    } catch {
      // File not found — fall through to SPA fallback
    }

    const indexPath = path.join(distDir, 'index.html');
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      return new Response(content, {
        headers: { 'Content-Type': 'text/html' },
      });
    } catch {
      return next();
    }
  };
}
