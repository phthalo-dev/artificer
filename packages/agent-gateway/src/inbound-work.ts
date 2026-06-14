import { z } from 'zod';
import type { RuntimeClient } from './runtime-client.js';

export const InboundWorkSourceSchema = z.enum([
  'http',
  'github',
  'slack',
  'discord',
]);

export type InboundWorkSource = z.infer<typeof InboundWorkSourceSchema>;

export const InboundWorkSchema = z.object({
  source: InboundWorkSourceSchema,
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export type InboundWork = z.infer<typeof InboundWorkSchema>;

export function parseInboundWork(raw: string): InboundWork {
  return InboundWorkSchema.parse(JSON.parse(raw));
}

export function serializeInboundWork(work: InboundWork): string {
  return JSON.stringify(work);
}

export interface WorkDispatchResult {
  accepted: boolean;
  message: string;
}

/** Delivers inbound work to the agent runtime (direct HTTP, queue, etc.). */
export interface WorkDispatcher {
  dispatch(work: InboundWork): Promise<WorkDispatchResult>;
}

/** Sends work directly to a running runtime over HTTP. */
export class DirectRuntimeDispatcher implements WorkDispatcher {
  constructor(private readonly client: RuntimeClient) {}

  async dispatch(work: InboundWork): Promise<WorkDispatchResult> {
    await this.client.sendMessage(work.content);
    return { accepted: true, message: 'delivered to runtime' };
  }
}
