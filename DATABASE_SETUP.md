# Database Setup Guide

## Quick Setup with Neon (Recommended)

Neon is the easiest and most cost-effective option for getting started with Artificer.

### Step 1: Create Neon Account

1. Go to **https://neon.tech**
2. Click "Sign Up" and authenticate with GitHub
3. You'll be redirected to the dashboard

### Step 2: Create a New Project

1. Click "Create Project" or "New Project"
2. Fill in:
   - **Project name**: `artificer` (or your choice)
   - **Region**: Choose closest to you (e.g., US East, EU West)
   - **Postgres version**: 16 (latest)
3. Click "Create Project"

### Step 3: Get Connection String

1. After creation, you'll see the connection details
2. Copy the **Connection String** (looks like):
   ```
   postgresql://username:password@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
3. Save this for your `.env` file

### Step 4: Configure Artificer

1. **Update `.env` file:**
   ```bash
   cd apps/web
   cp .env.example .env
   ```

2. **Edit `apps/web/.env`:**
   ```env
   # Use the connection string from Neon
   DATABASE_URL="postgresql://username:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

   # Generate encryption key
   ENCRYPTION_KEY="run: openssl rand -hex 32"
   ```

3. **Generate encryption key:**
   ```bash
   openssl rand -hex 32
   ```
   Copy the output and paste it as `ENCRYPTION_KEY` value.

### Step 5: Initialize Database

```bash
# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push
```

You should see:
```
✔ Generated Prisma Client
🚀  Your database is now in sync with your Prisma schema.
```

### Step 6: Test Connection

```bash
# Open Prisma Studio to view your database
pnpm db:studio
```

This opens http://localhost:5555 where you can see your tables.

### Step 7: Start Development

```bash
pnpm dev
```

Visit http://localhost:3000 and create your first user!

---

## Alternative: Supabase Setup

If you want built-in auth and more features:

### Step 1: Create Supabase Project

1. Go to **https://supabase.com**
2. Sign up and create a new project
3. Wait ~2 minutes for provisioning

### Step 2: Get Connection String

1. Go to **Settings → Database**
2. Scroll to **Connection string**
3. Choose **"Connection pooling"** (important for serverless!)
4. Copy the URI string

### Step 3: Configure

```env
# Use connection pooling URL for serverless
DATABASE_URL="postgresql://postgres.xxx:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
```

### Step 4: Initialize

```bash
pnpm db:generate
pnpm db:push
```

**Note:** Supabase includes Auth.js integration, which you'll use in Phase 2!

---

## Alternative: Railway Setup

For full-stack deployment:

### Step 1: Create Railway Account

1. Go to **https://railway.app**
2. Sign up with GitHub
3. Create a new project

### Step 2: Add PostgreSQL

1. Click **"New"** → **"Database"** → **"PostgreSQL"**
2. Wait for provisioning (~30 seconds)

### Step 3: Get Connection String

1. Click on the Postgres service
2. Go to **"Variables"** tab
3. Copy the `DATABASE_URL` value

### Step 4: Configure

```env
DATABASE_URL="postgresql://postgres:password@containers-us-west-xx.railway.app:6379/railway"
```

---

## Alternative: Local Docker (Development Only)

If you prefer running locally:

```bash
# Start PostgreSQL with Docker
docker run --name artificer-postgres \
  -e POSTGRES_DB=artificer \
  -e POSTGRES_USER=artificer \
  -e POSTGRES_PASSWORD=artificer \
  -p 5432:5432 \
  -d postgres:16

