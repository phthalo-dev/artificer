import type { ToolContext } from '../context.js';
import type { ToolDef } from '../llm/types.js';
import { extractTitle, htmlToText, truncateText } from './fetch-util.js';

/** A tool to read a web page / text resource over HTTP(S). */
export function createFetchTools(_ctx: ToolContext): ToolDef[] {
  return [
    {
      name: 'fetch_url',
      description:
        'Fetch a web page or text resource over HTTP(S) and return its readable text. Use this to read a link the user shared.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The http(s) URL to fetch.' },
        },
        required: ['url'],
      },
      handler: async (input) => {
        const url = String(input.url);
        if (!/^https?:\/\//i.test(url)) {
          return `Error: only http(s) URLs are supported (got "${url}").`;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const res = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': 'ArtificerBot/0.1 (+memory ingestion)' },
          });
          if (!res.ok) {
            return `Error: fetch failed with HTTP ${res.status} ${res.statusText}.`;
          }
          const lengthHeader = res.headers.get('content-length');
          if (lengthHeader && Number(lengthHeader) > 10_000_000) {
            return `Error: response too large (${lengthHeader} bytes).`;
          }
          const contentType = res.headers.get('content-type') ?? '';
          const raw = await res.text();
          const isHtml = contentType.includes('html') || /<html[\s>]/i.test(raw);
          const title = isHtml ? extractTitle(raw) : undefined;
          const body = isHtml ? htmlToText(raw) : raw.trim();
          const { text, truncated } = truncateText(body);
          const header = [
            `URL: ${url}`,
            title ? `Title: ${title}` : null,
            truncated ? '(content truncated)' : null,
          ]
            .filter(Boolean)
            .join('\n');
          return `${header}\n\n${text}`;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error fetching ${url}: ${msg}`;
        } finally {
          clearTimeout(timer);
        }
      },
    },
  ];
}
