import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockApiPlugin } from './mock-api-plugin';

const mockApi = process.env.VITE_MOCK_API === 'true';

export default defineConfig({
  plugins: [react(), ...(mockApi ? [mockApiPlugin()] : [])],
  base: '/',
  server: {
    port: 5173,
  },
});
