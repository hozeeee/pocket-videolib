import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'
import pkg from './package.json' with { type: 'json' }

function readWebAsset(name: string): string {
  const file = new URL(`./web/dist/${name}`, import.meta.url)
  if (!existsSync(file))
    throw new Error(`Missing web/dist/${name}, run "npm run build:web" first.`)
  return readFileSync(file, 'utf8')
}

export default defineConfig({
  entry: { 'pocket-videolib': 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  outDir: 'dist',
  clean: true,
  minify: true,
  splitting: false,
  sourcemap: false,
  // 零运行时依赖：任何依赖都打进单文件
  noExternal: [/.*/],
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __WEB_INDEX_HTML__: JSON.stringify(readWebAsset('index.html')),
    __WEB_SW_JS__: JSON.stringify(readWebAsset('sw.js')),
  },
})
