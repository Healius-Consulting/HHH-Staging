import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'apps/pharmacy'),
  publicDir: resolve(__dirname, 'public'),
  envDir: __dirname,
  plugins: [react()],
  resolve: { alias: [{ find: /^\.\/pages\/AdminPortal$/, replacement: resolve(__dirname, 'src/surfaces/UnavailableSurface.tsx') }] },
  define: {
    'import.meta.env.VITE_APP_SURFACE': JSON.stringify('pharmacy'),
    'import.meta.env.VITE_AUTH_MODE': JSON.stringify('cookie'),
    'import.meta.env.VITE_APP_PATH_PREFIX': JSON.stringify(process.env.HHH_SURFACE === 'portal' ? '/pharmacy' : ''),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env.HHH_SURFACE === 'portal' ? '/pharmacy' : ''),
  },
  server: { port: 5173, proxy: { '/v1': 'http://127.0.0.1:8080', '/health': 'http://127.0.0.1:8080' } },
  build: { outDir: resolve(__dirname, 'dist-pharmacy'), emptyOutDir: true, sourcemap: false },
});
