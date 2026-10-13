import type { DirectoryEntry, ListResponse, ServerInfo } from '../../shared/api'
import type { AppConfig } from '../config'
import type { Request, Response } from '../utils/http'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getRootName } from '../config'
import { HttpError, sendJson } from '../utils/http'
import { getMediaKind } from '../utils/media'
import { normalizeRelativePath, resolveSafePath } from '../utils/path'
import { APP_NAME, APP_VERSION } from '../version'

export function handleInfo(req: Request, res: Response, config: AppConfig): void {
  const info: ServerInfo = {
    name: APP_NAME,
    version: APP_VERSION,
    rootName: getRootName(config),
  }
  sendJson(req, res, 200, info)
}

/** 目录在前，然后按名称自然排序 */
function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.type !== b.type)
    return a.type === 'directory' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

export async function handleList(req: Request, res: Response, config: AppConfig, query: URLSearchParams): Promise<void> {
  const relativePath = normalizeRelativePath(query.get('path') ?? '')
  const absolute = await resolveSafePath(config.root, relativePath, config.followSymlinks)

  const info = await stat(absolute)
  if (!info.isDirectory())
    throw new HttpError(400, 'Not a directory')

  const dirents = await readdir(absolute, { withFileTypes: true })
  const entries = await Promise.all(dirents.map(async (dirent): Promise<DirectoryEntry | null> => {
    if (!config.showHidden && dirent.name.startsWith('.'))
      return null

    const entryPath = relativePath ? `${relativePath}/${dirent.name}` : dirent.name
    try {
      // 对符号链接做安全解析，越界或失效的链接直接跳过
      const target = dirent.isSymbolicLink()
        ? await resolveSafePath(config.root, entryPath, config.followSymlinks)
        : join(absolute, dirent.name)
      const s = await stat(target)
      if (!s.isDirectory() && !s.isFile())
        return null

      const isDir = s.isDirectory()
      return {
        name: dirent.name,
        path: entryPath,
        type: isDir ? 'directory' : 'file',
        kind: isDir ? undefined : getMediaKind(dirent.name),
        size: isDir ? 0 : s.size,
        mtime: Math.round(s.mtimeMs),
      }
    }
    catch {
      return null
    }
  }))

  const body: ListResponse = {
    path: relativePath,
    entries: entries.filter((e): e is DirectoryEntry => e !== null).sort(compareEntries),
  }
  sendJson(req, res, 200, body)
}
