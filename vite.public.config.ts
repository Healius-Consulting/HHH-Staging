import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'apps/public'),
  publicDir: resolve(__dirname, 'public'),
  envDir: __dirname,
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_SURFACE': JSON.stringify('public'), 'import.meta.env.VITE_AUTH_MODE': JSON.stringify('cookie') },
  server: { port: 5174, proxy: { '/v1': 'http://127.0.0.1:8080', '/health': 'http://127.0.0.1:8080' } },
  build: { outDir: resolve(__dirname, 'dist-public'), emptyOutDir: true, sourcemap: false },
});
