import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HttpError } from '../src/utils/http'
import { normalizeRelativePath, resolveSafePath } from '../src/utils/path'

describe('normalizeRelativePath', () => {
  it('normalizes separators and dots', () => {
    expect(normalizeRelativePath('/a//b/./c/')).toBe('a/b/c')
    expect(normalizeRelativePath('a\\b')).toBe('a/b')
    expect(normalizeRelativePath('')).toBe('')
    expect(normalizeRelativePath('/')).toBe('')
  })

  it('rejects traversal and null bytes', () => {
    expect(() => normalizeRelativePath('../etc/passwd')).toThrow(HttpError)
    expect(() => normalizeRelativePath('a/../../b')).toThrow(HttpError)
    expect(() => normalizeRelativePath('a\0b')).toThrow(HttpError)
  })
})

describe('resolveSafePath', () => {
  let base: string
  let root: string

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'pvl-path-'))
    root = join(base, 'root')
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'sub', 'a.mp4'), 'x')
    await writeFile(join(base, 'secret.txt'), 'secret')
    // Windows 上创建符号链接需要管理员权限
    if (process.platform !== 'win32')
      await symlink(join(base, 'secret.txt'), join(root, 'escape.txt'))
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('resolves files inside root', async () => {
    await expect(resolveSafePath(root, 'sub/a.mp4', false)).resolves.toBe(join(root, 'sub', 'a.mp4'))
  })

  it('returns 404 for missing files', async () => {
    await expect(resolveSafePath(root, 'missing.mp4', false)).rejects.toMatchObject({ status: 404 })
  })

  it.skipIf(process.platform === 'win32')('blocks symlinks escaping root unless allowed', async () => {
    await expect(resolveSafePath(root, 'escape.txt', false)).rejects.toMatchObject({ status: 403 })
    await expect(resolveSafePath(root, 'escape.txt', true)).resolves.toBe(join(base, 'secret.txt'))
  })
})
