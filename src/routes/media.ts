import type { Stats } from 'node:fs'
import type { AppConfig } from '../config'
import type { Request, Response } from '../utils/http'
import type { RateLimiter } from '../utils/throttle'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { HttpError, sendText } from '../utils/http'
import { getMediaType } from '../utils/media'
import { resolveSafePath } from '../utils/path'
import { parseRange } from '../utils/range'
import { srtToVtt } from '../utils/subtitle'
import { ThrottleStream } from '../utils/throttle'

function createEtag(s: Stats): string {
  // 强校验 ETag：If-Range 要求强比较
  return `"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`
}

function isNotModified(req: Request, etag: string, mtime: Date): boolean {
  const ifNoneMatch = req.headers['if-none-match']
  if (ifNoneMatch)
    return ifNoneMatch.split(',').some(tag => tag.trim() === etag)

  const ifModifiedSince = req.headers['if-modified-since']
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince)
    return !Number.isNaN(since) && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000)
  }
  return false
}

/** If-Range 不匹配时应忽略 Range，返回完整内容 */
function isRangeValid(req: Request, etag: string, mtime: Date): boolean {
  const ifRange = req.headers['if-range']
  if (typeof ifRange !== 'string')
    return true
  if (ifRange.startsWith('"'))
    return ifRange === etag
  const date = Date.parse(ifRange)
  return !Number.isNaN(date) && Math.floor(mtime.getTime() / 1000) === Math.floor(date / 1000)
}

function contentDisposition(type: 'inline' | 'attachment', filePath: string): string {
  const name = basename(filePath)
  const fallback = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

async function sendSubtitleAsVtt(req: Request, res: Response, absolute: string): Promise<void> {
  const content = await readFile(absolute, 'utf8')
  const vtt = absolute.toLowerCase().endsWith('.srt') ? srtToVtt(content) : content
  sendText(req, res, 200, vtt, 'text/vtt; charset=utf-8', { 'Cache-Control': 'no-cache' })
}

export async function handleMedia(req: Request, res: Response, config: AppConfig, relativePath: string, query: URLSearchParams, limiter?: RateLimiter): Promise<void> {
  const absolute = await resolveSafePath(config.root, relativePath, config.followSymlinks)
  const info = await stat(absolute)
  if (!info.isFile())
    throw new HttpError(404, 'Not found')

  const type = getMediaType(absolute)
  if (type.kind === 'subtitle' && query.get('format') === 'vtt')
    return sendSubtitleAsVtt(req, res, absolute)

  const etag = createEtag(info)
  const headers: Record<string, string | number> = {
    'Content-Type': type.mime,
    'Accept-Ranges': 'bytes',
    'ETag': etag,
    'Last-Modified': info.mtime.toUTCString(),
    // 允许浏览器缓存，但每次使用前需协商校验
    'Cache-Control': 'private, no-cache',
    'Content-Disposition': contentDisposition(query.has('download') ? 'attachment' : 'inline', absolute),
  }

  if (isNotModified(req, etag, info.mtime)) {
    res.writeHead(304, { 'ETag': etag, 'Last-Modified': headers['Last-Modified'] as string })
    res.end()
    return
  }

  const range = isRangeValid(req, etag, info.mtime)
    ? parseRange(req.headers.range, info.size)
    : { type: 'none' as const }

  if (range.type === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${info.size}` })
    res.end()
    return
  }

  let start = 0
  let end = info.size - 1
  if (range.type === 'range') {
    ({ start, end } = range.range)
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
    res.statusCode = 206
  }
  else {
    res.statusCode = 200
  }
  headers['Content-Length'] = info.size === 0 ? 0 : end - start + 1

  res.writeHead(res.statusCode, headers)
  if (req.method === 'HEAD' || info.size === 0) {
    res.end()
    return
  }

  try {
    const source = createReadStream(absolute, { start, end })
    if (limiter)
      await pipeline(source, new ThrottleStream(limiter), res)
    else
      await pipeline(source, res)
  }
  catch (error) {
    // 客户端中途断开（如拖动进度条）属于正常情况
    if ((error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE')
      throw error
  }
}
