import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { handleMockRequest } from './src/mocks/handlers';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendRaw(
  res: ServerResponse,
  status: number,
  contentType: string,
  body: string,
) {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function handleEvents(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const write = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const now = new Date().toISOString();
  write('message', {
    kind: 'message',
    at: now,
    data: { direction: 'inbound', content: 'Mock SSE: message received' },
  });
  write('workstream', {
    kind: 'workstream',
    at: now,
    data: { status: 'in_progress', title: 'Auth refactor: JWT sessions' },
  });
  write('run', {
    kind: 'run',
    at: now,
    data: { status: 'running', role: 'worker' },
  });
  write('tool', {
    kind: 'tool',
    at: now,
    data: { name: 'edit_file' },
  });

  const interval = setInterval(() => {
    write('ping', Date.now());
  }, 15_000);

  req.on('close', () => clearInterval(interval));
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = url.pathname;

        if (pathname === '/events') {
          handleEvents(req, res);
          return;
        }

        if (!pathname.startsWith('/api')) {
          next();
          return;
        }

        const apiPath = pathname.slice('/api'.length) || '/';
        let parsedBody: unknown;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const raw = await readBody(req);
          if (raw) {
            try {
              parsedBody = JSON.parse(raw);
            } catch {
              sendJson(res, 400, { error: 'invalid JSON body' });
              return;
            }
          }
        }

        const result = handleMockRequest({
          method: req.method ?? 'GET',
          pathname: apiPath,
          searchParams: url.searchParams,
          body: parsedBody,
        });

        if (result.rawBody !== undefined) {
          sendRaw(
            res,
            result.status,
            result.contentType ?? 'text/plain; charset=utf-8',
            result.rawBody,
          );
          return;
        }

        sendJson(res, result.status, result.body ?? {});
      });
    },
  };
}
