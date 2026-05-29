import { createFileRoute, Outlet, Link } from '@tanstack/react-router';
import { Button } from '~/components/ui/button';
import { useAuth } from './__root';

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!token) {
    window.location.href = '/auth/signin';
    return null;
  }

  // TODO: Add auth check here
  // const session = Route.useLoaderData();

  const handleSignOut = () => {
    // TODO: Implement Auth.js sign out
    console.log('Sign out');
    window.location.href = '/';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="flex flex-shrink-0 items-center">
                <Link to="/dashboard" className="text-xl font-bold">
                  Artificer
                </Link>
              </div>
              <div className="ml-6 flex space-x-8">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-900 hover:border-gray-300"
                  activeProps={{
                    className: 'border-primary',
                  }}
                >
                  Dashboard
                </Link>
                <Link
                  to="/dashboard/agents"
                  className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  activeProps={{
                    className: 'border-primary text-gray-900',
                  }}
                >
                  Agents
                </Link>
                <Link
                  to="/dashboard/activity"
                  className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  activeProps={{
                    className: 'border-primary text-gray-900',
                  }}
                >
                  Activity
                </Link>
              </div>
            </div>
            <div className="flex items-center">
              <span className="mr-4 text-sm text-gray-700">
                user@example.com {/* TODO: Get from session */}
              </span>
              <Button variant="outline" size="sm" onPress={handleSignOut}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
