import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8091', '/ws': { target: 'ws://127.0.0.1:8091', ws: true } },
  },
});
