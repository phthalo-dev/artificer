import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../trpc';
import { CreateAgentSchema, UpdateAgentSchema } from '@artificer/shared';
import { encrypt } from '@artificer/shared';
import { env } from '../../env';
import { Orchestrator } from '@artificer/orchestrator';

let orchestrator: Orchestrator | null = null;

function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    if (!env.AWS_REGION) {
      throw new Error('AWS_REGION is not configured');
    }
    if (!env.EC2_SUBNET_ID) {
      throw new Error('EC2_SUBNET_ID is not configured');
    }
    if (!env.EC2_SECURITY_GROUP_ID) {
      throw new Error('EC2_SECURITY_GROUP_ID is not configured');
    }

    orchestrator = new Orchestrator({
      awsRegion: env.AWS_REGION,
      defaultSubnetId: env.EC2_SUBNET_ID,
      defaultSecurityGroupIds: [env.EC2_SECURITY_GROUP_ID],
      defaultKeyName: env.EC2_KEY_NAME,
      defaultInstanceType: env.EC2_INSTANCE_TYPE,
    });
  }
  return orchestrator;
}

export const agentsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z
        .object({
          teamId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const agents = await ctx.db.agent.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.teamId && { teamId: input.teamId }),
        },
        select: {
          id: true,
          name: true,
          status: true,
          ec2InstanceId: true,
          ec2PublicIp: true,
          githubUsername: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              activities: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return agents;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
        include: {
          team: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              activities: true,
              metrics: true,
            },
          },
        },
      });

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      const { githubSshKey, githubToken, anthropicApiKey, ...agentData } =
        agent;

      return agentData;
    }),

  create: protectedProcedure
    .input(CreateAgentSchema)
    .mutation(async ({ ctx, input }) => {
      const agentCount = await ctx.db.agent.count({
        where: { userId: ctx.session.user.id },
      });

      if (agentCount >= 10) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Maximum number of agents reached',
        });
      }

      const sshKeyPair = `-----BEGIN OPENSSH PRIVATE KEY-----
placeholder-key-generation-required
-----END OPENSSH PRIVATE KEY-----`;

      const encryptedSshKey = encrypt(sshKeyPair, env.ENCRYPTION_KEY);
      const encryptedGithubToken = encrypt(
        input.githubToken,
        env.ENCRYPTION_KEY,
      );
      const encryptedAnthropicKey = encrypt(
        input.anthropicApiKey,
        env.ENCRYPTION_KEY,
      );

      const agent = await ctx.db.agent.create({
        data: {
          name: input.name,
          githubUsername: input.githubUsername,
          githubEmail: input.githubEmail,
          githubSshKey: encryptedSshKey,
          githubToken: encryptedGithubToken,
          anthropicApiKey: encryptedAnthropicKey,
          userId: ctx.session.user.id,
          teamId: input.teamId,
          opencodeConfig: {},
          status: 'STARTING',
        },
        select: {
          id: true,
          name: true,
          status: true,
          githubUsername: true,
          createdAt: true,
        },
      });

      try {
        const orch = getOrchestrator();

        const credentials = orch.buildAgentCredentials(
          input.anthropicApiKey,
          input.githubToken,
          sshKeyPair,
        );

        const instance = await orch.provisionAgent(agent.id, credentials);

        await ctx.db.agent.update({
          where: { id: agent.id },
          data: {
            ec2InstanceId: instance.instanceId,
            ec2PublicIp: instance.publicIp,
            ec2PrivateIp: instance.privateIp,
            status: 'RUNNING',
          },
        });

        return {
          ...agent,
          ec2InstanceId: instance.instanceId,
          ec2PublicIp: instance.publicIp,
          status: 'RUNNING' as const,
        };
      } catch (error) {
        await ctx.db.agent.update({
          where: { id: agent.id },
          data: { status: 'ERROR' },
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to provision agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        data: UpdateAgentSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingAgent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!existingAgent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      const agent = await ctx.db.agent.update({
        where: { id: input.id },
        data: input.data,
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
        },
      });

      return agent;
    }),

  updateRepositories: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        repositories: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingAgent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!existingAgent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      const agent = await ctx.db.agent.update({
        where: { id: input.id },
        data: {
          repositories: input.repositories,
        },
        select: {
          id: true,
          name: true,
          repositories: true,
          updatedAt: true,
        },
      });

      return agent;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      if (agent.ec2InstanceId) {
        try {
          const orch = getOrchestrator();
          await orch.terminateAgent(agent.ec2InstanceId);
        } catch (error) {
          console.error('Failed to terminate EC2 instance:', error);
        }
      }

      await ctx.db.agent.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  start: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      if (agent.status === 'RUNNING') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent is already running',
        });
      }

      if (!agent.ec2InstanceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent has no EC2 instance',
        });
      }

      await ctx.db.agent.update({
        where: { id: input.id },
        data: { status: 'STARTING' },
      });

      try {
        const orch = getOrchestrator();
        const instance = await orch.startAgent(agent.ec2InstanceId);

        await ctx.db.agent.update({
          where: { id: input.id },
          data: {
            status: 'RUNNING',
            ec2PublicIp: instance.publicIp,
            ec2PrivateIp: instance.privateIp,
          },
        });

        return { success: true };
      } catch (error) {
        await ctx.db.agent.update({
          where: { id: input.id },
          data: { status: 'ERROR' },
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to start agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  stop: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      if (agent.status === 'STOPPED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent is already stopped',
        });
      }

      if (!agent.ec2InstanceId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent has no EC2 instance',
        });
      }

      await ctx.db.agent.update({
        where: { id: input.id },
        data: { status: 'STOPPING' },
      });

      try {
        const orch = getOrchestrator();
        await orch.stopAgent(agent.ec2InstanceId);

        await ctx.db.agent.update({
          where: { id: input.id },
          data: { status: 'STOPPED' },
        });

        return { success: true };
      } catch (error) {
        await ctx.db.agent.update({
          where: { id: input.id },
          data: { status: 'ERROR' },
        });

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to stop agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  setupWebhook: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        repository: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      if (!agent.githubToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent has no GitHub token',
        });
      }

      const webhookUrl = `https://${process.env.APP_DOMAIN || 'localhost:3000'}/api/github/webhook`;

      const [owner, repo] = input.repository.split('/');
      if (!owner || !repo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid repository format. Use owner/repo',
        });
      }

      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/hooks`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${agent.githubToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            config: {
              url: webhookUrl,
              content_type: 'json',
              secret: process.env.GITHUB_WEBHOOK_SECRET,
            },
            events: ['issue_comment', 'pull_request', 'push'],
            active: true,
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create webhook: ${error.message || 'Unknown error'}`,
        });
      }

      const webhookData = await response.json();

      await ctx.db.agent.update({
        where: { id: input.id },
        data: {
          githubWebhookId: String(webhookData.id),
        },
      });

      return {
        success: true,
        webhookId: webhookData.id,
        webhookUrl,
      };
    }),

  removeWebhook: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        repository: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Agent not found',
        });
      }

      if (!agent.githubToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Agent has no GitHub token',
        });
      }

      if (!agent.githubWebhookId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No webhook configured',
        });
      }

      const [owner, repo] = input.repository.split('/');
      if (!owner || !repo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid repository format',
        });
      }

      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/hooks/${agent.githubWebhookId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${agent.githubToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );

      if (!response.ok && response.status !== 404) {
        const error = await response.json();
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to remove webhook: ${error.message || 'Unknown error'}`,
        });
      }

      await ctx.db.agent.update({
        where: { id: input.id },
        data: {
          githubWebhookId: null,
        },
      });

      return { success: true };
    }),
});
