import type { CachedFile, CacheType } from './media-cache'
import { MEDIA_VERSION_HEADER } from '@shared/api'
import { markRaw, reactive } from 'vue'
import { getChunkCount, getChunkRange, pickNextChunk } from '@/utils/chunk'
import { getHlsSegmentPath, parsePlaylistSegments } from '@/utils/hls'
import { baseName } from '@/utils/path'
import { getHlsKey, getMediaKey } from './api'
import { broadcastChunk, getFetching, markFetching, subscribeCache } from './cache-sync'
import { createFileRecord, deleteFile, DOWNLOAD_HEADER, estimateCachedBytes, getCachedChunkIndexes, getCacheType, getFile, listFiles, putChunk, putFile } from './media-cache'

export type TaskStatus = 'idle' | 'queued' | 'downloading' | 'paused' | 'done' | 'error'

/** 缓存目标：原画文件，或某个转码清晰度 */
export type CacheTarget
  = | { type: 'file', path: string, size: number }
    | { type: 'hls', path: string, level: string, sizeHint?: number }

export interface DownloadTask {
  /** 缓存主键，见 media-cache */
  key: string
  type: CacheType
  /** 转码清晰度，原画时为空 */
  level?: string
  path: string
  name: string
  /** 原画为文件大小；转码为预估大小 */
  size: number
  chunkCount: number
  cachedChunks: number
  cachedBytes: number
  status: TaskStatus
  /** 字节/秒 */
  speed: number
  error?: string
  /** 分片位图（非响应式），变化时 version 自增 */
  bitmap: Uint8Array
  version: number
}

interface TaskRuntime {
  controller?: AbortController
  record?: CachedFile
  /** 优先缓存的位置（0~1），通常为播放位置 */
  position: number
  inFlight: Set<number>
  speedSamples: Array<{ time: number, bytes: number }>
}

/** 同时下载的文件数；服务端带宽有限时顺序下载最合适 */
const MAX_ACTIVE_TASKS = 1
/** 单个文件的并发分片请求数 */
const CHUNK_CONCURRENCY = 2
const MAX_RETRIES = 3
const SPEED_WINDOW_MS = 3000
/** 剩余分片都由播放器在读取时，稍后再检查 */
const EXTERNAL_POLL_MS = 1000

class FileChangedError extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return '浏览器存储空间不足'
  if (error instanceof FileChangedError)
    return '服务器上的文件已变更，请重新缓存'
  return error instanceof Error ? error.message : String(error)
}

export function getTargetKey(target: CacheTarget): string {
  return target.type === 'hls' ? getHlsKey(target.path, target.level) : getMediaKey(target.path)
}

class DownloadManager {
  readonly tasks = reactive(new Map<string, DownloadTask>())
  private readonly runtimes = new Map<string, TaskRuntime>()
  private readonly queue: string[] = []
  private persistRequested = false
  /** 播放缓冲不足时暂停发起新的分片请求，把带宽让给播放器 */
  private yielding = false
  private yieldWaiters: Array<() => void> = []

  constructor() {
    subscribeCache((message) => {
      if (message.type === 'chunk')
        this.applyChunk(message.url, message.index, message.file)
    })
  }

  /** 获取（必要时从 IndexedDB 恢复）某个缓存的任务状态 */
  async load(key: string): Promise<DownloadTask | undefined> {
    const existing = this.tasks.get(key)
    if (existing)
      return existing

    const record = await getFile(key)
    if (!record)
      return undefined
    return this.restore(record)
  }

  get(key: string): DownloadTask | undefined {
    return this.tasks.get(key)
  }

  /** 某个文件的全部缓存（原画与各清晰度） */
  getByPath(path: string): DownloadTask[] {
    return [...this.tasks.values()].filter(task => task.path === path)
  }

  /** 从 IndexedDB 恢复全部已缓存文件的任务状态 */
  async loadAll(): Promise<void> {
    const records = await listFiles()
    await Promise.all(records.map(async (record) => {
      if (!this.tasks.has(record.url))
        await this.restore(record)
    }))
  }

