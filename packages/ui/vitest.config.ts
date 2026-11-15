import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Must match the workspace-wide maxWorkers in the root vite.config.ts.
    maxWorkers: 4,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
