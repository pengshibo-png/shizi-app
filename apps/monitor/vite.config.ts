import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      // CSS 子路径必须排在包名别名之前，否则 '@shi/ui' 前缀会先匹配掉
      // '@shi/ui/tokens.css'，解析成 src/index.ts/tokens.css 而失败。
      { find: '@shi/ui/tokens.css', replacement: resolve(ROOT, 'packages/ui/src/tokens.css') },
      { find: '@shi/ui/components.css', replacement: resolve(ROOT, 'packages/ui/src/components.css') },
      { find: '@shi/ui', replacement: resolve(ROOT, 'packages/ui/src/index.ts') },
      { find: '@shi/core', replacement: resolve(ROOT, 'packages/core/src/index.ts') },
    ],
  },
  server: { port: 5174, host: true },
});