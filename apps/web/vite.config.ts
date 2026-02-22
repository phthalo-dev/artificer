import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsConfigPaths from 'vite-tsconfig-paths';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: path.resolve(__dirname, './app/routes'),
      generatedRouteTree: path.resolve(__dirname, './app/routeTree.gen.ts'),
    }),
    react(),
    tsConfigPaths(),
  ],
  server: {
    port: 3000,
  },
});
