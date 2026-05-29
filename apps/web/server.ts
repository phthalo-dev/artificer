import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './app/server/api/root';
import { createTRPCContext } from './app/server/api/trpc';
import { createGitHubWebhookHandler } from '@artificer/webhook-handlers';
import { db } from './app/server/db';
import { decrypt } from '@artificer/shared';

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  '/api/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: createTRPCContext,
  }),
);

// ---------------------------------------------------------------------------
// GitHub Webhook endpoint
// ---------------------------------------------------------------------------

const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!webhookSecret) {
  console.warn(
    '[webhook] GITHUB_WEBHOOK_SECRET is not set — webhook signature verification will be skipped',
  );
}

if (!encryptionKey) {
  console.warn(
    '[webhook] ENCRYPTION_KEY is not set — agent credentials cannot be decrypted',
  );
}

const webhookHandler = createGitHubWebhookHandler({
  webhookSecret: webhookSecret ?? '',

  /**
   * Look up the agent assigned to a given repository.
   * We also decrypt the GitHub token so the handler can post comments back.
   */
  async getAgentByRepository(repoFullName) {
    if (!encryptionKey) return null;

    const agent = await db.agent.findFirst({
      where: {
        repositories: { has: repoFullName },
        status: 'RUNNING',
      },
      select: {
        id: true,
        githubUsername: true,
        githubToken: true,
        ec2PublicIp: true,
        opencodePassword: true,
      },
    });

    if (!agent || !agent.ec2PublicIp) return null;

    try {
      return {
        id: agent.id,
        githubUsername: agent.githubUsername,
        githubToken: decrypt(agent.githubToken, encryptionKey),
        ec2PublicIp: agent.ec2PublicIp,
        opencodePassword: decrypt(agent.opencodePassword ?? '', encryptionKey),
      };
    } catch (err) {
      console.error(
        `[webhook] Failed to decrypt credentials for agent ${agent.id}:`,
        err,
      );
      return null;
    }
  },

  /**
   * Persist the OpenCode session ID in the database, tagged as GITHUB source.
   */
  async onSessionCreated(remoteSessionId, agentId, _source) {
    try {
      await db.agentSession.create({
        data: {
          agentId,
          remoteId: remoteSessionId,
          title: `GitHub session`,
          source: 'GITHUB',
        },
      });
    } catch (err) {
      console.error('[webhook] Failed to persist session:', err);
    }
  },

  /**
   * Record token usage in the database.
   */
  async onTokenUsage(agentId, usage) {
    try {
      // Find the most recently created GITHUB session for this agent to link usage
      const session = await db.agentSession.findFirst({
        where: { agentId, source: 'GITHUB' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      await db.tokenUsage.create({
        data: {
          agentId,
          sessionId: session?.id,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUSD: usage.costUSD,
        },
      });
    } catch (err) {
      console.error('[webhook] Failed to persist token usage:', err);
    }
  },

  /**
   * Log activity for the activity feed.
   */
  async onActivity(agentId, _type, description, metadata) {
    try {
      await db.activity.create({
        data: {
          agentId,
          type: 'CODE_CHANGE',
          description,
          metadata: (metadata ?? {}) as Record<string, string>,
        },
      });
    } catch (err) {
      console.error('[webhook] Failed to persist activity:', err);
    }
  },
});

app.post(
  '/api/github/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.get('X-Hub-Signature-256');
    const event = req.get('X-GitHub-Event');
    const delivery = req.get('X-GitHub-Delivery');

    const payloadString = (req.body as Buffer).toString('utf8');

    console.log(`[webhook] Received GitHub event: ${event}`, { delivery });

    // If no secret is configured, skip signature check (dev mode)
    const effectiveSignature = webhookSecret ? signature : undefined;

    // When no secret is set we pass a dummy signature so the handler skips verification
    const result = await webhookHandler.handleWebhook(
      event,
      payloadString,
      webhookSecret ? effectiveSignature : 'sha256=skip',
    );

    console.log(`[webhook] Result for ${event}:`, {
      success: result.success,
      message: result.message,
      sessionId: result.sessionId,
    });

    res.status(200).json({
      received: true,
      event,
      delivery,
      success: result.success,
      message: result.message,
      sessionId: result.sessionId,
    });
  },
);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
