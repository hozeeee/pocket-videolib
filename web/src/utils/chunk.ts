/** 分片相关的纯计算函数，页面与 Service Worker 共用 */

/** 每个缓存分片的大小：2 MiB，兼顾请求次数与拖动进度条时的命中粒度 */
export const CHUNK_SIZE = 2 * 1024 * 1024

export function getChunkCount(size: number, chunkSize = CHUNK_SIZE): number {
  return Math.ceil(size / chunkSize)
}

/** 第 index 个分片的字节范围（包含 end） */
export function getChunkRange(index: number, size: number, chunkSize = CHUNK_SIZE): { start: number, end: number } {
  const start = index * chunkSize
  return { start, end: Math.min(start + chunkSize, size) - 1 }
}

export function getChunkIndex(offset: number, chunkSize = CHUNK_SIZE): number {
  return Math.floor(offset / chunkSize)
}

/**
 * 从 cursor 开始向后查找第一个未缓存且未在下载中的分片，找不到时回绕到开头。
 * 这样可以优先缓存播放位置之后的内容。
 */
export function pickNextChunk(total: number, cursor: number, isTaken: (index: number) => boolean): number {
  for (let i = 0; i < total; i++) {
    const index = (cursor + i) % total
    if (!isTaken(index))
      return index
  }
  return -1
}

/** 解析 `bytes=start-end` / `bytes=start-`，不支持后缀范围与多段范围 */
export function parseRangeHeader(header: string | null, size: number): { start: number, end: number } | null {
  const match = header ? /^bytes=(\d+)-(\d*)$/.exec(header.trim()) : null
  if (!match)
    return null
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (start >= size || end < start)
    return null
  return { start, end }
}
