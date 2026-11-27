import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: process.env.VITE_APP_BASE || '/lumina/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@lumina/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
  build: {
    outDir: process.env.VITE_OUT_DIR || 'dist',
    // Distinct assets dir so web-admin (/assets) and miniapp (/m-assets) share one Nginx origin cleanly
    assetsDir: 'm-assets',
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
    },
  },
});
