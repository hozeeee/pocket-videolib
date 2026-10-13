import type { CachedFile } from './media-cache'
import { markRaw, reactive } from 'vue'
import { getChunkCount, getChunkIndex, getChunkRange, pickNextChunk } from '@/utils/chunk'
import { baseName } from '@/utils/path'
import { getMediaKey } from './api'
import { createFileRecord, deleteFile, getCachedChunkIndexes, getFile, listFiles, putChunk, putFile } from './media-cache'

export type TaskStatus = 'idle' | 'queued' | 'downloading' | 'paused' | 'done' | 'error'

export interface DownloadTask {
  key: string
  path: string
  name: string
  size: number
  chunkCount: number
  cachedChunks: number
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
  cursor: number
  inFlight: Set<number>
  speedSamples: Array<{ time: number, bytes: number }>
}

/** 同时下载的文件数；服务端带宽有限时顺序下载最合适 */
const MAX_ACTIVE_TASKS = 1
/** 单个文件的并发分片请求数 */
const CHUNK_CONCURRENCY = 2
const MAX_RETRIES = 3
const SPEED_WINDOW_MS = 3000

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

class DownloadManager {
  readonly tasks = reactive(new Map<string, DownloadTask>())
  private readonly runtimes = new Map<string, TaskRuntime>()
  private readonly queue: string[] = []
  private persistRequested = false

  /** 获取（必要时从 IndexedDB 恢复）某个文件的任务状态 */
  async load(path: string): Promise<DownloadTask | undefined> {
    const key = getMediaKey(path)
    const existing = this.tasks.get(key)
    if (existing)
      return existing

    const record = await getFile(key)
    if (!record)
      return undefined
    const task = this.ensureTask(key, path, record.size)
    await this.syncFromRecord(task, record)
    return task
  }

  get(path: string): DownloadTask | undefined {
    return this.tasks.get(getMediaKey(path))
  }

  /** 从 IndexedDB 恢复全部已缓存文件的任务状态 */
  async loadAll(): Promise<void> {
    const records = await listFiles()
    await Promise.all(records.map(async (record) => {
      if (this.tasks.has(record.url))
        return
      const task = this.ensureTask(record.url, record.path, record.size)
      await this.syncFromRecord(task, record)
    }))
  }

  /** 开始 / 继续缓存；fromOffset 指定优先缓存的字节位置（通常为播放位置） */
  start(path: string, size: number, fromOffset = 0): DownloadTask {
    const key = getMediaKey(path)
    const task = this.ensureTask(key, path, size)
    this.prioritize(path, fromOffset)

    if (task.status === 'downloading' || task.status === 'queued' || task.status === 'done')
      return task

    task.error = undefined
    task.status = 'queued'
    this.queue.push(key)
    this.requestPersistence()
    this.pump()
    return task
  }

  /** 调整下载游标：拖动进度条后优先下载新位置之后的分片 */
  prioritize(path: string, offset: number): void {
    const runtime = this.runtimes.get(getMediaKey(path))
    if (runtime)
      runtime.cursor = getChunkIndex(Math.max(0, offset))
  }

  pause(path: string): void {
    const key = getMediaKey(path)
    const task = this.tasks.get(key)
    if (!task || (task.status !== 'downloading' && task.status !== 'queued'))
      return
    this.removeFromQueue(key)
    this.runtimes.get(key)?.controller?.abort()
    task.status = 'paused'
    task.speed = 0
    this.pump()
  }

  async remove(path: string): Promise<void> {
    const key = getMediaKey(path)
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

  private ensureTask(key: string, path: string, size: number): DownloadTask {
    let task = this.tasks.get(key)
    if (!task) {
      const chunkCount = getChunkCount(size)
      this.tasks.set(key, {
        key,
        path,
        name: baseName(path),
        size,
        chunkCount,
        cachedChunks: 0,
        status: 'idle',
        speed: 0,
        bitmap: markRaw(new Uint8Array(chunkCount)),
        version: 0,
      })
      task = this.tasks.get(key)!
    }
    if (!this.runtimes.has(key))
      this.runtimes.set(key, { cursor: 0, inFlight: new Set(), speedSamples: [] })
    return task
  }

  private async syncFromRecord(task: DownloadTask, record: CachedFile): Promise<void> {
    const indexes = await getCachedChunkIndexes(record.url)
    task.size = record.size
    task.chunkCount = record.chunkCount
    task.bitmap = markRaw(new Uint8Array(record.chunkCount))
    for (const index of indexes)
      task.bitmap[index] = 1
    task.cachedChunks = indexes.length
    task.version++
    if (record.complete)
      task.status = 'done'
    else if (task.status === 'idle')
      task.status = indexes.length > 0 ? 'paused' : 'idle'
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

  /** 读取服务器上的文件元信息，并与本地记录比对 */
  private async prepareRecord(task: DownloadTask, signal: AbortSignal): Promise<CachedFile> {
    const res = await fetch(task.key, { method: 'HEAD', signal, cache: 'no-store' })
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
    const size = Number(res.headers.get('Content-Length') ?? task.size)
    const etag = res.headers.get('ETag') ?? ''
    const mime = res.headers.get('Content-Type') ?? 'application/octet-stream'

    let record = await getFile(task.key)
    if (record && (record.size !== size || record.etag !== etag)) {
      await deleteFile(task.key)
      record = undefined
    }
    if (!record) {
      record = createFileRecord({ url: task.key, path: task.path, name: task.name, size, mime, etag })
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

  private async worker(task: DownloadTask, runtime: TaskRuntime, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const index = pickNextChunk(task.chunkCount, runtime.cursor, i => task.bitmap[i] === 1 || runtime.inFlight.has(i))
      if (index < 0)
        return

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

  private async downloadChunk(task: DownloadTask, runtime: TaskRuntime, index: number, signal: AbortSignal): Promise<void> {
    const record = runtime.record!
    const { start, end } = getChunkRange(index, record.size, record.chunkSize)
    const res = await fetch(task.key, {
      signal,
      cache: 'no-store',
      headers: { 'Range': `bytes=${start}-${end}`, 'If-Range': record.etag },
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

    const updated = await putChunk(task.key, index, data)
    if (!updated || signal.aborted)
      return

    task.bitmap[index] = 1
    task.cachedChunks = updated.cachedChunks
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
