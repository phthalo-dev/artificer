# Legacy CDK stacks (pre-runtime architecture)

These stacks deployed an always-on control plane:

- **CoreStack** — VPC with NAT Gateway, agent security groups, S3 logs
- **DatabaseStack** — Aurora Serverless v2
- **ComputeStack** — Fargate orchestrator (always-on)
- **AgentStack** — EC2-per-agent launch template
- **AmplifyStack** — optional Amplify hosting

They are **not deployed** by the current [`bin/artificer.ts`](../bin/artificer.ts). Kept for reference only.

Use [`runtime-stack.ts`](../runtime-stack.ts) for personal hibernating deployment.
