import type { MediaInfo } from '../../shared/api'
import type { AppConfig } from '../config'
import type { SourceFile, Transcoder } from '../transcode'
import type { Request, Response } from '../utils/http'
import type { RateLimiter } from '../utils/throttle'
import { stat } from 'node:fs/promises'
import { HLS_PLAYLIST_NAME, MEDIA_VERSION_HEADER, parseHlsSegmentName } from '../../shared/api'
import { AbortedError, buildPlaylist, SEGMENT_DURATION } from '../transcode'
import { HttpError, sendJson, sendText } from '../utils/http'
import { createEtag, getMediaKind } from '../utils/media'
import { normalizeRelativePath, resolveSafePath } from '../utils/path'
import { parseRange } from '../utils/range'
import { isNotModified, streamFile } from './media'

async function resolveVideo(config: AppConfig, relativePath: string): Promise<SourceFile> {
  const path = await resolveSafePath(config.root, normalizeRelativePath(relativePath), config.followSymlinks)
  const stats = await stat(path)
  if (!stats.isFile())
    throw new HttpError(404, 'Not found')
  return { path, stats }
}

/** `GET /api/media-info?path=`：源文件版本、编码信息与可用清晰度 */
export async function handleMediaInfo(req: Request, res: Response, config: AppConfig, query: URLSearchParams, transcoder?: Transcoder): Promise<void> {
  const file = await resolveVideo(config, query.get('path') ?? '')
  const body: MediaInfo = { version: createEtag(file.stats), levels: [], segmentDuration: SEGMENT_DURATION }

  if (transcoder && getMediaKind(file.path) === 'video') {
    const source = await transcoder.inspect(file)
    if (source) {
      const { duration, width, height, videoCodec, audioCodec } = source.probe
      Object.assign(body, { duration, width, height, videoCodec, audioCodec })
      body.levels = source.levels.map(({ id, width, height, bandwidth }) => ({ id, width, height, bandwidth }))
    }
  }
  sendJson(req, res, 200, body)
}

/** `/hls/<文件路径>/<清晰度>/index.m3u8` 与 `/hls/<文件路径>/<清晰度>/<n>.ts` */
export async function handleHls(req: Request, res: Response, config: AppConfig, rest: string, limiter?: RateLimiter, transcoder?: Transcoder): Promise<void> {
  const parts = rest.split('/')
  const name = parts.pop()
  const levelId = parts.pop()
  if (!transcoder || !name || !levelId || parts.length === 0)
    throw new HttpError(404, 'Not found')

  const file = await resolveVideo(config, parts.join('/'))
  if (getMediaKind(file.path) !== 'video')
    throw new HttpError(404, 'Not found')
  const source = await transcoder.inspect(file)
  const level = source?.levels.find(item => item.id === levelId)
  if (!source || !level)
    throw new HttpError(404, 'Quality level not available')

  const version = createEtag(file.stats)
  if (name === HLS_PLAYLIST_NAME) {
    sendText(req, res, 200, buildPlaylist(source.segments), 'application/vnd.apple.mpegurl', {
      'Cache-Control': 'no-cache',
      [MEDIA_VERSION_HEADER]: version,
    })
    return
  }

  const index = parseHlsSegmentName(name)
  if (index < 0 || index >= source.segments.length)
    throw new HttpError(404, 'Not found')

  const etag = `"${version.slice(1, -1)}-${level.id}-${index}"`
  if (isNotModified(req, etag, file.stats.mtime)) {
    res.writeHead(304, { ETag: etag, [MEDIA_VERSION_HEADER]: version })
    res.end()
    return
  }

  // 客户端放弃请求（拖动、切换清晰度）时，尚未开始的转码可以取消
  const controller = new AbortController()
  res.once('close', () => controller.abort())
  let segmentPath: string
  try {
    segmentPath = await transcoder.getSegment(file, source, level, index, controller.signal)
  }
  catch (error) {
    if (error instanceof AbortedError) {
      if (!res.headersSent)
        res.destroy()
      return
    }
    throw error
  }

  const { size } = await stat(segmentPath)
  const headers: Record<string, string | number> = {
    'Content-Type': 'video/mp2t',
    'Accept-Ranges': 'bytes',
    'ETag': etag,
    'Cache-Control': 'private, no-cache',
    [MEDIA_VERSION_HEADER]: version,
  }
  const range = parseRange(req.headers.range, size)
  if (range.type === 'unsatisfiable') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  let start = 0
  let end = size - 1
  if (range.type === 'range') {
    ({ start, end } = range.range)
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  headers['Content-Length'] = size === 0 ? 0 : end - start + 1
  res.writeHead(range.type === 'range' ? 206 : 200, headers)
  if (req.method === 'HEAD' || size === 0) {
    res.end()
    return
  }
  await streamFile(res, segmentPath, start, end, limiter)
}