  /** 开始 / 继续缓存；position 指定优先缓存的位置（0~1，通常为播放位置） */
  start(target: CacheTarget, position = 0): DownloadTask {
    const key = getTargetKey(target)
    const task = this.ensureTask(key, {
      type: target.type,
      level: target.type === 'hls' ? target.level : undefined,
      path: target.path,
      size: target.type === 'hls' ? target.sizeHint ?? 0 : target.size,
    })
    this.enqueue(task, position)
    return task
  }

  /** 继续已有的缓存任务（缓存管理页使用） */
  resume(key: string): void {
    const task = this.tasks.get(key)
    if (task)
      this.enqueue(task, this.runtimes.get(key)?.position ?? 0)
  }

  /** 调整下载位置：拖动进度条后优先下载新位置之后的分片 */
  prioritize(key: string, position: number): void {
    const runtime = this.runtimes.get(key)
    if (runtime)
      runtime.position = Math.min(1, Math.max(0, position))
  }

  pause(key: string): void {
    const task = this.tasks.get(key)
    if (!task || (task.status !== 'downloading' && task.status !== 'queued'))
      return
    this.removeFromQueue(key)
    this.runtimes.get(key)?.controller?.abort()
    task.status = 'paused'
    task.speed = 0
    this.pump()
  }

  async remove(key: string): Promise<void> {
    this.removeFromQueue(key)
    this.runtimes.get(key)?.controller?.abort()
    this.runtimes.delete(key)
    this.tasks.delete(key)
    await deleteFile(key)
    this.pump()
  }

  /** 清空全部缓存后调用，重置内存状态 */
  reset(): void {
    for (const runtime of this.runtimes.values())
      runtime.controller?.abort()
    this.queue.length = 0
    this.runtimes.clear()
    this.tasks.clear()
  }

  /** 播放器缓冲不足时让路：已发出的请求继续完成，但暂不发起新的请求 */
  setYield(value: boolean): void {
    if (this.yielding === value)
      return
    this.yielding = value
    if (!value) {
      const waiters = this.yieldWaiters
      this.yieldWaiters = []
      waiters.forEach(resolve => resolve())
    }
  }

  private enqueue(task: DownloadTask, position: number): void {
    this.prioritize(task.key, position)
    if (task.status === 'downloading' || task.status === 'queued' || task.status === 'done')
      return
    task.error = undefined
    task.status = 'queued'
    this.queue.push(task.key)
    this.requestPersistence()
    this.pump()
  }

  private async restore(record: CachedFile): Promise<DownloadTask> {
    const task = this.ensureTask(record.url, { type: getCacheType(record), level: record.level, path: record.path, size: record.size })
    await this.syncFromRecord(task, record)
    return task
  }

  private ensureTask(key: string, init: Pick<DownloadTask, 'type' | 'level' | 'path' | 'size'>): DownloadTask {
    let task = this.tasks.get(key)
    if (!task) {
      // 转码的分片数需读取播放列表后才知道
      const chunkCount = init.type === 'file' ? getChunkCount(init.size) : 0
      this.tasks.set(key, {
        key,
        ...init,
        name: baseName(init.path),
        chunkCount,
        cachedChunks: 0,
        cachedBytes: 0,
        status: 'idle',
        speed: 0,
        bitmap: markRaw(new Uint8Array(chunkCount)),
        version: 0,
      })
      task = this.tasks.get(key)!
    }
    if (!this.runtimes.has(key))
      this.runtimes.set(key, { position: 0, inFlight: new Set(), speedSamples: [] })
    return task
  }

  private async syncFromRecord(task: DownloadTask, record: CachedFile): Promise<void> {
    const indexes = await getCachedChunkIndexes(record.url)
    task.size = record.size
    task.chunkCount = record.chunkCount
    task.bitmap = markRaw(new Uint8Array(record.chunkCount))
    for (const index of indexes) {
      if (index < record.chunkCount)
        task.bitmap[index] = 1
    }
    task.cachedChunks = record.cachedChunks
    task.cachedBytes = estimateCachedBytes(record)
    task.version++
    if (record.complete)
      task.status = 'done'
    else if (task.status === 'idle' || task.status === 'done')
      task.status = indexes.length > 0 ? 'paused' : 'idle'
  }

