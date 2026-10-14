import { describe, expect, it } from 'vitest'
import { createRangeStream } from '../web/src/utils/range-stream'

const SIZE = 1000
const CHUNK = 100
const source = Uint8Array.from({ length: SIZE }, (_, i) => i % 251)

/** 模拟上游响应：从 start 开始按 pieceSize 分块返回，可选在每块之间等待 */
function upstream(start: number, end: number, pieceSize: number, delayMs = 0): ReadableStreamDefaultReader<Uint8Array> {
  let position = start
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (delayMs)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      if (position > end) {
        controller.close()
        return
      }
      const next = Math.min(position + pieceSize, end + 1)
      controller.enqueue(source.slice(position, next))
      position = next
    },
  }).getReader()
}

function setup(fetchStart: number, fetchEnd: number, start: number, end: number, pieceSize: number) {
  const chunks = new Map<number, Blob>()
  let finished: number | undefined
  let cancelled = false
  const stream = createRangeStream(upstream(fetchStart, fetchEnd, pieceSize), {
    fetchStart,
    start,
    end,
    size: SIZE,
    chunkSize: CHUNK,
    onChunk: (index, data) => chunks.set(index, data),
    onFinish: (next) => {
      finished = next
    },
    onCancel: () => {
      cancelled = true
    },
  })
  return { stream, chunks, finished: () => finished, cancelled: () => cancelled }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise(resolve => setTimeout(resolve, 5))
}

describe('createRangeStream', () => {
  it('returns data when the first upstream pieces lie before the requested start', async () => {
    // 请求从 250 开始，上游从分片起点 200 开始，且每次只返回 10 字节：前 5 块都不在请求范围内
    const { stream, chunks, finished } = setup(200, 499, 250, 499, 10)
    const body = await readAll(stream)
    expect(body).toEqual(source.slice(250, 500))
    await waitFor(() => finished() !== undefined)
    expect([...chunks.keys()]).toEqual([2, 3, 4])
    expect(new Uint8Array(await chunks.get(2)!.arrayBuffer())).toEqual(source.slice(200, 300))
    expect(finished()).toBe(5)
  })

  it('closes the response at the requested end and keeps filling the last chunk', async () => {
    const { stream, chunks, finished } = setup(0, 299, 0, 149, 40)
    expect(await readAll(stream)).toEqual(source.slice(0, 150))
    await waitFor(() => finished() !== undefined)
    expect([...chunks.keys()]).toEqual([0, 1, 2])
    expect(new Uint8Array(await chunks.get(1)!.arrayBuffer())).toEqual(source.slice(100, 200))
  })

  it('handles the short last chunk of a file', async () => {
    const { stream, chunks } = setup(900, 999, 950, 999, 33)
    expect(await readAll(stream)).toEqual(source.slice(950, 1000))
    expect(chunks.get(9)?.size).toBe(100)
  })

  it('drops partial chunks and reports the next index when cancelled', async () => {
    const { stream, chunks, finished, cancelled } = setup(0, 499, 0, 499, 30)
    const reader = stream.getReader()
    let received = 0
    while (received < 120)
      received += (await reader.read()).value!.length
    await reader.cancel()
    expect(cancelled()).toBe(true)
    expect([...chunks.keys()]).toEqual([0])
    expect(finished()).toBe(1)
  })

  it('streams incrementally instead of waiting for the whole upstream body', async () => {
    const reader = createRangeStream(upstream(0, 999, 100, 20), {
      fetchStart: 0,
      start: 0,
      end: 999,
      size: SIZE,
      chunkSize: CHUNK,
      onChunk: () => {},
      onFinish: () => {},
    }).getReader()
    const t0 = performance.now()
    const first = await reader.read()
    expect(first.value?.length).toBe(100)
    expect(performance.now() - t0).toBeLessThan(150)
    await reader.cancel()
  })
})
