import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEV_API_PORT, DEV_API_TOKEN } from '../server/src/dev-token.ts';

const devApi = process.env.SCIA_DEV_API ?? `http://127.0.0.1:${String(DEV_API_PORT)}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The proxy adds the dev token, so a plain browser tab works without the preload. The engine
    // answers only its own host name, so the proxy presents itself as the engine's origin.
    proxy: {
      '/api': {
        target: devApi,
        changeOrigin: true,
        headers: { authorization: `Bearer ${DEV_API_TOKEN}` },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
