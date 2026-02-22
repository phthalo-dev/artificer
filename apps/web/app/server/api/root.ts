import { createTRPCRouter } from './trpc';
import { agentsRouter } from './routers/agents';
import { activityRouter } from './routers/activity';
import { authRouter } from './routers/auth';
import { metricsRouter } from './routers/metrics';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  agents: agentsRouter,
  activity: activityRouter,
  metrics: metricsRouter,
});

export type AppRouter = typeof appRouter;
