import path from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: '/lumina/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@lumina/shared-types': path.resolve(__dirname, '../../packages/shared-types/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3100',
        ws: true,
      },
    },
  },
});
