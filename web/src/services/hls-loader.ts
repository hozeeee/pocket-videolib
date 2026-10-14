import type { FragmentLoaderConstructor, HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats, PlaylistLoaderConstructor } from 'hls.js'
import { MEDIA_VERSION_HEADER } from '@shared/api'
import Hls from 'hls.js/light'
import { isHlsPlaylistPath, parseHlsSegmentPath } from '@/utils/hls'
import { broadcastChunk, getFetching, markFetching, waitForChunk } from './cache-sync'
import { getChunk, getFile, putChunk } from './media-cache'

/**
 * hls.js 的加载器：没有 Service Worker 时由它读写 IndexedDB 缓存。
 * - 分片：优先读取本地缓存；下载器正在下载时等待其写入；从网络加载后，如果该清晰度已开启缓存，顺便写入（与下载器共用数据）
 * - 播放列表：网络优先，失败（离线）时使用缓存记录中保存的播放列表
 */

const BaseLoader = Hls.DefaultConfig.loader
/** 等待下载器写入分片的最长时间，超时后自行请求 */
const WAIT_DOWNLOAD_MS = 30_000

/** 支持 MSE（含 iOS 17.1+ 的 ManagedMediaSource）时使用 hls.js，否则使用浏览器原生 HLS */
export const hlsJsSupported = Hls.isSupported()

function getPathname(url: string): string {
  return new URL(url, location.href).pathname
}

function getVersionHeader(details: unknown): string | null {
  return details instanceof XMLHttpRequest ? details.getResponseHeader(MEDIA_VERSION_HEADER) : null
}

async function storeSegment(key: string, index: number, data: Blob, version: string | null): Promise<void> {
  const file = version ? await putChunk(key, index, data, version).catch(() => undefined) : undefined
  if (file)
    broadcastChunk(key, index, file)
  else
    markFetching(key, index, 'play', false)
}

async function readSegment(key: string, index: number): Promise<ArrayBuffer | undefined> {
  const cached = await getChunk(key, index).catch(() => undefined)
  return cached && await cached.arrayBuffer().catch(() => undefined)
}

class CachingLoader implements Loader<LoaderContext> {
  context: LoaderContext | null = null
  stats: LoaderStats
  private readonly inner: Loader<LoaderContext>
  private callbacks: LoaderCallbacks<LoaderContext> | null = null
  private settled = false
  private readonly abortController = new AbortController()

  constructor(config: HlsConfig) {
    this.inner = new BaseLoader(config)
    this.stats = this.inner.stats
  }

  load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
    this.context = context
    this.callbacks = callbacks
    const pathname = getPathname(context.url)
    const segment = parseHlsSegmentPath(pathname)
    if (segment)
      void this.loadSegment(segment.key, segment.index, config)
    else if (isHlsPlaylistPath(pathname))
      this.loadPlaylist(pathname, config)
    else
      this.inner.load(context, config, callbacks)
  }

  abort(): void {
    if (this.settled)
      return
    this.settled = true
    this.stats.aborted = true
    this.abortController.abort()
    this.inner.abort()
    // 未交给内部加载器时（正在读取本地缓存），自行通知
    if (this.context && this.callbacks?.onAbort && !this.stats.loading.start)
      this.callbacks.onAbort(this.stats, this.context, null)
  }

  destroy(): void {
    this.settled = true
    this.callbacks = null
    this.abortController.abort()
    this.inner.destroy()
  }

  private async loadSegment(key: string, index: number, config: LoaderConfiguration): Promise<void> {
    let data = await readSegment(key, index)
    // 下载器正在下载该分片时等它写入，避免同一分片下载两次
    if (!data && getFetching(key, index) === 'download' && await waitForChunk(key, index, WAIT_DOWNLOAD_MS, this.abortController.signal))
      data = await readSegment(key, index)
    if (this.settled || !this.context || !this.callbacks)
      return
    if (data) {
      const now = performance.now()
      const { loading } = this.stats
      loading.start = loading.first = loading.end = now
      this.stats.loaded = this.stats.total = data.byteLength
      this.settled = true
      this.callbacks.onSuccess({ url: this.context.url, data }, this.stats, this.context, null)
      return
    }

    const callbacks = this.callbacks
    const release = (): void => markFetching(key, index, 'play', false)
    markFetching(key, index, 'play', true)
    this.inner.load(this.context, config, {
      ...callbacks,
      onSuccess: (response, stats, context, details) => {
        this.settled = true
        // hls.js 会把 ArrayBuffer 转移给解封装 Worker，需先复制一份
        if (response.data instanceof ArrayBuffer)
          void storeSegment(key, index, new Blob([response.data]), getVersionHeader(details))
        else
          release()
        callbacks.onSuccess(response, stats, context, details)
      },
      onError: (...args) => {
        release()
        callbacks.onError(...args)
      },
      onTimeout: (...args) => {
        release()
        callbacks.onTimeout(...args)
      },
      onAbort: (...args) => {
        release()
        callbacks.onAbort?.(...args)
      },
    })
  }

  private loadPlaylist(key: string, config: LoaderConfiguration): void {
    const context = this.context!
    const callbacks = this.callbacks!
    const fallback = async (fail: () => void): Promise<void> => {
      const playlist = (await getFile(key).catch(() => undefined))?.playlist
      if (this.settled)
        return
      this.settled = true
      if (!playlist)
        return fail()
      this.stats.loaded = this.stats.total = playlist.length
      this.stats.loading.first = this.stats.loading.end = performance.now()
      callbacks.onSuccess({ url: context.url, data: playlist }, this.stats, context, null)
    }

    this.inner.load(context, config, {
      ...callbacks,
      onSuccess: (...args) => {
        this.settled = true
        callbacks.onSuccess(...args)
      },
      onError: (...args) => void fallback(() => callbacks.onError(...args)),
      onTimeout: (...args) => void fallback(() => callbacks.onTimeout(...args)),
    })
  }
}

/** 没有 Service Worker 时使用的 hls.js 配置 */
export const cachingLoaderConfig: Partial<HlsConfig> = {
  // 加载器不依赖 context 的具体类型
  fLoader: CachingLoader as unknown as FragmentLoaderConstructor,
  pLoader: CachingLoader as unknown as PlaylistLoaderConstructor,
}
