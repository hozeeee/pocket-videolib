import type { CachedFile } from './media-cache'

/**
 * 在页面（下载器、hls.js 加载器）与 Service Worker 之间同步缓存状态：
 * - `chunk`：写入了新分片，页面据此更新缓存进度
 * - `fetching`：某个分片正在从网络读取，其他方据此避免重复下载同一分片（服务端带宽有限时尤为重要）
 */

export const CACHE_CHANNEL = 'pocket-videolib-cache'

/** 发起者：后台下载器，或播放器（Service Worker / hls.js 加载器） */
export type FetchRole = 'download' | 'play'

export interface ChunkMessage {
  type: 'chunk'
  url: string
  index: number
  file: CachedFile
}

export interface FetchingMessage {
  type: 'fetching'
  url: string
  index: number
  by: FetchRole
  active: boolean
}

export type CacheMessage = ChunkMessage | FetchingMessage

/** 读取方异常退出（如页面关闭）时不会发出结束消息，超时后视为已结束 */
const FETCHING_TTL_MS = 60_000

const fetching = new Map<string, { by: FetchRole, expires: number }>()
const listeners = new Set<(message: CacheMessage) => void>()
let channel: BroadcastChannel | undefined

function fetchingKey(url: string, index: number): string {
  return `${index}:${url}`
}

/** 本地与远端的消息统一在这里处理 */
function dispatch(message: CacheMessage): void {
  const key = fetchingKey(message.url, message.index)
  if (message.type === 'chunk' || !message.active)
    fetching.delete(key)
  else
    fetching.set(key, { by: message.by, expires: Date.now() + FETCHING_TTL_MS })
  for (const listener of listeners)
    listener(message)
}

/** 连接同步频道；Service Worker 启动时调用，以便尽早收到其他方的下载状态 */
export function connectCacheChannel(): void {
  if (channel || typeof BroadcastChannel === 'undefined')
    return
  channel = new BroadcastChannel(CACHE_CHANNEL)
  channel.addEventListener('message', (event: MessageEvent<CacheMessage>) => {
    if (event.data?.type === 'chunk' || event.data?.type === 'fetching')
      dispatch(event.data)
  })
}

function post(message: CacheMessage): void {
  connectCacheChannel()
  dispatch(message)
  channel?.postMessage(message)
}

export function subscribeCache(listener: (message: CacheMessage) => void): () => void {
  connectCacheChannel()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 通知各方有新的分片写入 */
export function broadcastChunk(url: string, index: number, file: CachedFile): void {
  post({ type: 'chunk', url, index, file })
}

export function markFetching(url: string, index: number, by: FetchRole, active: boolean): void {
  post({ type: 'fetching', url, index, by, active })
}

/** 正在读取该分片的一方，没有时返回 undefined */
export function getFetching(url: string, index: number): FetchRole | undefined {
  const key = fetchingKey(url, index)
  const entry = fetching.get(key)
  if (entry && entry.expires < Date.now()) {
    fetching.delete(key)
    return undefined
  }
  return entry?.by
}

/**
 * 等待其他方读取的分片写入缓存。
 * 写入后返回 true；对方放弃、超时或该分片并未在读取时返回 false，由调用方自行请求。
 */
export function waitForChunk(url: string, index: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  if (!getFetching(url, index) || signal?.aborted)
    return Promise.resolve(false)
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: (() => void) | undefined
    function done(value: boolean): void {
      clearTimeout(timer)
      unsubscribe?.()
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    function onAbort(): void {
      done(false)
    }
    timer = setTimeout(done, timeoutMs, false)
    signal?.addEventListener('abort', onAbort, { once: true })
    unsubscribe = subscribeCache((message) => {
      if (message.url !== url || message.index !== index)
        return
      if (message.type === 'chunk')
        done(true)
      else if (!message.active)
        done(false)
    })
  })
}
