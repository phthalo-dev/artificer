import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useState, useEffect, useRef, createContext, useContext } from 'react';
import superjson from 'superjson';
import { trpc } from '../lib/trpc';
import '../styles/app.css';

const AuthContext = createContext<{
  token: string | null;
  isLoading: boolean;
  setToken: (token: string | null) => void;
}>({
  token: null,
  isLoading: true,
  setToken: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Use a ref so the tRPC client's headers() closure always reads the latest token
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Load token from localStorage on mount
    const stored = localStorage.getItem('auth-token');
    if (stored) {
      tokenRef.current = stored;
      setTokenState(stored);
    }
    setIsLoading(false);
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
            // Read from ref so this always gets the current token even though
            // the client is only created once
            const t = tokenRef.current;
            return t ? { Authorization: `Bearer ${t}` } : {};
          },
        }),
      ],
    }),
  );

  const handleSetToken = (newToken: string | null) => {
    tokenRef.current = newToken;
    setTokenState(newToken);
    if (newToken) {
      localStorage.setItem('auth-token', newToken);
    } else {
      localStorage.removeItem('auth-token');
    }
  };

  return (
    <AuthContext.Provider value={{ token, isLoading, setToken: handleSetToken }}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Outlet />
          <TanStackRouterDevtools position="bottom-right" />
        </QueryClientProvider>
      </trpc.Provider>
    </AuthContext.Provider>
  );
}
