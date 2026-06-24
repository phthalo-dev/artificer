import type { Hono } from 'hono';
import type { ArtificerChannel } from '../api/types.js';
import type { Engine } from '../engine/engine.js';

export function mountChannels(
  app: Hono,
  channels: ArtificerChannel[],
  engine: Engine,
): void {
  for (const channel of channels) {
    app.post(`/channels/${channel.name}`, async (c) => {
      if (channel.definition.verify) {
        const headers: Record<string, string> = {};
        c.req.raw.headers.forEach((v, k) => {
          headers[k] = v;
        });
        const body = await c.req.text();
        const valid = await channel.definition.verify(headers, body);
        if (!valid) {
          return c.json({ error: 'Verification failed' }, 401);
        }

        const payload = JSON.parse(body);
        const message = await channel.receive(payload);

        if (message.metadata?._challenge) {
          return c.json({ challenge: message.metadata._challenge });
        }
        if (message.metadata?._skip) {
          return c.json({ ok: true });
        }

        const result = await engine.receiveMessage(message.content);
        const formatted = await channel.format({
          content: result.content ?? '',
          metadata: message.metadata,
        });
        return c.json(formatted);
      }

      const payload = await c.req.json();
      const message = await channel.receive(payload);

      if (message.metadata?._challenge) {
        return c.json({ challenge: message.metadata._challenge });
      }
      if (message.metadata?._skip) {
        return c.json({ ok: true });
      }

      const result = await engine.receiveMessage(message.content);
      const formatted = await channel.format({
        content: result.content ?? '',
        metadata: message.metadata,
      });
      return c.json(formatted);
    });
  }
}
