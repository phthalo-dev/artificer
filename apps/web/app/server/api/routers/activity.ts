import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '../trpc';
import { ActivityType } from '@artificer/shared';

export const activityRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        agentId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        type: z.nativeEnum(ActivityType).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { agentId, limit, cursor, type } = input;

      // Build where clause
      const where: any = {};

      if (agentId) {
        // Verify the agent belongs to the user
        const agent = await ctx.db.agent.findFirst({
          where: {
            id: agentId,
            userId: ctx.session.user.id,
          },
        });

        if (!agent) {
          return { items: [], nextCursor: undefined };
        }

        where.agentId = agentId;
      } else {
        // Get all agents for the user
        const userAgents = await ctx.db.agent.findMany({
          where: { userId: ctx.session.user.id },
          select: { id: true },
        });

        where.agentId = {
          in: userAgents.map((a) => a.id),
        };
      }

      if (type) {
        where.type = type;
      }

      if (cursor) {
        where.id = {
          lt: cursor,
        };
      }

      const activities = await ctx.db.activity.findMany({
        where,
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              githubUsername: true,
            },
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: limit + 1,
      });

      let nextCursor: string | undefined = undefined;
      if (activities.length > limit) {
        const nextItem = activities.pop();
        nextCursor = nextItem!.id;
      }

      return {
        items: activities,
        nextCursor,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const activity = await ctx.db.activity.findFirst({
        where: {
          id: input.id,
          agent: {
            userId: ctx.session.user.id,
          },
        },
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              githubUsername: true,
            },
          },
        },
      });

      return activity;
    }),

  getMetrics: protectedProcedure
    .input(
      z.object({
        agentId: z.string(),
        metricType: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Verify the agent belongs to the user
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

      if (input.metricType) {
        where.metricType = input.metricType;
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

      const metrics = await ctx.db.agentMetric.findMany({
        where,
        orderBy: {
          timestamp: 'asc',
        },
      });

      return metrics;
    }),
});
