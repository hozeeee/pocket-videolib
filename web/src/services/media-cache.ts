import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import { CHUNK_SIZE, getChunkCount, getChunkIndex } from '@/utils/chunk'

/**
 * 基于 IndexedDB 的媒体分片缓存。
 * 页面（下载器、HLS 加载器、Blob 播放）与 Service Worker（拦截媒体请求）共用此模块。
 * - 原画：主键为 `/media/...`，按 2 MiB 字节分片
 * - 转码：主键为某个清晰度的播放列表 `/hls/.../720p/index.m3u8`，每个 HLS 分片对应一个缓存分片
 */

export type CacheType = 'file' | 'hls'

export interface CachedFile {
  /** 原画为媒体 URL 的 pathname，转码为播放列表的 pathname，作为主键 */
  url: string
  /** 旧版本创建的记录没有该字段，视为 `file` */
  type?: CacheType
  /** 转码清晰度，如 `720p` */
  level?: string
  /** 转码的播放列表内容，离线时使用 */
  playlist?: string
  /** 相对媒体根目录的路径 */
  path: string
  name: string
  /** 原画为文件大小；转码为预估大小 */
  size: number
  mime: string
  /** 源文件版本（ETag），变化后缓存失效 */
  etag: string
  chunkSize: number
  chunkCount: number
  cachedChunks: number
  /** 已缓存字节数；旧记录没有该字段 */
  cachedBytes?: number
  complete: boolean
  createdAt: number
  updatedAt: number
}

interface ChunkRecord {
  url: string
  index: number
  data: Blob
}

interface MediaCacheDB extends DBSchema {
  files: {
    key: string
    value: CachedFile
  }
  chunks: {
    key: [string, number]
    value: ChunkRecord
  }
}

const DB_NAME = 'pocket-videolib'
const DB_VERSION = 1

/** 下载器发出的请求带上此头，Service Worker 直接透传，避免重复写入缓存 */
export const DOWNLOAD_HEADER = 'X-Pocket-Download'

export function getCacheType(file: CachedFile): CacheType {
  return file.type ?? 'file'
}

let dbPromise: Promise<IDBPDatabase<MediaCacheDB>> | undefined

function getDB(): Promise<IDBPDatabase<MediaCacheDB>> {
  dbPromise ??= openDB<MediaCacheDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('files', { keyPath: 'url' })
      db.createObjectStore('chunks', { keyPath: ['url', 'index'] })
    },
  })
  return dbPromise
}

function chunkKeyRange(url: string): IDBKeyRange {
  return IDBKeyRange.bound([url, 0], [url, Number.MAX_SAFE_INTEGER])
}

type FileRecordInit = Pick<CachedFile, 'url' | 'path' | 'name' | 'size' | 'mime' | 'etag'>
  & Partial<Pick<CachedFile, 'type' | 'level' | 'playlist' | 'chunkCount'>>

export function createFileRecord(init: FileRecordInit): CachedFile {
  const now = Date.now()
  const chunkCount = init.chunkCount ?? getChunkCount(init.size)
  return {
    ...init,
    chunkSize: init.type === 'hls' ? 0 : CHUNK_SIZE,
    chunkCount,
    cachedChunks: 0,
    cachedBytes: 0,
    complete: chunkCount === 0,
    createdAt: now,
    updatedAt: now,
  }
}

export async function getFile(url: string): Promise<CachedFile | undefined> {
  return (await getDB()).get('files', url)
}

export async function listFiles(): Promise<CachedFile[]> {
  const files = await (await getDB()).getAll('files')
  return files.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function putFile(file: CachedFile): Promise<void> {
  await (await getDB()).put('files', file)
}

export async function deleteFile(url: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['files', 'chunks'], 'readwrite')
  await Promise.all([
    tx.objectStore('files').delete(url),
    tx.objectStore('chunks').delete(chunkKeyRange(url)),
    tx.done,
  ])
}

export async function clearAll(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['files', 'chunks'], 'readwrite')
  await Promise.all([
    tx.objectStore('files').clear(),
    tx.objectStore('chunks').clear(),
    tx.done,
  ])
}

/** 返回已缓存的分片序号 */
export async function getCachedChunkIndexes(url: string): Promise<number[]> {
  const keys = await (await getDB()).getAllKeys('chunks', chunkKeyRange(url))
  return keys.map(([, index]) => index)
}

export async function getChunk(url: string, index: number): Promise<Blob | undefined> {
  return (await (await getDB()).get('chunks', [url, index]))?.data
}

/**
 * 写入分片并在同一事务内更新文件的缓存进度，返回更新后的文件记录。
 * 没有文件记录（未开启缓存）或版本不一致时不写入，返回 undefined。
 */
export async function putChunk(url: string, index: number, data: Blob, etag?: string): Promise<CachedFile | undefined> {
  const db = await getDB()
  const tx = db.transaction(['files', 'chunks'], 'readwrite')
  const files = tx.objectStore('files')
  const chunks = tx.objectStore('chunks')

  const file = await files.get(url)
  if (!file || index >= file.chunkCount || (etag !== undefined && file.etag !== etag)) {
    tx.abort()
    await tx.done.catch(() => {})
    return undefined
  }

  const existed = await chunks.getKey([url, index])
  await chunks.put({ url, index, data })
  if (!existed) {
    file.cachedBytes = estimateCachedBytes(file) + data.size
    file.cachedChunks += 1
    file.complete = file.cachedChunks >= file.chunkCount
    // 转码后的大小只能预估，按已缓存分片的平均大小修正
    if (getCacheType(file) === 'hls')
      file.size = Math.round(file.cachedBytes / file.cachedChunks * file.chunkCount)
  }
  file.updatedAt = Date.now()
  await files.put(file)
  await tx.done
  return file
}

/** 旧记录没有 cachedBytes，按分片数估算 */
export function estimateCachedBytes(file: CachedFile): number {
  if (file.cachedBytes !== undefined)
    return file.cachedBytes
  return file.chunkCount > 0 ? Math.min(file.size, file.cachedChunks * file.chunkSize) : 0
}

/** 将所有分片拼接为完整 Blob（仅在缓存完成时可用） */
export async function assembleFile(url: string): Promise<Blob | undefined> {
  const db = await getDB()
  const file = await db.get('files', url)
  if (!file?.complete)
    return undefined
  const records = await db.getAll('chunks', chunkKeyRange(url))
  if (records.length < file.chunkCount)
    return undefined
  return new Blob(records.map(r => r.data), { type: file.mime })
}

/**
 * 读取从 start 开始、连续已缓存的数据，最多 maxBytes 字节，且不超过 end。
 * 如果 start 所在分片未缓存则返回 undefined。
 */
export async function readCachedRange(file: CachedFile, start: number, end: number, maxBytes: number): Promise<Blob | undefined> {
  const db = await getDB()
  const lastByte = Math.min(end, start + maxBytes - 1, file.size - 1)
  const firstIndex = getChunkIndex(start, file.chunkSize)
  const lastIndex = getChunkIndex(lastByte, file.chunkSize)

  const parts: Blob[] = []
  for (let index = firstIndex; index <= lastIndex; index++) {
    const record = await db.get('chunks', [file.url, index])
    if (!record)
      break
    parts.push(record.data)
  }
  if (parts.length === 0)
    return undefined

  const offset = start - firstIndex * file.chunkSize
  const available = parts.reduce((sum, p) => sum + p.size, 0) - offset
  const length = Math.min(available, lastByte - start + 1)
  return new Blob(parts).slice(offset, offset + length, file.mime)
}
