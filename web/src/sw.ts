/// <reference lib="webworker" />
import type { CachedFile } from '@/services/media-cache'
import { MEDIA_PREFIX, MEDIA_VERSION_HEADER } from '@shared/api'
import { broadcastChunk, connectCacheChannel, getFetching, markFetching, waitForChunk } from '@/services/cache-sync'
import { DOWNLOAD_HEADER, getCachedChunkIndexes, getCacheType, getChunk, getFile, putChunk, readCachedRange } from '@/services/media-cache'
import { getChunkIndex, getChunkRange, parseRangeHeader } from '@/utils/chunk'
import { isHlsPlaylistPath, parseHlsSegmentPath } from '@/utils/hls'
import { createRangeStream } from '@/utils/range-stream'

/**
 * Service Worker：拦截媒体请求，命中本地分片缓存时直接返回，未命中时从网络读取。
 * 已开启缓存的文件 / 清晰度，从网络读到的数据会顺便写入缓存（读穿），播放过的部分不必再下载一次。
 * 这样 <video> 可以边缓存边播放，并在离线时继续观看已缓存的部分。
 */

declare const self: ServiceWorkerGlobalScope

const SHELL_CACHE = 'pocket-videolib-shell-v1'
/** 单次响应最多返回的连续缓存字节数，浏览器会按需继续请求后续范围 */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
/** 读穿时单次向服务器请求的最大分片数 */
const MAX_FETCH_CHUNKS = 8
/** 下载器正在下载所需分片时，等待其写入的最长时间 */
const WAIT_DOWNLOAD_MS = 30_000

// 尽早接收下载器广播的下载状态
connectCacheChannel()

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * Chromium 不允许同一媒体资源混用 SW 构造的响应（new Response）与原生网络响应，否则播放失败（报格式不支持）。
 * 因此原画的网络响应也重新包装成构造的响应，与缓存命中、读穿的响应保持一致。
 */
async function fetchConstructed(request: Request): Promise<Response> {
  const res = await fetch(request)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
}

function storeChunk(file: CachedFile, index: number, data: Blob): Promise<void> {
  return putChunk(file.url, index, data, file.etag)
    .catch(() => undefined)
    .then((updated) => {
      if (updated)
        broadcastChunk(file.url, index, updated)
      else
        markFetching(file.url, index, 'play', false)
    })
}

/**
 * 未命中缓存时，按分片对齐向服务器请求，边把数据返回给播放器边按分片写入缓存。
 * 只处理到文件末尾或较远位置的范围请求（播放器的常规请求），其余情况返回 undefined 由调用方直接透传。
 */
async function fetchThrough(event: FetchEvent, file: CachedFile, range: { start: number, end: number }): Promise<Response | undefined> {
  const { chunkSize } = file
  const firstIndex = getChunkIndex(range.start, chunkSize)
  // 小范围请求（如 Safari 的 bytes=0-1 探测）不缓存
  if (range.end < getChunkRange(firstIndex, file.size, chunkSize).end)
    return undefined

  // 从起始分片向后连续请求未缓存的分片，遇到已缓存或下载器正在下载的分片时停止
  const cached = new Set(await getCachedChunkIndexes(file.url))
  const indexLimit = Math.min(firstIndex + MAX_FETCH_CHUNKS, file.chunkCount, getChunkIndex(range.end, chunkSize) + 1)
  let endIndex = firstIndex
  while (endIndex + 1 < indexLimit && !cached.has(endIndex + 1) && !getFetching(file.url, endIndex + 1))
    endIndex++
  const fetchStart = firstIndex * chunkSize
  const fetchEnd = getChunkRange(endIndex, file.size, chunkSize).end

  const controller = new AbortController()
  const res = await fetch(file.url, {
    signal: controller.signal,
    cache: 'no-store',
    headers: { 'Range': `bytes=${fetchStart}-${fetchEnd}`, 'If-Range': file.etag },
  })
  // 文件已变更（If-Range 不匹配）或服务器不支持范围请求
  if (res.status !== 206 || !res.body) {
    void res.body?.cancel()
    return undefined
  }

  const respondEnd = Math.min(range.end, fetchEnd)
  const pending: Promise<void>[] = []
  let finish!: () => void
  event.waitUntil(new Promise<void>((resolve) => {
    finish = resolve
  }).then(() => Promise.all(pending)))

  for (let i = firstIndex; i <= endIndex; i++)
    markFetching(file.url, i, 'play', true)

  const body = createRangeStream(res.body.getReader(), {
    fetchStart,
    start: range.start,
    end: respondEnd,
    size: file.size,
    chunkSize,
    onChunk: (index, data) => pending.push(storeChunk(file, index, data)),
    // 未写满的分片丢弃，并通知下载器可以接手
    onFinish: (nextIndex) => {
      for (let i = nextIndex; i <= endIndex; i++)
        markFetching(file.url, i, 'play', false)
      finish()
    },
    onCancel: () => controller.abort(),
  })

  return new Response(body, {
    status: 206,
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(respondEnd - range.start + 1),
      'Content-Range': `bytes ${range.start}-${respondEnd}/${file.size}`,
      'Accept-Ranges': 'bytes',
      'ETag': file.etag,
    },
  })
}

