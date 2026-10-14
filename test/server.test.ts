import type { AddressInfo } from 'node:net'
import type { ListResponse } from '../shared/api'
import type { AppConfig } from '../src/config'
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, listen } from '../src/server'

const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))

let root: string

async function startServer(overrides: Partial<AppConfig> = {}) {
  const server = createServer({
    root,
    port: 0,
    host: '127.0.0.1',
    showHidden: false,
    followSymlinks: false,
    verbose: false,
    ...overrides,
  })
  await listen(server, 0, '127.0.0.1')
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}` }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pvl-server-'))
  await mkdir(join(root, '剧集'))
  await writeFile(join(root, '剧集', '第 1 集.mp4'), VIDEO)
  await writeFile(join(root, '剧集', '第 1 集.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n')
  await writeFile(join(root, 'notes.txt'), 'hello')
  await writeFile(join(root, '.hidden.mp4'), 'x')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('http server', () => {
  let ctx: Awaited<ReturnType<typeof startServer>>

  beforeAll(async () => {
    ctx = await startServer()
  })

  afterAll(() => {
    ctx.server.close()
  })

  it('serves server info', async () => {
    const res = await fetch(`${ctx.base}/api/info`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'pocket-videolib' })
  })

  it('lists directories first and hides dot files', async () => {
    const res = await fetch(`${ctx.base}/api/list`)
    const body = await res.json() as ListResponse
    expect(body.entries.map(e => e.name)).toEqual(['剧集', 'notes.txt'])
    expect(body.entries[0].type).toBe('directory')
  })

  it('lists sub directories with media kinds', async () => {
    const res = await fetch(`${ctx.base}/api/list?path=${encodeURIComponent('剧集')}`)
    const body = await res.json() as ListResponse
    expect(body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '第 1 集.mp4', kind: 'video', size: 1000, path: '剧集/第 1 集.mp4' }),
      expect.objectContaining({ name: '第 1 集.srt', kind: 'subtitle' }),
    ]))
  })

  it('rejects path traversal', async () => {
    const res = await fetch(`${ctx.base}/api/list?path=..`)
    expect(res.status).toBe(403)
    // 编码斜杠可避免 fetch 在客户端提前把 .. 规范化掉
    const media = await fetch(`${ctx.base}/media/..%2F..%2Fetc%2Fpasswd`)
    expect(media.status).toBe(403)
  })

  const videoUrl = (): string => `${ctx.base}/media/${encodeURIComponent('剧集')}/${encodeURIComponent('第 1 集.mp4')}`

  it('streams full media files', async () => {
    const res = await fetch(videoUrl())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(VIDEO)
  })

  it('supports range requests', async () => {
    const res = await fetch(videoUrl(), { headers: { Range: 'bytes=100-199' } })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(res.headers.get('content-length')).toBe('100')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(VIDEO.subarray(100, 200))
  })

  it('returns 416 for unsatisfiable ranges', async () => {
    const res = await fetch(videoUrl(), { headers: { Range: 'bytes=5000-' } })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */1000')
  })

  it('honors If-Range and conditional requests', async () => {
    const head = await fetch(videoUrl(), { method: 'HEAD' })
    const etag = head.headers.get('etag')!
    expect(head.headers.get('content-length')).toBe('1000')

    const matched = await fetch(videoUrl(), { headers: { 'Range': 'bytes=0-9', 'If-Range': etag } })
    expect(matched.status).toBe(206)
    await matched.arrayBuffer()

    const mismatched = await fetch(videoUrl(), { headers: { 'Range': 'bytes=0-9', 'If-Range': '"stale"' } })
    expect(mismatched.status).toBe(200)
    await mismatched.arrayBuffer()

    const notModified = await fetch(videoUrl(), { headers: { 'If-None-Match': etag } })
    expect(notModified.status).toBe(304)
  })

  it('converts srt subtitles to vtt', async () => {
    const res = await fetch(`${ctx.base}/media/${encodeURIComponent('剧集')}/${encodeURIComponent('第 1 集.srt')}?format=vtt`)
    expect(res.headers.get('content-type')).toContain('text/vtt')
    expect(await res.text()).toContain('00:00:01.000 --> 00:00:02.000')
  })

  it('returns 404 for missing media and rejects non-GET methods', async () => {
    expect((await fetch(`${ctx.base}/media/missing.mp4`)).status).toBe(404)
    expect((await fetch(`${ctx.base}/api/info`, { method: 'POST' })).status).toBe(405)
  })
})

describe('basic auth', () => {
  it('requires credentials when enabled', async () => {
    const { server, base } = await startServer({ auth: { username: 'admin', password: 'secret' } })
    try {
      const denied = await fetch(`${base}/api/info`)
      expect(denied.status).toBe(401)
      expect(denied.headers.get('www-authenticate')).toContain('Basic')

      const allowed = await fetch(`${base}/api/info`, {
        headers: { Authorization: `Basic ${Buffer.from('admin:secret').toString('base64')}` },
      })
      expect(allowed.status).toBe(200)
    }
    finally {
      server.close()
    }
  })
})

describe('upload rate limit', () => {
  it('throttles media streaming but keeps content intact', async () => {
    const { server, base } = await startServer({ limitRate: 2000 })
    try {
      const startedAt = Date.now()
      const res = await fetch(`${base}/media/${encodeURIComponent('剧集')}/${encodeURIComponent('第 1 集.mp4')}`)
      expect(Buffer.from(await res.arrayBuffer())).toEqual(VIDEO)
      // 1000 字节减去 200 字节突发，按 2000 B/s 约需 400ms
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300)
    }
    finally {
      server.close()
    }
  })
})

const hasIPv6Loopback = Object.values(networkInterfaces())
  .some(list => list?.some(item => item.family === 'IPv6' && item.address === '::1'))

describe.skipIf(!hasIPv6Loopback)('ipv6', () => {
  const config = (host?: string): AppConfig =>
    ({ root, port: 0, host, showHidden: false, followSymlinks: false, verbose: false })

  it('serves over an IPv6 address', async () => {
    const server = createServer(config('::1'))
    try {
      const { address, port } = await listen(server, 0, '::1')
      expect(address).toBe('::1')
      const res = await fetch(`http://[::1]:${port}/api/info`)
      expect(res.status).toBe(200)
    }
    finally {
      server.close()
    }
  })

  it('listens on IPv4 and IPv6 by default', async () => {
    const server = createServer(config())
    try {
      const { address, port } = await listen(server, 0)
      expect(address).toBe('::')
      expect((await fetch(`http://[::1]:${port}/api/info`)).status).toBe(200)
      expect((await fetch(`http://127.0.0.1:${port}/api/info`)).status).toBe(200)
    }
    finally {
      server.close()
    }
  })
})
