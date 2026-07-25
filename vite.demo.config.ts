import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'

export default defineConfig({
  root: 'demo',
  resolve: {
    alias: [
      {
        find: /^three-windline\/fields$/,
        replacement: fileURLToPath(new URL('./src/fields/index.ts', import.meta.url)),
      },
      {
        find: /^three-windline$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
    dedupe: ['three'],
  },
  build: {
    outDir: '../site-dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 4192,
    strictPort: false,
  },
})
