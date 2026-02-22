# Artificer

A platform for managing remote AI coding agents running on EC2 instances. Each agent acts as an autonomous "developer" with its own GitHub account, SSH keys, and the ability to create commits, PRs, and review code.

## Features

- 🤖 **Autonomous AI Agents**: Deploy AI coding agents with their own GitHub identities
- ☁️ **EC2-Based**: Each agent runs on a dedicated EC2 instance
- 🔍 **Full Observability**: Real-time monitoring and activity tracking
- 💬 **Multi-Channel Communication**: Web UI and Slack integration
- 🔒 **Secure**: Encrypted credential storage and isolated environments
- 🚀 **Self-Hostable**: Open-source and ready to deploy on your own infrastructure

## Architecture

Artificer uses a control plane architecture with:
- **TanStack Start Web App**: Modern full-stack React framework for managing agents
- **PostgreSQL Database**: Stores agent configurations and activity logs
- **Orchestrator Service**: Manages EC2 instances and agent lifecycle
- **OpenCode Agents**: AI coding agents running on EC2 instances

## Tech Stack

- **Frontend Framework**: TanStack Start (React + TanStack Router)
- **UI Components**: React Aria (Adobe's accessible component library)
- **Backend API**: tRPC v11
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Auth.js
- **Cloud**: AWS (EC2, VPC, CloudWatch)
- **Agent Framework**: OpenCode
- **LLM Provider**: Anthropic (Claude)
- **Build Tool**: Vite/Vinxi
- **Monorepo**: Turborepo with pnpm

## Project Structure

```
artificer/
├── apps/
│   ├── web/              # TanStack Start web application
│   │   ├── app/          # Application code
│   │   │   ├── routes/   # File-based routes
│   │   │   ├── components/ # React Aria components
│   │   │   ├── server/   # tRPC API & database
│   │   │   └── lib/      # Utilities
│   │   └── prisma/       # Database schema
│   └── orchestrator/     # Agent orchestrator service (Phase 2)
├── packages/
│   ├── shared/           # Shared TypeScript code
│   ├── agent-setup/      # EC2 agent setup scripts (Phase 2)
│   └── slack-bot/        # Slack integration (Phase 5)
└── infrastructure/       # Terraform configs (Phase 2)
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL 14+
- AWS Account (for EC2 deployment, Phase 2)
- Anthropic API Key (for agents)

### Quick Start

1. **Clone the repository:**
```bash
git clone https://github.com/yourusername/artificer.git
cd artificer
```

2. **Install dependencies:**
```bash
pnpm install
```

3. **Set up environment:**
```bash
cp apps/web/.env.example apps/web/.env
# Edit .env with your DATABASE_URL and ENCRYPTION_KEY
```

Required environment variables:
- `DATABASE_URL` - PostgreSQL connection string
- `ENCRYPTION_KEY` - 32-character hex string (generate with: `openssl rand -hex 32`)

4. **Initialize database:**
```bash
pnpm db:generate  # Generate Prisma client
pnpm db:push      # Create database tables
```

5. **Start development:**
```bash
pnpm dev
```

6. **Open in browser:**
Visit [http://localhost:3000](http://localhost:3000)

### First Steps

1. **Sign Up** - Create an account at `/auth/signup`
2. **Create Agent** - Set up your first AI coding agent
3. **View Dashboard** - Monitor agent activity and status

> **Note:** EC2 provisioning is not yet implemented (Phase 2). Agents are created in the database with encrypted credentials but won't provision actual instances yet.

## Development

```bash
pnpm dev          # Start all services in development mode
pnpm build        # Build all apps and packages
pnpm lint         # Lint all packages
pnpm type-check   # Run TypeScript type checking

# Database commands
pnpm db:generate  # Generate Prisma client
pnpm db:push      # Push schema changes to database
pnpm db:migrate   # Create and run migrations
pnpm db:studio    # Open Prisma Studio (database GUI)
```

## Key Technologies

### TanStack Start
Modern full-stack React framework with:
- File-based routing with type safety
- Server functions for API endpoints
- Built-in data loading and caching
- Powered by Vite for fast builds

### React Aria
Adobe's accessible component library:
- Headless components (full styling control)
- WCAG 2.1 Level AA compliant
- Excellent keyboard navigation
- Mobile-friendly touch interactions

### tRPC
End-to-end type-safe API:
- Full TypeScript inference
- Auto-generated types
- Integrated with TanStack Query
- No code generation needed

## Deployment

### Self-Hosted

See [docs/self-hosting.md](docs/self-hosting.md) for detailed self-hosting instructions.

### Managed Service

Visit [artificer.io](https://artificer.io) to use the hosted version.

## Documentation

- [Architecture Overview](docs/architecture.md)
- [API Documentation](docs/api.md)
- [Self-Hosting Guide](docs/self-hosting.md)

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Documentation: [docs/](docs/)
- Issues: [GitHub Issues](https://github.com/yourusername/artificer/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/artificer/discussions)
