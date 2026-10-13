import type { DBSchema, IDBPDatabase } from 'idb'
import { openDB } from 'idb'
import { CHUNK_SIZE, getChunkCount, getChunkIndex } from '@/utils/chunk'

/**
 * 基于 IndexedDB 的媒体分片缓存。
 * 页面（下载器、Blob 播放）与 Service Worker（拦截 Range 请求）共用此模块。
 */

export interface CachedFile {
  /** 媒体 URL 的 pathname，作为主键 */
  url: string
  /** 相对媒体根目录的路径 */
  path: string
  name: string
  size: number
  mime: string
  etag: string
  chunkSize: number
  chunkCount: number
  cachedChunks: number
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

export function createFileRecord(init: Pick<CachedFile, 'url' | 'path' | 'name' | 'size' | 'mime' | 'etag'>): CachedFile {
  const now = Date.now()
  return {
    ...init,
    chunkSize: CHUNK_SIZE,
    chunkCount: getChunkCount(init.size),
    cachedChunks: 0,
    complete: init.size === 0,
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

/** 写入分片并在同一事务内更新文件的缓存进度，返回更新后的文件记录 */
export async function putChunk(url: string, index: number, data: Blob): Promise<CachedFile | undefined> {
  const db = await getDB()
  const tx = db.transaction(['files', 'chunks'], 'readwrite')
  const files = tx.objectStore('files')
  const chunks = tx.objectStore('chunks')

  const file = await files.get(url)
  if (!file) {
    tx.abort()
    await tx.done.catch(() => {})
    return undefined
  }

  const existed = await chunks.getKey([url, index])
  await chunks.put({ url, index, data })
  if (!existed) {
    file.cachedChunks += 1
    file.complete = file.cachedChunks >= file.chunkCount
  }
  file.updatedAt = Date.now()
  await files.put(file)
  await tx.done
  return file
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
