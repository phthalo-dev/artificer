import '@var-ui/core/styles.css';
import './styles/global';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultIcons } from '@var-ui/icons';
import {
  DesignSystemProvider,
  IconProvider,
  ToastProvider,
} from '@var-ui/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-aria-components';
import { BrowserRouter, useHref, useNavigate } from 'react-router-dom';
import { App } from './App.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Lets Var UI links (React Aria `Link` under the hood) navigate client-side. */
function AriaRouter({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <RouterProvider navigate={navigate} useHref={useHref}>
      {children}
    </RouterProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesignSystemProvider applyToDocument storageKey="theme">
      <IconProvider icons={defaultIcons}>
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <AriaRouter>
                <App />
              </AriaRouter>
            </BrowserRouter>
          </QueryClientProvider>
        </ToastProvider>
      </IconProvider>
    </DesignSystemProvider>
  </React.StrictMode>,
);
