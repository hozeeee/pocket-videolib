import type { TransformCallback } from 'node:stream'
import { performance } from 'node:perf_hooks'
import { Transform } from 'node:stream'

/** 允许的最低限速：1 KiB/s */
export const MIN_RATE = 1024

const MAX_SLICE = 16 * 1024

const BYTE_UNITS: Record<string, number> = {
  '': 1,
  'b': 1,
  'k': 1024,
  'kb': 1024,
  'kib': 1024,
  'm': 1024 ** 2,
  'mb': 1024 ** 2,
  'mib': 1024 ** 2,
  'g': 1024 ** 3,
  'gb': 1024 ** 3,
  'gib': 1024 ** 3,
}
const BIT_UNITS: Record<string, number> = { bps: 1, kbps: 1e3, kbit: 1e3, mbps: 1e6, mbit: 1e6, gbps: 1e9, gbit: 1e9 }

/**
 * 解析速率，返回字节/秒；无法识别时返回 `undefined`。
 * - `K` / `M` / `G`（可加 `B`、`iB`）为字节，按 1024 换算，与 curl `--limit-rate` 一致
 * - `Kbps` / `Mbps` / `Gbps`（或 `kbit` / `mbit` / `gbit`）为比特，按 1000 换算，与运营商带宽一致
 */
export function parseRate(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)(?:\/s)?$/i.exec(value.trim())
  if (!match)
    return undefined
  const amount = Number(match[1])
  const unit = match[2].toLowerCase()
  if (unit in BYTE_UNITS)
    return Math.floor(amount * BYTE_UNITS[unit])
  if (unit in BIT_UNITS)
    return Math.floor(amount * BIT_UNITS[unit] / 8)
  return undefined
}

function trimNumber(value: number): string {
  return value >= 100 ? value.toFixed(0) : String(Number(value.toFixed(1)))
}

/** 比特速率，如 `100 Mbps`、`1 Gbps` */
export function formatBitrate(bitsPerSecond: number): string {
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps']
  let value = bitsPerSecond
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i++
  }
  return `${trimNumber(value)} ${units[i]}`
}

/** 字节速率并附带比特速率，如 `10 MiB/s (83.9 Mbps)` */
export function formatRate(bytesPerSecond: number): string {
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s']
  let value = bytesPerSecond
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${trimNumber(value)} ${units[i]} (${formatBitrate(bytesPerSecond * 8)})`
}

/**
 * 全局令牌桶，所有连接共享同一份带宽。
 * 令牌允许透支：预约后按透支量计算等待时间，多个连接按预约先后依次发送，从而平分带宽。
 */
export class RateLimiter {
  /** 单次发送的分片大小，速率越低分片越小，输出越平滑 */
  readonly sliceSize: number
  private readonly burst: number
  private tokens: number
  private updatedAt: number

  constructor(readonly bytesPerSecond: number, private readonly now: () => number = () => performance.now()) {
    this.sliceSize = Math.min(MAX_SLICE, Math.max(1, Math.floor(bytesPerSecond / 20)))
    // 允许约 100ms 的突发，空闲后的首个分片无需等待
    this.burst = Math.max(this.sliceSize, bytesPerSecond / 10)
    this.tokens = this.burst
    this.updatedAt = this.now()
  }

  /** 预约发送 bytes 字节，返回发送前需要等待的毫秒数 */
  reserve(bytes: number): number {
    const now = this.now()
    this.tokens = Math.min(this.burst, this.tokens + (now - this.updatedAt) * this.bytesPerSecond / 1000)
    this.updatedAt = now
    this.tokens -= bytes
    return this.tokens >= 0 ? 0 : -this.tokens / this.bytesPerSecond * 1000
  }
}

/** 按限速器节奏转发数据的流，用于 `pipeline(source, throttle, res)` */
export class ThrottleStream extends Transform {
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly limiter: RateLimiter) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    let offset = 0
    const next = (): void => {
      if (offset >= chunk.length) {
        callback()
        return
      }
      const slice = chunk.subarray(offset, offset + this.limiter.sliceSize)
      offset += slice.length
      const wait = this.limiter.reserve(slice.length)
      const send = (): void => {
        this.timer = undefined
        this.push(slice)
        next()
      }
      if (wait > 0)
        this.timer = setTimeout(send, wait)
      else
        send()
    }
    next()
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    clearTimeout(this.timer)
    callback(error)
  }
}
