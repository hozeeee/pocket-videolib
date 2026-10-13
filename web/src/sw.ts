/// <reference lib="webworker" />
import { MEDIA_PREFIX } from '@shared/api'
import { getFile, readCachedRange } from '@/services/media-cache'
import { parseRangeHeader } from '@/utils/chunk'

/**
 * Service Worker：拦截媒体请求，命中本地分片缓存时直接返回 206 响应，
 * 未命中则透传到网络。这样 <video> 可以边缓存边播放，并在离线时继续观看已缓存的部分。
 */

declare const self: ServiceWorkerGlobalScope

const SHELL_CACHE = 'pocket-videolib-shell-v1'
/** 单次响应最多返回的连续缓存字节数，浏览器会按需继续请求后续范围 */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

async function respondFromCache(request: Request, pathname: string): Promise<Response> {
  const file = await getFile(pathname).catch(() => undefined)
  if (!file)
    return fetch(request)

  const rangeHeader = request.headers.get('Range')
  // 没有 Range 时，仅在完整缓存后返回 200
  const range = rangeHeader
    ? parseRangeHeader(rangeHeader, file.size)
    : file.complete ? { start: 0, end: file.size - 1 } : null
  if (!range)
    return fetch(request)

  const limit = rangeHeader ? MAX_RESPONSE_BYTES : file.size
  const blob = await readCachedRange(file, range.start, range.end, limit).catch(() => undefined)
  if (!blob)
    return fetch(request)

  const headers = new Headers({
    'Content-Type': file.mime,
    'Content-Length': String(blob.size),
    'Accept-Ranges': 'bytes',
    'ETag': file.etag,
    'X-Pocket-Cache': 'hit',
  })
  if (!rangeHeader && blob.size === file.size)
    return new Response(blob, { status: 200, headers })

  headers.set('Content-Range', `bytes ${range.start}-${range.start + blob.size - 1}/${file.size}`)
  return new Response(blob, { status: 206, headers })
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
  if (request.method !== 'GET')
    return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin)
    return

  if (url.pathname.startsWith(MEDIA_PREFIX)) {
    // 字幕转换 / 下载等带参数的请求不走缓存
    if (!url.search)
      event.respondWith(respondFromCache(request, url.pathname))
    return
  }

  if (request.mode === 'navigate')
    event.respondWith(respondNavigation(request))
})
