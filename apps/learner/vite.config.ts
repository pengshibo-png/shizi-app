import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');

export default defineConfig({
  plugins: [react()],
  // Capacitor 用 file:// 加载，必须用相对路径
  base: './',
  resolve: {
    alias: {
      '@shi/ui': resolve(ROOT, 'packages/ui/src/index.ts'),
      '@shi/core': resolve(ROOT, 'packages/core/src/index.ts'),
      '@shi/content': resolve(ROOT, 'packages/content/index.js'),
    },
  },
  // 字体与音频直接从内容包提供，不复制副本（1800+ 文件）
  publicDir: resolve(ROOT, 'packages/content/assets'),
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    // 老人设备多为低配安卓，控制单块体积
    chunkSizeWarningLimit: 900,
  },
});