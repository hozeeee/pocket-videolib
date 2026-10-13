import { realpath } from 'node:fs/promises'
import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import { HttpError } from './http'

/**
 * 规范化客户端传入的相对路径：
 * - 统一使用 `/` 分隔并去掉首尾 `/`
 * - 拒绝空字节与越级访问 (`..`)
 */
export function normalizeRelativePath(input: string): string {
  if (input.includes('\0'))
    throw new HttpError(400, 'Invalid path')

  const unified = input.replace(/\\/g, '/')
  const segments = unified.split('/').filter(s => s !== '' && s !== '.')
  if (segments.includes('..'))
    throw new HttpError(403, 'Forbidden path')

  return posix.normalize(segments.join('/')).replace(/^\.$/, '')
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * 将相对路径解析为媒体根目录下的绝对路径。
 * 当 followSymlinks 为 false 时，会校验真实路径仍位于根目录内，防止符号链接逃逸。
 */
export async function resolveSafePath(root: string, relativePath: string, followSymlinks: boolean): Promise<string> {
  const normalized = normalizeRelativePath(relativePath)
  const absolute = resolve(root, normalized)
  if (!isInside(root, absolute))
    throw new HttpError(403, 'Forbidden path')

  let real: string
  try {
    real = await realpath(absolute)
  }
  catch {
    throw new HttpError(404, 'Not found')
  }

  if (!followSymlinks && !isInside(root, real))
    throw new HttpError(403, 'Forbidden path')

  return real
}

/** 将绝对路径转换为相对根目录、以 `/` 分隔的路径 */
export function toRelativePath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/')
}