# Your .env
DATABASE_URL="postgresql://artificer:artificer@localhost:5432/artificer"
```

**Stop container:**
```bash
docker stop artificer-postgres
```

**Start container:**
```bash
docker start artificer-postgres
```

**Remove container:**
```bash
docker rm -f artificer-postgres
```

---

## Comparison Table

| Service | Free Tier | Best For | Setup Time | Managed |
|---------|-----------|----------|------------|---------|
| **Neon** | 0.5 GB, 3 projects | Development & Production | < 1 min | ✅ Yes |
| **Supabase** | 500 MB, 2 projects | Full-stack with auth | 2 mins | ✅ Yes |
| **Railway** | $5 credit/month | Full deployment | 1 min | ✅ Yes |
| **Vercel Postgres** | Limited | Vercel deployments | 1 min | ✅ Yes |
| **Docker Local** | Unlimited | Local development | 30 sec | ❌ No |

---

## Recommended Choice

**For Artificer, we recommend Neon:**

✅ **Pros:**
- Instant setup
- Generous free tier
- Serverless (scales to zero when not in use)
- Perfect for TanStack Start's server functions
- Great performance
- Database branching for testing

✅ **Perfect for Phase 1:**
- Quick to set up
- No credit card required
- Enough for development and small production use

✅ **Scales for Production:**
- Can upgrade when needed
- Professional features available
- Good pricing

---

## Post-Setup Verification

After setting up your database:

### 1. Test Connection

```bash
pnpm db:studio
```

Should open Prisma Studio at http://localhost:5555

### 2. Verify Tables

You should see these tables:
- users
- accounts
- sessions
- teams
- team_members
- agents
- activities
- agent_metrics
- verification_tokens

### 3. Create Test User

1. Start the app: `pnpm dev`
2. Go to http://localhost:3000/auth/signup
3. Create an account
4. Check Prisma Studio to see the user in the database

---

## Troubleshooting

### Connection Failed

**Error:** `Can't reach database server`

**Solutions:**
1. Check DATABASE_URL is correct
2. Ensure `?sslmode=require` is at the end (for Neon/Supabase)
3. Check your internet connection
4. Verify the database is running (check service dashboard)

### SSL/TLS Errors

**Error:** `SSL connection required`

**Solution:**
Add `?sslmode=require` to your DATABASE_URL:
```env
DATABASE_URL="postgresql://...?sslmode=require"
```

### Schema Sync Issues

**Error:** `Schema is out of sync`

**Solution:**
```bash
pnpm db:generate  # Regenerate Prisma Client
pnpm db:push      # Push schema to database
```

### Permission Errors

**Error:** `permission denied for schema public`

**Solution:**
This usually means wrong credentials. Double-check:
1. Username and password in DATABASE_URL
2. Database name is correct
3. User has proper permissions

---

## Migration from Local to Production

When you're ready to deploy:

### Step 1: Create Production Database

1. Create a new project in Neon (or your chosen service)
2. Name it `artificer-production`
3. Copy the connection string

### Step 2: Update Environment

```bash
# Production .env
DATABASE_URL="postgresql://prod-connection-string"
```

### Step 3: Run Migrations

```bash
# Generate migration files
pnpm db:migrate

# Apply to production
DATABASE_URL="prod-url" pnpm db:migrate deploy
```

---

## Cost Estimates

### Free Tier Limits

**Neon Free:**
- 0.5 GB storage (enough for ~10,000 agents)
- 3 projects
- Unlimited queries

**Supabase Free:**
- 500 MB storage
- 2 projects
- 500 MB database size

**Railway:**
- $5 credit/month (enough for ~500 hours of small DB)

### Paid Plans (if needed)

**Neon Pro:** $19/month
- 10 GB storage
- Higher performance
- More projects

**Supabase Pro:** $25/month
- 8 GB storage
- More features

**Railway:** Pay-as-you-go
- ~$5-15/month for small production DB

---

## Security Best Practices

### 1. Use Connection Pooling

For serverless (TanStack Start):
```env
# Supabase - use pooler URL
DATABASE_URL="...pooler.supabase.com:6543/..."

# Neon - use pooled connection
DATABASE_URL="...neon.tech/neondb?sslmode=require"
```

### 2. Enable SSL

Always include `?sslmode=require`:
```env
DATABASE_URL="postgresql://...?sslmode=require"
```

### 3. Rotate Credentials

Periodically rotate your database password:
1. Generate new password in service dashboard
2. Update DATABASE_URL
3. Redeploy app

### 4. Use Environment Variables

Never commit DATABASE_URL to git:
```bash
# .gitignore already includes:
.env
.env.local
.env.production
```

---

## Summary

**Quick Start (5 minutes):**

1. **Sign up for Neon** → https://neon.tech
2. **Create project** → Copy connection string
3. **Update .env** → Paste DATABASE_URL
4. **Generate key** → `openssl rand -hex 32`
5. **Initialize DB** → `pnpm db:push`
6. **Start app** → `pnpm dev`

**You're done!** The database is ready to use.

---

Need help? Check the main [SETUP.md](./SETUP.md) guide or the Troubleshooting section above.
