import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { createCloudWorkDispatcher } from '../src/dispatcher.js';
import {
  createGitHubWebhookHandler,
  type AgentInfo,
} from '@artificer/webhook-handlers';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * POST /webhooks/github
 *
 * Requires env:
 * - GITHUB_WEBHOOK_SECRET
 * - AGENT_GITHUB_USERNAME
 * - AGENT_GITHUB_TOKEN (for posting start comments)
 * - AGENT_REPO (owner/repo the agent watches)
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const webhookSecret = required('GITHUB_WEBHOOK_SECRET');
  const githubUsername = required('AGENT_GITHUB_USERNAME');
  const githubToken = required('AGENT_GITHUB_TOKEN');
  const agentRepo = required('AGENT_REPO');

  const region = awsRegion();
  const queueUrl = required('SQS_QUEUE_URL');
  const instanceId = required('RUNTIME_INSTANCE_ID');

  const dispatcher = createCloudWorkDispatcher({
    region,
    queueUrl,
    instanceId,
  });

  const gh = createGitHubWebhookHandler({
    webhookSecret,
    workDispatcher: dispatcher,
    getAgentByRepository: async (repoFullName) => {
      if (repoFullName !== agentRepo) return null;
      const agent: AgentInfo = {
        id: 'personal',
        githubUsername,
        githubToken,
      };
      return agent;
    },
  });

  const eventType =
    event.headers['x-github-event'] ?? event.headers['X-GitHub-Event'];
  const signature =
    event.headers['x-hub-signature-256'] ??
    event.headers['X-Hub-Signature-256'];

  const result = await gh.handleWebhook(
    eventType,
    event.body ?? '',
    signature,
  );

  return json(result.success ? 202 : 400, result);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function awsRegion(): string {
  return required('AWS_REGION');
}