function respondCachedRange(file: CachedFile, blob: Blob, start: number, partial: boolean): Response {
  const headers = new Headers({
    'Content-Type': file.mime,
    'Content-Length': String(blob.size),
    'Accept-Ranges': 'bytes',
    'ETag': file.etag,
    'X-Pocket-Cache': 'hit',
  })
  if (!partial)
    return new Response(blob, { status: 200, headers })
  headers.set('Content-Range', `bytes ${start}-${start + blob.size - 1}/${file.size}`)
  return new Response(blob, { status: 206, headers })
}

async function respondMedia(event: FetchEvent, pathname: string): Promise<Response> {
  const { request } = event
  const file = await getFile(pathname).catch(() => undefined)
  if (!file || getCacheType(file) !== 'file')
    return fetchConstructed(request)

  const rangeHeader = request.headers.get('Range')
  // 没有 Range 时，仅在完整缓存后返回 200
  const range = rangeHeader
    ? parseRangeHeader(rangeHeader, file.size)
    : file.complete ? { start: 0, end: file.size - 1 } : null
  if (!range)
    return fetchConstructed(request)

  const limit = rangeHeader ? MAX_RESPONSE_BYTES : file.size
  const read = (): Promise<Blob | undefined> => readCachedRange(file, range.start, range.end, limit).catch(() => undefined)
  let blob = await read()
  // 下载器正在下载起始分片时等它写入，避免同一份数据下载两次
  const firstIndex = getChunkIndex(range.start, file.chunkSize)
  if (!blob && getFetching(file.url, firstIndex) === 'download' && await waitForChunk(file.url, firstIndex, WAIT_DOWNLOAD_MS))
    blob = await read()
  if (!blob) {
    const response = rangeHeader ? await fetchThrough(event, file, range).catch(() => undefined) : undefined
    return response ?? fetchConstructed(request)
  }
  return respondCachedRange(file, blob, range.start, Boolean(rangeHeader) || blob.size !== file.size)
}

/** 转码播放列表：网络优先，离线时使用缓存记录中保存的副本 */
async function respondPlaylist(request: Request, key: string): Promise<Response> {
  try {
    return await fetch(request)
  }
  catch (error) {
    const file = await getFile(key).catch(() => undefined)
    if (!file?.playlist)
      throw error
    return new Response(file.playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        [MEDIA_VERSION_HEADER]: file.etag,
      },
    })
  }
}

/** 转码分片：命中缓存时直接返回；下载器正在下载时等它写入；否则从网络读取，并在该清晰度已开启缓存时写入 */
async function respondSegment(event: FetchEvent, key: string, index: number): Promise<Response> {
  const { request } = event
  const read = (): Promise<Blob | undefined> => getChunk(key, index).catch(() => undefined)
  const file = await getFile(key).catch(() => undefined)
  let data = file && await read()
  if (file && !data && getFetching(key, index) === 'download' && await waitForChunk(key, index, WAIT_DOWNLOAD_MS))
    data = await read()
  if (file && data) {
    const headers = new Headers({
      'Content-Type': 'video/mp2t',
      'Accept-Ranges': 'bytes',
      [MEDIA_VERSION_HEADER]: file.etag,
      'X-Pocket-Cache': 'hit',
    })
    // 原生 HLS 播放器可能发送范围请求
    const range = request.headers.has('Range') ? parseRangeHeader(request.headers.get('Range'), data.size) : null
    if (range) {
      headers.set('Content-Range', `bytes ${range.start}-${range.end}/${data.size}`)
      headers.set('Content-Length', String(range.end - range.start + 1))
      return new Response(data.slice(range.start, range.end + 1), { status: 206, headers })
    }
    headers.set('Content-Length', String(data.size))
    return new Response(data, { status: 200, headers })
  }

  if (!file)
    return fetch(request)
  markFetching(key, index, 'play', true)
  let res: Response
  try {
    res = await fetch(request)
  }
  catch (error) {
    markFetching(key, index, 'play', false)
    throw error
  }
  if (res.status === 200 && res.headers.get(MEDIA_VERSION_HEADER) === file.etag) {
    event.waitUntil(res.clone().blob()
      .then(blob => storeChunk(file, index, blob))
      .catch(() => markFetching(key, index, 'play', false)))
  }
  else {
    markFetching(key, index, 'play', false)
  }
  return res
}

/** 页面导航使用网络优先，离线时回退到缓存的应用外壳 */
async function respondNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && response.headers.get('Content-Type')?.includes('text/html'))
      await cache.put('/', response.clone())
    return response
  }
  catch (error) {
    const cached = await cache.match('/')
    if (cached)
      return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  // 下载器自己负责写入缓存
  if (request.method !== 'GET' || request.headers.has(DOWNLOAD_HEADER))
    return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin)
    return

  if (url.pathname.startsWith(MEDIA_PREFIX)) {
    // 字幕转换 / 下载等带参数的请求不走缓存
    if (!url.search)
      event.respondWith(respondMedia(event, url.pathname))
    return
  }

  if (isHlsPlaylistPath(url.pathname)) {
    event.respondWith(respondPlaylist(request, url.pathname))
    return
  }
  const segment = parseHlsSegmentPath(url.pathname)
  if (segment) {
    event.respondWith(respondSegment(event, segment.key, segment.index))
    return
  }

  if (request.mode === 'navigate')
    event.respondWith(respondNavigation(request))
})
