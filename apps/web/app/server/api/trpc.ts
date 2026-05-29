import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { db } from '../db';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-in-production',
);

export const createTRPCContext = async (opts: any) => {
  let session = null;

  // Handle both express adapter ({ req, res }) and fetch adapter ({ headers })
  let authHeader: string | undefined;
  if ('req' in opts && opts.req?.headers) {
    // Express adapter: headers live on opts.req.headers (plain object, lowercase keys)
    const h = opts.req.headers as Record<string, string | string[] | undefined>;
    const raw = h['authorization'];
    authHeader = Array.isArray(raw) ? raw[0] : raw;
  } else if ('headers' in opts && opts.headers) {
    const h = opts.headers as Headers | Record<string, string>;
    authHeader =
      typeof (h as Headers).get === 'function'
        ? ((h as Headers).get('authorization') ?? undefined)
        : (h as Record<string, string>)['authorization'];
  }

  if (authHeader) {
    const tokenMatch = authHeader.match(/^Bearer (.+)$/);
    if (tokenMatch) {
      try {
        const { payload } = await jwtVerify(tokenMatch[1], JWT_SECRET);
        const userId = payload.userId as string;
        const user = await db.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, name: true },
        });
        if (user) {
          session = { user };
        }
      } catch {
        // Invalid token, ignore
      }
    }
  }

  return {
    db,
    session,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
