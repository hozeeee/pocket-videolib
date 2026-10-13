import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/** Service Worker 需要作为独立的经典脚本 (/sw.js) 构建 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: fileURLToPath(new URL('./src/sw.ts', import.meta.url)),
      name: 'PocketVideolibSW',
      formats: ['iife'],
      fileName: () => 'sw.js',
    },
  },
})