  /** 其他上下文（Service Worker、HLS 加载器）写入了分片 */
  private applyChunk(key: string, index: number, record: CachedFile): void {
    const task = this.tasks.get(key)
    if (!task || record.chunkCount !== task.chunkCount)
      return
    if (index < task.bitmap.length && task.bitmap[index] !== 1) {
      task.bitmap[index] = 1
      task.version++
    }
    task.cachedChunks = record.cachedChunks
    task.cachedBytes = estimateCachedBytes(record)
    task.size = record.size
    if (record.complete && task.status !== 'downloading')
      task.status = 'done'
  }

  private removeFromQueue(key: string): void {
    const index = this.queue.indexOf(key)
    if (index >= 0)
      this.queue.splice(index, 1)
  }

  private activeCount(): number {
    let count = 0
    for (const task of this.tasks.values()) {
      if (task.status === 'downloading')
        count++
    }
    return count
  }

  private pump(): void {
    while (this.activeCount() < MAX_ACTIVE_TASKS && this.queue.length > 0) {
      const key = this.queue.shift()!
      const task = this.tasks.get(key)
      if (task?.status === 'queued')
        void this.run(task)
    }
  }

  private requestPersistence(): void {
    if (this.persistRequested)
      return
    this.persistRequested = true
    // 申请持久化存储，降低浏览器在空间紧张时清理缓存的概率
    navigator.storage?.persist?.().catch(() => {})
  }

  /** 读取服务器上的文件元信息，并与本地记录比对；文件变更后丢弃旧缓存 */
  private async prepareRecord(task: DownloadTask, signal: AbortSignal): Promise<CachedFile> {
    let init: Parameters<typeof createFileRecord>[0]
    if (task.type === 'hls') {
      const res = await fetch(task.key, { signal, cache: 'no-store', headers: { [DOWNLOAD_HEADER]: '1' } })
      if (!res.ok)
        throw new Error(res.status === 404 ? '该清晰度不可用' : `HTTP ${res.status}`)
      const playlist = await res.text()
      init = {
        url: task.key,
        type: 'hls',
        level: task.level,
        path: task.path,
        name: task.name,
        size: task.size,
        mime: 'video/mp2t',
        etag: res.headers.get(MEDIA_VERSION_HEADER) ?? '',
        chunkCount: parsePlaylistSegments(playlist).length,
        playlist,
      }
    }
    else {
      const res = await fetch(task.key, { method: 'HEAD', signal, cache: 'no-store', headers: { [DOWNLOAD_HEADER]: '1' } })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)
      init = {
        url: task.key,
        path: task.path,
        name: task.name,
        size: Number(res.headers.get('Content-Length') ?? task.size),
        mime: res.headers.get('Content-Type') ?? 'application/octet-stream',
        etag: res.headers.get('ETag') ?? '',
      }
    }

