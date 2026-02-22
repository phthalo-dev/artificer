# Artificer Setup Guide

This guide will help you set up Artificer for local development with the new TanStack Start architecture.

## Prerequisites

- **Node.js** 20+ (LTS recommended)
- **pnpm** 8+ (install via `npm install -g pnpm`)
- **PostgreSQL** 14+ (local or hosted)
- **AWS Account** (for EC2 deployment, Phase 2)
- **Anthropic API Key** (for agents to use Claude)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

This installs all dependencies for the monorepo using pnpm workspaces.

### 2. Set Up Environment Variables

Copy the example environment file:

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `apps/web/.env` and configure the following:

#### Required Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/artificer"

# Encryption (for storing GitHub tokens, SSH keys, etc.)
ENCRYPTION_KEY="generate-with-openssl-rand-hex-32"
```

**Generate encryption key:**
```bash
openssl rand -hex 32
```

#### Optional Variables (for Phase 2+)

```env
# AWS Configuration (for EC2 provisioning)
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"

# EC2 Configuration
EC2_KEY_NAME="your-ec2-key-pair-name"
EC2_SECURITY_GROUP_ID="sg-xxxxx"
EC2_SUBNET_ID="subnet-xxxxx"
EC2_INSTANCE_TYPE="t3.medium"
```

### 3. Set Up PostgreSQL Database

#### Option A: Local PostgreSQL

Install PostgreSQL locally and create a database:

```bash
createdb artificer
```

Update `DATABASE_URL` in `.env`:
```env
DATABASE_URL="postgresql://username@localhost:5432/artificer"
```

#### Option B: Docker PostgreSQL

```bash
docker run --name artificer-postgres \
  -e POSTGRES_DB=artificer \
  -e POSTGRES_USER=artificer \
  -e POSTGRES_PASSWORD=artificer \
  -p 5432:5432 \
  -d postgres:14
```

Use this DATABASE_URL:
```env
DATABASE_URL="postgresql://artificer:artificer@localhost:5432/artificer"
```

### 4. Initialize Database

Generate Prisma client and create database tables:

```bash
pnpm db:generate  # Generate Prisma client types
pnpm db:push      # Push schema to database
```

This creates all necessary tables based on the Prisma schema.

### 5. Start Development Server

```bash
pnpm dev
```

The application will be available at:
- **Web UI**: http://localhost:3000

You should see:
```
@artificer/shared:dev: Found 0 errors. Watching for file changes.
@artificer/web:dev: ▲ TanStack Start
@artificer/web:dev:    - Local:        http://localhost:3000
@artificer/web:dev:  ✓ Ready in 1500ms
```

### 6. Create Your First User

1. Navigate to http://localhost:3000
2. Click "Get Started" or go to http://localhost:3000/auth/signup
3. Create an account with email and password
4. You'll be redirected to sign in
5. Sign in to access the dashboard

## Development Commands

```bash
# Development
pnpm dev          # Start all services with hot reload
pnpm build        # Build all packages for production
pnpm type-check   # Run TypeScript type checking
pnpm lint         # Run ESLint on all packages

# Database
pnpm db:generate  # Generate Prisma client (run after schema changes)
pnpm db:push      # Push schema to database (no migrations)
pnpm db:migrate   # Create and run migrations
pnpm db:studio    # Open Prisma Studio (database GUI)

# Cleanup
pnpm clean        # Remove all build artifacts and node_modules
```

## Project Structure

```
artificer/
├── apps/
│   └── web/                      # TanStack Start application
│       ├── app/
│       │   ├── routes/           # File-based routes
│       │   │   ├── __root.tsx    # Root layout
│       │   │   ├── index.tsx     # Landing page
│       │   │   ├── auth/         # Auth pages
│       │   │   ├── dashboard/    # Dashboard pages
│       │   │   └── api/          # API routes
│       │   ├── components/
│       │   │   └── ui/           # React Aria components
│       │   ├── server/
│       │   │   ├── api/          # tRPC routers
│       │   │   ├── db.ts         # Prisma client
│       │   │   └── env.ts        # Environment validation
│       │   ├── lib/              # Utilities
│       │   ├── styles/           # CSS files
│       │   ├── client.tsx        # Client entry point
│       │   └── ssr.tsx           # Server entry point
│       ├── prisma/
│       │   └── schema.prisma     # Database schema
│       ├── app.config.ts         # TanStack Start config
│       └── package.json
│
├── packages/
│   └── shared/                   # Shared code
│       ├── src/
│       │   ├── types/            # Shared TypeScript types
│       │   ├── constants/        # Constants
│       │   └── utils/            # Shared utilities
│       └── package.json
│
├── package.json                  # Root workspace config
├── turbo.json                    # Turborepo config
└── pnpm-workspace.yaml           # pnpm workspace config
```

## Testing the Application

### 1. Landing Page

Navigate to http://localhost:3000 and verify:
- Landing page renders correctly
- "Sign In" and "Get Started" buttons work
- Links navigate properly

### 2. Sign Up

1. Go to http://localhost:3000/auth/signup
2. Fill in the form:
   - Name: "Test User"
   - Email: "test@example.com"
   - Password: "password123" (min 8 chars)
3. Submit the form
4. Verify user is created in database

**Check database:**
```bash
pnpm db:studio
# Open Users table and verify your user exists
```

### 3. Create an Agent

1. Sign in at http://localhost:3000/auth/signin
2. Navigate to "Agents" or click "Create Agent"
3. Fill in the form:
   - Agent Name: "Test Agent"
   - GitHub Username: "test-bot"
   - GitHub Email: "bot@example.com"
   - GitHub Token: (use a test token or placeholder)
   - Anthropic API Key: (use your key or placeholder)
4. Submit and verify:
   - Agent appears in database
   - Credentials are encrypted
   - You're redirected to agent detail page

**Note**: In Phase 1, agents are created in the database but EC2 instances are not provisioned yet.

### 4. Dashboard Features

Test all dashboard pages:
- `/dashboard` - View overview with stats
- `/dashboard/agents` - See agent list
- `/dashboard/agents/:id` - View agent details
- `/dashboard/activity` - View activity feed

## TanStack Start Features

### File-Based Routing

Routes are automatically generated from files in `app/routes/`:

```
app/routes/
├── __root.tsx           → (layout, not a route)
├── index.tsx            → /
├── auth/
│   ├── signin.tsx       → /auth/signin
│   └── signup.tsx       → /auth/signup
├── dashboard.tsx        → /dashboard (layout)
└── dashboard/
    ├── index.tsx        → /dashboard
    ├── agents/
    │   ├── index.tsx    → /dashboard/agents
    │   ├── new.tsx      → /dashboard/agents/new
    │   └── $id.tsx      → /dashboard/agents/:id (dynamic)
    └── activity.tsx     → /dashboard/activity
