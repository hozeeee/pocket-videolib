import { describe, expect, it } from 'vitest'
import { measureInternetSpeed } from '../src/utils/speed-test'

describe('internet speed test', () => {
  it('measures adaptive download and upload samples', async () => {
    let now = 0
    const requests: Array<{ method: string, bytes: number }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      if ((init?.method ?? 'GET') === 'POST') {
        const bytes = (init?.body as Uint8Array).byteLength
        requests.push({ method: 'POST', bytes })
        now += bytes / 500 * 1000
        return new Response('ok')
      }
      const bytes = Number(url.searchParams.get('bytes'))
      requests.push({ method: 'GET', bytes })
      now += bytes / 1000 * 1000
      return new Response(new Uint8Array(bytes))
    }

    const result = await measureInternetSpeed({
      fetchImpl,
      now: () => now,
      timeoutMs: 10_000,
      targetDurationMs: 1000,
      downloadProbeBytes: 100,
      downloadMinBytes: 200,
      downloadMaxBytes: 500,
      uploadProbeBytes: 50,
      uploadMinBytes: 100,
      uploadMaxBytes: 300,
    })

    expect(requests).toEqual([
      { method: 'GET', bytes: 100 },
      { method: 'GET', bytes: 500 },
      { method: 'POST', bytes: 50 },
      { method: 'POST', bytes: 300 },
    ])
    expect(result).toEqual({ downloadBitsPerSecond: 8000, uploadBitsPerSecond: 4000 })
  })

  it('keeps the successful direction when the other direction fails', async () => {
    let now = 0
    const fetchImpl: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST')
        throw new Error('upload blocked')
      now += 100
      return new Response(new Uint8Array(100))
    }
    const result = await measureInternetSpeed({
      fetchImpl,
      now: () => now,
      downloadProbeBytes: 100,
      downloadMinBytes: 100,
      downloadMaxBytes: 100,
      uploadProbeBytes: 50,
      uploadMinBytes: 50,
      uploadMaxBytes: 50,
    })
    expect(result).toEqual({ downloadBitsPerSecond: 8000, uploadBitsPerSecond: undefined })
  })

  it('returns undefined when both directions fail', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('offline')
    }
    await expect(measureInternetSpeed({ fetchImpl, timeoutMs: 100 })).resolves.toBeUndefined()
  })

  it('rejects unsuccessful responses and empty downloads', async () => {
    const failedFetch: typeof fetch = async () => new Response('failed', { status: 503 })
    await expect(measureInternetSpeed({ fetchImpl: failedFetch })).resolves.toBeUndefined()

    const emptyFetch: typeof fetch = async (_input, init) => {
      if (init?.method === 'POST')
        throw new Error('upload blocked')
      return new Response(null)
    }
    await expect(measureInternetSpeed({ fetchImpl: emptyFetch })).resolves.toBeUndefined()
  })
})
