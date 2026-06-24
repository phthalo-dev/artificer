import { createHmac, timingSafeEqual, verify } from 'node:crypto';

const MAX_TIMESTAMP_DRIFT_SECONDS = 300;

export function verifySlackSignature(
  signingSecret: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const timestamp = headers['x-slack-request-timestamp'];
  const signature = headers['x-slack-signature'];
  if (!timestamp || !signature) return false;

  if (
    Math.abs(Date.now() / 1000 - Number(timestamp)) >
    MAX_TIMESTAMP_DRIFT_SECONDS
  ) {
    return false;
  }

  const computed =
    'v0=' +
    createHmac('sha256', signingSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex');

  if (computed.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

export function verifyDiscordSignature(
  publicKey: string,
  headers: Record<string, string>,
  body: string,
): boolean {
  const signature = headers['x-signature-ed25519'];
  const timestamp = headers['x-signature-timestamp'];
  if (!signature || !timestamp) return false;

  try {
    return verify(
      null,
      Buffer.from(timestamp + body),
      {
        key: Buffer.from(publicKey, 'hex'),
        format: 'raw',
        type: 'ed25519',
      } as any,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}