```

### React Aria Components

All UI components use React Aria for accessibility:

```typescript
import { Button } from '~/components/ui/button';
import { TextField, Label, Input } from 'react-aria-components';

// Button with press handling
<Button onPress={() => console.log('clicked')}>
  Click Me
</Button>

// Form field
<TextField>
  <Label>Email</Label>
  <Input type="email" />
</TextField>
```

### tRPC API Usage

Type-safe API calls with tRPC:

```typescript
import { trpc } from '~/lib/trpc';

function MyComponent() {
  // Query
  const { data, isLoading } = trpc.agents.list.useQuery();

  // Mutation
  const createAgent = trpc.agents.create.useMutation();

  const handleCreate = async () => {
    await createAgent.mutateAsync({
      name: 'New Agent',
      // ...
    });
  };
}
```

## Database Management

### View Database

Open Prisma Studio to view and edit records:

```bash
pnpm db:studio
```

This opens a GUI at http://localhost:5555

### Schema Changes

When you modify `prisma/schema.prisma`:

```bash
# For development (no migrations)
pnpm db:generate  # Update Prisma client
pnpm db:push      # Push changes to database

# For production (with migrations)
pnpm db:migrate   # Create migration
```

### Reset Database

To completely reset the database:

```bash
pnpm db:push --force-reset
```

**Warning**: This deletes all data!

## Troubleshooting

### Port Already in Use

If port 3000 is in use:

```bash
PORT=3001 pnpm dev
```

### Database Connection Issues

**Check PostgreSQL is running:**
```bash
pg_isready
```

**Verify connection string:**
```bash
psql $DATABASE_URL -c "SELECT version();"
```

**Common issues:**
- Wrong password in DATABASE_URL
- PostgreSQL not running
- Database doesn't exist (run `createdb artificer`)

### Prisma Client Errors

If you see "Prisma Client not generated":

```bash
pnpm db:generate
```

### Type Errors

If TypeScript shows errors:

```bash
# Check for errors
pnpm type-check

# Rebuild packages
pnpm build
```

### Route Not Found

TanStack Router generates routes automatically. If routes aren't working:

1. Stop the dev server
2. Delete `.vinxi` and `.tanstack` directories
3. Restart: `pnpm dev`

### tRPC Connection Errors

If API calls fail:

1. Check browser console for errors
2. Verify `/api/trpc/$` route exists
3. Check tRPC provider in `__root.tsx`
4. Verify environment variables are loaded

## Next Steps

After completing Phase 1 setup:

1. ✅ **Working web application** with all pages
2. ✅ **Database** with users and agents
3. ✅ **tRPC API** for backend operations
4. ⏳ **Phase 2**: Implement Auth.js for real sessions
5. ⏳ **Phase 2**: Build orchestrator service for EC2
6. ⏳ **Phase 3**: GitHub integration and SSH setup
7. ⏳ **Phase 4**: Activity tracking and observability
8. ⏳ **Phase 5**: Slack integration

## Architecture Overview

### Frontend (TanStack Start)
- **Framework**: TanStack Start (React + Router + Server)
- **UI**: React Aria Components
- **Styling**: Tailwind CSS
- **Type Safety**: Full TypeScript coverage

### Backend (tRPC + Prisma)
- **API**: tRPC v11 with type-safe endpoints
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Auth.js (to be implemented)
- **Encryption**: AES-256-GCM for credentials

### Development (Monorepo)
- **Monorepo**: Turborepo + pnpm workspaces
- **Build**: Vite/Vinxi for fast HMR
- **Type Checking**: TypeScript strict mode
- **Linting**: ESLint + Prettier

## Getting Help

- **Documentation**: See `MIGRATION_TO_TANSTACK.md` for migration details
- **Implementation**: See `TANSTACK_IMPLEMENTATION_COMPLETE.md` for full docs
- **TanStack Start**: https://tanstack.com/start/latest
- **React Aria**: https://react-spectrum.adobe.com/react-aria/
- **tRPC**: https://trpc.io/

## Production Deployment

See deployment documentation (to be created in Phase 6) for:
- Environment setup
- Database migrations
- SSL/TLS configuration
- EC2 provisioning
- Monitoring and logging

---

**Current Status**: Phase 1 Complete ✅

The foundation is ready for building out the agent orchestration and real-time features!
