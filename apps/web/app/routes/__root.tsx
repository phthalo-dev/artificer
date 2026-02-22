import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useState, useEffect, createContext, useContext } from 'react';
import superjson from 'superjson';
import { trpc } from '../lib/trpc';
import '../styles/app.css';

const AuthContext = createContext<{
  token: string | null;
  setToken: (token: string | null) => void;
}>({
  token: null,
  setToken: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Load token from localStorage on mount
    const stored = localStorage.getItem('auth-token');
    if (stored) setToken(stored);
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: 'http://localhost:3001/api/trpc',
          transformer: superjson,
          headers() {
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      ],
    }),
  );

  const handleSetToken = (newToken: string | null) => {
    setToken(newToken);
    if (newToken) {
      localStorage.setItem('auth-token', newToken);
    } else {
      localStorage.removeItem('auth-token');
    }
  };

  return (
    <AuthContext.Provider value={{ token, setToken: handleSetToken }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Outlet />
          <TanStackRouterDevtools position="bottom-right" />
        </QueryClientProvider>
      </trpc.Provider>
    </AuthContext.Provider>
  );
}
