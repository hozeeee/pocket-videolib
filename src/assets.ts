import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type WebAssetName = 'index.html' | 'sw.js'

/** 构建时由 tsup 内联进最终的单文件产物 */
const EMBEDDED: Record<WebAssetName, string | undefined> = {
  'index.html': typeof __WEB_INDEX_HTML__ === 'string' ? __WEB_INDEX_HTML__ : undefined,
  'sw.js': typeof __WEB_SW_JS__ === 'string' ? __WEB_SW_JS__ : undefined,
}

/** 开发模式下从 web/dist 读取，便于调试已构建的前端 */
function readFromDisk(name: WebAssetName): string | undefined {
  try {
    return readFileSync(fileURLToPath(new URL(`../web/dist/${name}`, import.meta.url)), 'utf8')
  }
  catch {
    return undefined
  }
}

export function getWebAsset(name: WebAssetName): string | undefined {
  return EMBEDDED[name] ?? readFromDisk(name)
}