    let record = await getFile(task.key)
    const changed = record && (record.etag !== init.etag || (task.type === 'hls' ? record.chunkCount !== init.chunkCount : record.size !== init.size))
    if (record && changed) {
      await deleteFile(task.key)
      record = undefined
    }
    if (!record) {
      record = createFileRecord(init)
      await putFile(record)
    }
    else if (init.playlist && record.playlist !== init.playlist) {
      record.playlist = init.playlist
      await putFile(record)
    }
    await this.syncFromRecord(task, record)
    return record
  }

  private async run(task: DownloadTask): Promise<void> {
    const runtime = this.runtimes.get(task.key)!
    const controller = new AbortController()
    runtime.controller = controller
    runtime.inFlight.clear()
    runtime.speedSamples = []
    task.status = 'downloading'

    try {
      runtime.record = await this.prepareRecord(task, controller.signal)
      if (task.status !== 'downloading')
        return
      if (runtime.record.complete) {
        task.status = 'done'
        return
      }

      const workers = Array.from({ length: CHUNK_CONCURRENCY }, () => this.worker(task, runtime, controller.signal))
      await Promise.all(workers)

      if (task.cachedChunks >= task.chunkCount)
        task.status = 'done'
    }
    catch (error) {
      if (controller.signal.aborted)
        return
      controller.abort()
      task.status = 'error'
      task.error = describeError(error)
    }
    finally {
      task.speed = 0
      if (runtime.controller === controller)
        runtime.controller = undefined
      this.pump()
    }
  }

  private waitForTurn(signal: AbortSignal): Promise<void> {
    if (!this.yielding)
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.yieldWaiters.push(resolve)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }

  private async worker(task: DownloadTask, runtime: TaskRuntime, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.waitForTurn(signal)
      const cursor = Math.min(task.chunkCount - 1, Math.floor(runtime.position * task.chunkCount))
      // 播放器正在读取的分片会由它写入缓存，不必重复下载
      const external = (i: number): boolean => getFetching(task.key, i) === 'play'
      const index = pickNextChunk(task.chunkCount, Math.max(0, cursor), i => task.bitmap[i] === 1 || runtime.inFlight.has(i) || external(i))
      if (index < 0) {
        if (pickNextChunk(task.chunkCount, 0, i => task.bitmap[i] === 1 || runtime.inFlight.has(i)) < 0)
          return
        await sleep(EXTERNAL_POLL_MS, signal)
        continue
      }

      runtime.inFlight.add(index)
      try {
        await this.downloadChunkWithRetry(task, runtime, index, signal)
      }
      finally {
        runtime.inFlight.delete(index)
      }
    }
  }

  private async downloadChunkWithRetry(task: DownloadTask, runtime: TaskRuntime, index: number, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.downloadChunk(task, runtime, index, signal)
        return
      }
      catch (error) {
        if (signal.aborted || error instanceof FileChangedError || attempt >= MAX_RETRIES)
          throw error
        await sleep(1000 * 2 ** attempt, signal)
      }
    }
  }

  private async fetchChunk(record: CachedFile, index: number, signal: AbortSignal): Promise<Blob> {
    if (getCacheType(record) === 'hls') {
      const res = await fetch(getHlsSegmentPath(record.url, index), { signal, cache: 'no-store', headers: { [DOWNLOAD_HEADER]: '1' } })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)
      const version = res.headers.get(MEDIA_VERSION_HEADER)
      if (version !== null && version !== record.etag) {
        void res.body?.cancel()
        throw new FileChangedError()
      }
      return res.blob()
    }

    const { start, end } = getChunkRange(index, record.size, record.chunkSize)
    const res = await fetch(record.url, {
      signal,
      cache: 'no-store',
      headers: { 'Range': `bytes=${start}-${end}`, 'If-Range': record.etag, [DOWNLOAD_HEADER]: '1' },
    })
    // If-Range 不匹配时服务器会返回 200 完整内容，说明文件已变更
    if (res.status === 200) {
      void res.body?.cancel()
      throw new FileChangedError()
    }
    if (res.status !== 206)
      throw new Error(`HTTP ${res.status}`)
    const data = await res.blob()
    if (data.size !== end - start + 1)
      throw new Error('分片长度不匹配')
    return data
  }

  private async downloadChunk(task: DownloadTask, runtime: TaskRuntime, index: number, signal: AbortSignal): Promise<void> {
    const record = runtime.record!
    markFetching(task.key, index, 'download', true)
    let updated: CachedFile | undefined
    let data: Blob
    try {
      data = await this.fetchChunk(record, index, signal)
      updated = await putChunk(task.key, index, data, record.etag)
    }
    finally {
      if (updated)
        broadcastChunk(task.key, index, updated)
      else
        markFetching(task.key, index, 'download', false)
    }
    if (!updated || signal.aborted)
      return

    task.bitmap[index] = 1
    task.cachedChunks = updated.cachedChunks
    task.cachedBytes = estimateCachedBytes(updated)
    task.size = updated.size
    task.version++
    this.recordSpeed(task, runtime, data.size)
  }

  private recordSpeed(task: DownloadTask, runtime: TaskRuntime, bytes: number): void {
    const now = performance.now()
    runtime.speedSamples.push({ time: now, bytes })
    runtime.speedSamples = runtime.speedSamples.filter(s => now - s.time <= SPEED_WINDOW_MS)
    const total = runtime.speedSamples.reduce((sum, s) => sum + s.bytes, 0)
    const elapsed = Math.max(now - runtime.speedSamples[0].time, 1000)
    task.speed = total / (elapsed / 1000)
  }
}

export const downloadManager = new DownloadManager()
