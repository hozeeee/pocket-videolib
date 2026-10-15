import { performance } from 'node:perf_hooks'

export interface InternetSpeed {
  /** 实测下载速率（bit/s） */
  downloadBitsPerSecond?: number
  /** 实测上传速率（bit/s） */
  uploadBitsPerSecond?: number
}

export interface SpeedTestOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  endpoint?: string
  timeoutMs?: number
  targetDurationMs?: number
  downloadProbeBytes?: number
  downloadMinBytes?: number
  downloadMaxBytes?: number
  uploadProbeBytes?: number
  uploadMinBytes?: number
  uploadMaxBytes?: number
}

const DEFAULT_ENDPOINT = 'https://speed.cloudflare.com'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

async function readResponseBytes(response: Response): Promise<number> {
  if (!response.ok)
    throw new Error(`Speed test returned HTTP ${response.status}`)
  if (!response.body)
    return 0

  let bytes = 0
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break
    bytes += value.byteLength
  }
  return bytes
}

async function measureDownload(
  bytes: number,
  endpoint: string,
  fetchImpl: typeof fetch,
  now: () => number,
  signal: AbortSignal,
): Promise<number> {
  const startedAt = now()
  const response = await fetchImpl(`${endpoint}/__down?bytes=${bytes}`, {
    headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' },
    signal,
  })
  const received = await readResponseBytes(response)
  const elapsedMs = now() - startedAt
  if (received <= 0 || elapsedMs <= 0)
    throw new Error('Speed test returned no download data')
  return received / (elapsedMs / 1000)
}

async function measureUpload(
  bytes: number,
  endpoint: string,
  fetchImpl: typeof fetch,
  now: () => number,
  signal: AbortSignal,
): Promise<number> {
  const body = new Uint8Array(bytes)
  const startedAt = now()
  const response = await fetchImpl(`${endpoint}/__up`, {
    method: 'POST',
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/octet-stream' },
    body,
    signal,
  })
  if (!response.ok)
    throw new Error(`Speed test returned HTTP ${response.status}`)
  await response.arrayBuffer()
  const elapsedMs = now() - startedAt
  if (elapsedMs <= 0)
    throw new Error('Speed test upload took no time')
  return bytes / (elapsedMs / 1000)
}

/**
 * 通过 Cloudflare 边缘节点实测当前外网吞吐率。
 * 先用小数据包预热并估算速率，再选择约 2 秒的数据量正式测量；默认最多下载 25 MB、上传 10 MB。
 * 任一方向失败不会影响另一方向，整体超时或完全失败时返回 `undefined`。
 */
export async function measureInternetSpeed(options: SpeedTestOptions = {}): Promise<InternetSpeed | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => performance.now())
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? 25_000
  const targetDurationMs = options.targetDurationMs ?? 2000
  const downloadProbeBytes = options.downloadProbeBytes ?? 512 * 1024
  const downloadMinBytes = options.downloadMinBytes ?? 2 * 1024 ** 2
  const downloadMaxBytes = options.downloadMaxBytes ?? 25 * 1024 ** 2
  const uploadProbeBytes = options.uploadProbeBytes ?? 256 * 1024
  const uploadMinBytes = options.uploadMinBytes ?? 1024 ** 2
  const uploadMaxBytes = options.uploadMaxBytes ?? 10 * 1024 ** 2

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()

  let downloadBitsPerSecond: number | undefined
  let uploadBitsPerSecond: number | undefined
  try {
    try {
      const probeRate = await measureDownload(downloadProbeBytes, endpoint, fetchImpl, now, controller.signal)
      const sampleBytes = clamp(probeRate * targetDurationMs / 1000, downloadMinBytes, downloadMaxBytes)
      downloadBitsPerSecond = await measureDownload(sampleBytes, endpoint, fetchImpl, now, controller.signal) * 8
    }
    catch {
      // 下载失败仍继续尝试上传，以便在受限网络中尽可能返回部分结果
    }

    try {
      const probeRate = await measureUpload(uploadProbeBytes, endpoint, fetchImpl, now, controller.signal)
      const sampleBytes = clamp(probeRate * targetDurationMs / 1000, uploadMinBytes, uploadMaxBytes)
      uploadBitsPerSecond = await measureUpload(sampleBytes, endpoint, fetchImpl, now, controller.signal) * 8
    }
    catch {
      // 上传失败时保留已经测得的下载结果
    }
  }
  finally {
    clearTimeout(timer)
  }

  if (!downloadBitsPerSecond && !uploadBitsPerSecond)
    return undefined
  return { downloadBitsPerSecond, uploadBitsPerSecond }
}
