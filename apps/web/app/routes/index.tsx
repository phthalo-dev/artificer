import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '../components/ui/button';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-[5rem]">
          Artificer
        </h1>
        <p className="text-center text-2xl text-white/80">
          Autonomous AI Coding Agents on EC2
        </p>
        <div className="flex gap-4">
          <Link to="/auth/signin">
            <Button variant="secondary" size="lg">
              Sign In
            </Button>
          </Link>
          <Link to="/auth/signup">
            <Button size="lg">Get Started</Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-8">
          <div className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4 hover:bg-white/20">
            <h3 className="text-2xl font-bold">Deploy Agents →</h3>
            <div className="text-lg text-white/80">
              Spin up AI coding agents on dedicated EC2 instances with their own GitHub identities
            </div>
          </div>
          <div className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4 hover:bg-white/20">
            <h3 className="text-2xl font-bold">Full Observability →</h3>
            <div className="text-lg text-white/80">
              Monitor agent activities, commits, PRs, and metrics in real-time
            </div>
          </div>
          <div className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4 hover:bg-white/20">
            <h3 className="text-2xl font-bold">Multi-Channel →</h3>
            <div className="text-lg text-white/80">
              Interact with agents via web dashboard or Slack integration
            </div>
          </div>
          <div className="flex max-w-xs flex-col gap-4 rounded-xl bg-white/10 p-4 hover:bg-white/20">
            <h3 className="text-2xl font-bold">Self-Hostable →</h3>
            <div className="text-lg text-white/80">
              Open-source platform ready to deploy on your own infrastructure
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
