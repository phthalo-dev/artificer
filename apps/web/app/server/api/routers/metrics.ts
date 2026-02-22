import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc';

export const metricsRouter = createTRPCRouter({
  // Token Usage
  getTokenUsage: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        sessionId: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.agentId,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        return [];
      }

      const where: any = {
        agentId: input.agentId,
      };

      if (input.sessionId) {
        where.sessionId = input.sessionId;
      }

      if (input.startDate || input.endDate) {
        where.timestamp = {};
        if (input.startDate) {
          where.timestamp.gte = input.startDate;
        }
        if (input.endDate) {
          where.timestamp.lte = input.endDate;
        }
      }

      const usage = await ctx.db.tokenUsage.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: 100,
      });

      return usage;
    }),

  getTokenSummary: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        period: z.enum(['day', 'week', 'month', 'all']).default('week'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.agentId,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        return null;
      }

      let startDate: Date | undefined;
      const now = new Date();

      if (input.period !== 'all') {
        startDate = new Date(now);
        if (input.period === 'day') {
          startDate.setDate(startDate.getDate() - 1);
        } else if (input.period === 'week') {
          startDate.setDate(startDate.getDate() - 7);
        } else if (input.period === 'month') {
          startDate.setMonth(startDate.getMonth() - 1);
        }
      }

      const where: any = {
        agentId: input.agentId,
      };

      if (startDate) {
        where.timestamp = { gte: startDate };
      }

      const [usage, byModel] = await Promise.all([
        ctx.db.tokenUsage.findMany({ where }),
        ctx.db.tokenUsage.groupBy({
          by: ['model'],
          where,
          _sum: {
            inputTokens: true,
            outputTokens: true,
            costUSD: true,
          },
          _count: true,
        }),
      ]);

      const totalInputTokens = usage.reduce((sum, u) => sum + u.inputTokens, 0);
      const totalOutputTokens = usage.reduce(
        (sum, u) => sum + u.outputTokens,
        0,
      );
      const totalCost = usage.reduce((sum, u) => sum + u.costUSD, 0);
      const totalRequests = usage.length;

      return {
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalCost,
        totalRequests,
        byModel: byModel.map((m) => ({
          model: m.model,
          inputTokens: m._sum.inputTokens || 0,
          outputTokens: m._sum.outputTokens || 0,
          costUSD: m._sum.costUSD || 0,
          requestCount: m._count,
        })),
      };
    }),

  // Agent Sessions
  listSessions: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        status: z.enum(['ACTIVE', 'COMPLETED', 'ABORTED']).optional(),
        limit: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const agent = await ctx.db.agent.findFirst({
        where: {
          id: input.agentId,
          userId: ctx.session.user.id,
        },
      });

      if (!agent) {
        return [];
      }

      const where: any = {
        agentId: input.agentId,
      };

      if (input.status) {
        where.status = input.status;
      }

      const sessions = await ctx.db.agentSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        include: {
          _count: {
            select: {
              messages: true,
              toolCalls: true,
              fileEdits: true,
            },
          },
        },
      });

      return sessions;
    }),

  // Tool Calls
  getToolCalls: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().optional(),
        agentId: z.string().optional(),
        status: z
          .enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'])
          .optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: any = {};

      if (input.sessionId) {
        const session = await ctx.db.agentSession.findFirst({
          where: {
            id: input.sessionId,
            agent: { userId: ctx.session.user.id },
          },
        });
        if (!session) return [];
        where.sessionId = input.sessionId;
      } else if (input.agentId) {
        const agent = await ctx.db.agent.findFirst({
          where: {
            id: input.agentId,
            userId: ctx.session.user.id,
          },
        });
        if (!agent) return [];
        where.session = { agentId: input.agentId };
      } else {
        where.session = { agent: { userId: ctx.session.user.id } };
      }

      if (input.status) {
        where.status = input.status;
      }

      const toolCalls = await ctx.db.toolCall.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: input.limit,
        include: {
          session: {
            select: {
              id: true,
              title: true,
              agent: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      return toolCalls;
    }),

  // File Edits
  getFileEdits: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().optional(),
        agentId: z.string().optional(),
        operation: z.enum(['CREATE', 'EDIT', 'DELETE']).optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: any = {};

      if (input.sessionId) {
        const session = await ctx.db.agentSession.findFirst({
          where: {
            id: input.sessionId,
            agent: { userId: ctx.session.user.id },
          },
        });
        if (!session) return [];
        where.sessionId = input.sessionId;
      } else if (input.agentId) {
        const agent = await ctx.db.agent.findFirst({
          where: {
            id: input.agentId,
            userId: ctx.session.user.id,
          },
        });
        if (!agent) return [];
        where.session = { agentId: input.agentId };
      } else {
        where.session = { agent: { userId: ctx.session.user.id } };
      }

      if (input.operation) {
        where.operation = input.operation;
      }

      const fileEdits = await ctx.db.fileEdit.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: input.limit,
        include: {
          session: {
            select: {
              id: true,
              title: true,
              agent: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      return fileEdits;
    }),

  // Messages
  getMessages: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.agentSession.findFirst({
        where: {
          id: input.sessionId,
          agent: { userId: ctx.session.user.id },
        },
      });

      if (!session) {
        return [];
      }

      const messages = await ctx.db.message.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { timestamp: 'asc' },
        take: input.limit,
      });

      return messages;
    }),

  // Aggregate dashboard metrics
  getDashboardSummary: protectedProcedure
    .input(
      z.object({
        teamId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: any = {
        userId: ctx.session.user.id,
      };

      if (input.teamId) {
        where.teamId = input.teamId;
      }

      const [agents, recentActivity, recentTokenUsage] = await Promise.all([
        ctx.db.agent.findMany({
          where,
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
          },
        }),
        ctx.db.activity.findMany({
          where: {
            agent: where,
          },
          orderBy: { timestamp: 'desc' },
          take: 10,
          include: {
            agent: {
              select: { name: true },
            },
          },
        }),
        ctx.db.tokenUsage.findMany({
          where: {
            agent: where,
            timestamp: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
      ]);

      const runningAgents = agents.filter((a) => a.status === 'RUNNING').length;
      const totalCost = recentTokenUsage.reduce((sum, u) => sum + u.costUSD, 0);
      const totalTokens = recentTokenUsage.reduce(
        (sum, u) => sum + u.inputTokens + u.outputTokens,
        0,
      );

      return {
        totalAgents: agents.length,
        runningAgents,
        recentActivity,
        weeklyCost: totalCost,
        weeklyTokens: totalTokens,
      };
    }),
});
