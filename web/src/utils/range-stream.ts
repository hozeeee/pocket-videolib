import { CHUNK_SIZE, getChunkIndex, getChunkRange } from './chunk'

export interface RangeStreamOptions {
  /** 上游数据的起始字节，需按分片对齐 */
  fetchStart: number
  /** 返回给播放器的字节范围（包含 end），需落在上游数据之内 */
  start: number
  end: number
  /** 文件总大小 */
  size: number
  chunkSize?: number
  /** 写满一个分片时调用 */
  onChunk: (index: number, data: Blob) => void
  /** 上游读取结束（读完、出错或被取消）时调用一次，nextIndex 为第一个未写满的分片 */
  onFinish: (nextIndex: number) => void
  /** 播放器取消请求时调用，用于中止上游请求 */
  onCancel?: () => void
}

/**
 * 把按分片对齐读取的上游数据切成缓存分片，同时只把 [start, end] 部分返回给播放器。
 * 返回范围结束后继续读完上游数据，以便写满最后一个分片。
 */
export function createRangeStream(reader: ReadableStreamDefaultReader<Uint8Array>, options: RangeStreamOptions): ReadableStream<Uint8Array> {
  const { start, end, size, chunkSize = CHUNK_SIZE } = options
  let position = options.fetchStart
  let index = getChunkIndex(position, chunkSize)
  let parts: Uint8Array[] = []
  let finished = false

  function finish(): void {
    if (finished)
      return
    finished = true
    options.onFinish(index)
  }

  function consume(value: Uint8Array): void {
    let offset = 0
    while (offset < value.length) {
      const chunkEnd = getChunkRange(index, size, chunkSize).end
      const take = Math.min(value.length - offset, chunkEnd - position + 1)
      parts.push(value.slice(offset, offset + take))
      offset += take
      position += take
      if (position > chunkEnd) {
        options.onChunk(index, new Blob(parts as BlobPart[]))
        parts = []
        index++
      }
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      const { done, value } = await reader.read()
      if (done)
        return
      consume(value)
    }
  }

  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      // 开头的数据可能全在请求范围之前；pull 未入队任何数据就返回时不会被再次调用，
      // 因此需循环读取，直到有数据可返回或读完
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>
        try {
          result = await reader.read()
        }
        catch (error) {
          finish()
          throw error
        }
        if (result.done) {
          finish()
          stream.close()
          return
        }

        const value = result.value
        const valueStart = position
        consume(value)
        const from = Math.max(0, start - valueStart)
        const to = Math.min(value.length, end - valueStart + 1)
        if (to > from)
          stream.enqueue(value.subarray(from, to))
        if (position > end) {
          stream.close()
          void drain().catch(() => {}).finally(finish)
          return
        }
        if (to > from)
          return
      }
    },
    cancel() {
      // 播放器拖动或切换时会取消请求，未写满的分片直接丢弃
      options.onCancel?.()
      void reader.cancel().catch(() => {})
      finish()
    },
  })
}
