import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served from https://secretvoip.com/smtp/
// All assets and React Router routes must be under /smtp/.
export default defineConfig({
  base: '/smtp/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // For local dev, mirror the production path layout
      '/smtp/api': {
        target: 'http://127.0.0.1:4010',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/smtp\/api/, '/api'),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});
