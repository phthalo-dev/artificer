import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { createCloudWorkDispatcher } from '../src/dispatcher.js';
import type { InboundWorkSource } from '@artificer/agent-gateway';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function unauthorized(): APIGatewayProxyResultV2 {
  return json(401, { error: 'unauthorized' });
}

function checkAuth(event: APIGatewayProxyEventV2): boolean {
  const expected = process.env.API_AUTH_TOKEN;
  if (!expected) return true;
  const header =
    event.headers.authorization ?? event.headers.Authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  return token === expected;
}

/** POST /work — enqueue a message and wake the runtime host. */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  if (event.requestContext.http.method !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }

  if (!checkAuth(event)) return unauthorized();

  const region = awsRegion();
  const queueUrl = required('SQS_QUEUE_URL');
  const instanceId = required('RUNTIME_INSTANCE_ID');

  let body: { content?: string; source?: InboundWorkSource };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'invalid json body' });
  }

  if (!body.content?.trim()) {
    return json(400, { error: 'content is required' });
  }

  const dispatcher = createCloudWorkDispatcher({
    region,
    queueUrl,
    instanceId,
  });

  const result = await dispatcher.dispatch({
    source: body.source ?? 'http',
    content: body.content.trim(),
    metadata: {
      requestId: event.requestContext.requestId,
    },
  });

  return json(202, result);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function awsRegion(): string {
  return required('AWS_REGION');
}
