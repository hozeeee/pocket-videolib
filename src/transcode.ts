import type { Stats } from 'node:fs'
import type { QualityLevel } from '../shared/api'
import type { TranscodeConfig } from './config'
import type { FfmpegStatus, ProbeResult } from './utils/ffmpeg'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, rename, rm, rmdir, stat, utimes } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { toHlsSegmentName } from '../shared/api'
import { detectFfmpeg, probeMedia, runCommand } from './utils/ffmpeg'
import { logger } from './utils/logger'

/** HLS 分片时长（秒） */
export const SEGMENT_DURATION = 6
/** 编码参数变化时递增，使旧的磁盘缓存失效 */
const CACHE_VERSION = 1
/** 分片内的关键帧间隔，便于在分片内部快速拖动 */
const KEYFRAME_INTERVAL = 2
/** 请求某个分片后预先转码的后续分片数 */
const PREFETCH_SEGMENTS = 2
const SEGMENT_TIMEOUT = 120_000
const CLEANUP_INTERVAL = 60_000
const PROBE_CACHE_LIMIT = 200
const AUDIO_BITRATE = 128_000

/** 清晰度阶梯；最高 1080p，更高分辨率请选择原画 */
const LADDER = [
  { height: 1080, bitrate: 5_000_000 },
  { height: 720, bitrate: 2_800_000 },
  { height: 480, bitrate: 1_400_000 },
  { height: 360, bitrate: 800_000 },
]

export interface TranscodeLevel extends QualityLevel {
  /** 视频目标码率（bit/s） */
  bitrate: number
}

export interface Segment {
  start: number
  duration: number
}

export interface SourceFile {
  path: string
  stats: Stats
}

export interface TranscodeSource {
  probe: ProbeResult
  /** 不是可转码的视频时为空 */
  levels: TranscodeLevel[]
  segments: Segment[]
}

function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * 根据源视频显示尺寸生成可用清晰度（从高到低）。
 * 以「等效高度」判断档位，使 1920x800 这类宽银幕视频也归为 1080p；不放大，最少提供一档。
 */
export function getQualityLevels(width: number, height: number): TranscodeLevel[] {
  const equivalent = Math.max(Math.min(width, height), Math.max(width, height) * 9 / 16)
  let steps = LADDER.filter(step => step.height <= equivalent * 1.05)
  if (steps.length === 0)
    steps = LADDER.slice(-1)

  const landscape = width >= height
  return steps.map((step) => {
    const long = step.height * 16 / 9
    const scale = Math.min(1, (landscape ? long : step.height) / width, (landscape ? step.height : long) / height)
    return {
      id: `${step.height}p`,
      width: toEven(width * scale),
      height: toEven(height * scale),
      bitrate: step.bitrate,
      bandwidth: Math.round(step.bitrate * 1.1 + AUDIO_BITRATE),
    }
  })
}

/** 按固定时长切分，过短的尾片并入前一片 */
export function getSegments(duration: number, segmentDuration = SEGMENT_DURATION): Segment[] {
  const segments: Segment[] = []
  for (let i = 0; i * segmentDuration < duration - 1e-3; i++) {
    const start = i * segmentDuration
    segments.push({ start, duration: Math.min(segmentDuration, duration - start) })
  }
  const last = segments.at(-1)
  if (last && segments.length > 1 && last.duration < 1) {
    segments.pop()
    segments[segments.length - 1].duration += last.duration
  }
  return segments
}

export function buildPlaylist(segments: Segment[]): string {
  const target = Math.ceil(Math.max(SEGMENT_DURATION, ...segments.map(s => s.duration)))
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${target}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ]
  segments.forEach((segment, index) => lines.push(`#EXTINF:${segment.duration.toFixed(3)},`, toHlsSegmentName(index)))
  lines.push('#EXT-X-ENDLIST', '')
  return lines.join('\n')
}

/**
 * 单个分片的 ffmpeg 参数。
 * 每个分片独立转码：`-ss` 在输入前做精确定位，`-output_ts_offset` 保持时间戳与原视频一致，
 * 分片之间可以任意顺序生成并直接拼接播放。
 */
export function buildSegmentArgs(input: string, output: string, segment: Segment, level: TranscodeLevel, probe: ProbeResult): string[] {
  const kbps = Math.round(level.bitrate / 1000)
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-ss',
    segment.start.toFixed(3),
    '-i',
    input,
    '-t',
    segment.duration.toFixed(3),
    '-map',
    `0:${probe.videoStream ?? 'v:0'}`,
  ]
  if (probe.audioStream !== undefined)
    args.push('-map', `0:${probe.audioStream}`)
  args.push(
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-sn',
    '-dn',
    '-vf',
    `scale=${level.width}:${level.height},setsar=1,format=yuv420p`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-profile:v',
    'high',
    '-crf',
    '23',
    '-maxrate',
    `${kbps}k`,
    '-bufsize',
    `${kbps * 2}k`,
    '-force_key_frames',
    `expr:gte(t,n_forced*${KEYFRAME_INTERVAL})`,
  )
  if (probe.audioStream !== undefined)
    args.push('-c:a', 'aac', '-b:a', `${AUDIO_BITRATE / 1000}k`, '-ac', '2', '-ar', '48000')
  args.push('-output_ts_offset', segment.start.toFixed(3), '-f', 'mpegts', output)
  return args
}

function defaultConcurrency(): number {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  }
  catch {
    return false
  }
}

interface Job {
  key: string
  fileKey: string
  level: string
  index: number
  output: string
  args: (tmp: string) => string[]
  /** 正在等待结果的请求数；为 0 的任务是预取，可被丢弃 */
  waiters: number
  started: boolean
  controller: AbortController
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

export class AbortedError extends Error {
  constructor() {
    super('Aborted')
    this.name = 'AbortError'
  }
}

/**
 * 按需把视频转码为 HLS 分片，并缓存在磁盘上。
 * - 正在等待的请求优先于预取；同一分片的并发请求只转码一次
 * - 拖动进度条后，丢弃不再需要的预取任务
 * - 磁盘缓存超出上限时，按最近使用时间清理
 */
export class Transcoder {
  private status: Promise<FfmpegStatus> | undefined
  private readonly probes = new Map<string, Promise<ProbeResult | undefined>>()
  private readonly jobs = new Map<string, Job>()
  private readonly queue: Job[] = []
  private running = 0
  private lastCleanup = 0
  private closed = false

  constructor(readonly config: TranscodeConfig, private readonly concurrency = defaultConcurrency()) {}

  getStatus(): Promise<FfmpegStatus> {
    this.status ??= detectFfmpeg(this.config.ffmpeg, this.config.ffprobe)
    return this.status
  }

  /** 探测并生成转码信息；ffmpeg 不可用或探测失败时返回 undefined */
  async inspect(file: SourceFile): Promise<TranscodeSource | undefined> {
    if (!(await this.getStatus()).available)
      return undefined
    const probe = await this.probe(file)
    if (!probe)
      return undefined
    const transcodable = probe.videoStream !== undefined && probe.duration && probe.width && probe.height
    return {
      probe,
      levels: transcodable ? getQualityLevels(probe.width!, probe.height!) : [],
      segments: probe.duration ? getSegments(probe.duration) : [],
    }
  }

  private probe(file: SourceFile): Promise<ProbeResult | undefined> {
    const key = `${file.path}:${file.stats.size}:${file.stats.mtimeMs}`
    let result = this.probes.get(key)
    if (!result) {
      result = probeMedia(this.config.ffprobe, file.path).catch((error: Error) => {
        logger.warn(`Cannot probe ${file.path}: ${error.message}`)
        return undefined
      })
      this.probes.set(key, result)
      if (this.probes.size > PROBE_CACHE_LIMIT)
        this.probes.delete(this.probes.keys().next().value!)
    }
    return result
  }

  /** 获取分片，返回磁盘上的文件路径；signal 中止时 reject AbortedError */
  async getSegment(file: SourceFile, source: TranscodeSource, level: TranscodeLevel, index: number, signal?: AbortSignal): Promise<string> {
    const fileKey = createHash('sha1')
      .update(`${CACHE_VERSION}|${file.path}|${file.stats.size}|${file.stats.mtimeMs}`)
      .digest('hex')
      .slice(0, 20)
    this.dropStale(fileKey, level.id, index)

    const request = (i: number, wait: boolean): Promise<string> => this.request({
      fileKey,
      level: level.id,
      index: i,
      output: join(this.config.cacheDir, fileKey, level.id, toHlsSegmentName(i)),
      args: tmp => buildSegmentArgs(file.path, tmp, source.segments[i], level, source.probe),
    }, wait ? signal : undefined, wait)

    const result = request(index, true)
    for (let i = index + 1; i <= index + PREFETCH_SEGMENTS && i < source.segments.length; i++)
      request(i, false).catch(() => {})
    return result
  }

  private async request(spec: Pick<Job, 'fileKey' | 'level' | 'index' | 'output' | 'args'>, signal: AbortSignal | undefined, wait: boolean): Promise<string> {
    const key = spec.output
    let job = this.jobs.get(key)
    if (!job) {
      if (await exists(spec.output)) {
        const now = new Date()
        utimes(spec.output, now, now).catch(() => {})
        return spec.output
      }
      if (this.closed)
        throw new AbortedError()
      job = this.jobs.get(key) ?? this.enqueue(key, spec)
    }
    if (!wait)
      return spec.output
    await this.wait(job, signal)
    return spec.output
  }

  private enqueue(key: string, spec: Pick<Job, 'fileKey' | 'level' | 'index' | 'output' | 'args'>): Job {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    // 预取任务可能没有等待者
    promise.catch(() => {})
    const job: Job = { ...spec, key, waiters: 0, started: false, controller: new AbortController(), promise, resolve, reject }
    this.jobs.set(key, job)
    this.queue.push(job)
    queueMicrotask(() => this.pump())
    return job
  }

  private wait(job: Job, signal: AbortSignal | undefined): Promise<void> {
    job.waiters++
    return new Promise((resolve, reject) => {
      let settled = false
      const cancelIfUnused = (): void => {
        // 客户端已离开，尚未开始的任务不必再转码
        if (job.waiters === 0 && !job.started)
          this.cancel(job)
      }
      function settle(error?: Error): void {
        if (settled)
          return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        job.waiters--
        if (error)
          reject(error)
        else
          resolve()
      }
      function onAbort(): void {
        settle(new AbortedError())
        cancelIfUnused()
      }
      if (signal?.aborted)
        return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      job.promise.then(() => settle(), (error: Error) => settle(error))
    })
  }

  /** 丢弃同一文件中不在当前播放窗口内、且无人等待的任务（如拖动或切换清晰度之后） */
  private dropStale(fileKey: string, level: string, index: number): void {
    for (const job of this.jobs.values()) {
      if (job.fileKey !== fileKey || job.waiters > 0)
        continue
      if (job.level === level && job.index >= index && job.index <= index + PREFETCH_SEGMENTS)
        continue
      this.cancel(job)
    }
  }

  private cancel(job: Job): void {
    if (job.started) {
      job.controller.abort()
      return
    }
    const i = this.queue.indexOf(job)
    if (i >= 0)
      this.queue.splice(i, 1)
    this.jobs.delete(job.key)
    job.reject(new AbortedError())
  }

  private pump(): void {
    while (!this.closed && this.running < this.concurrency && this.queue.length > 0) {
      const i = Math.max(0, this.queue.findIndex(job => job.waiters > 0))
      const [job] = this.queue.splice(i, 1)
      job.started = true
      this.running++
      this.encode(job)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running--
          this.jobs.delete(job.key)
          this.pump()
        })
    }
  }

  private async encode(job: Job): Promise<void> {
    await mkdir(dirname(job.output), { recursive: true })
    const tmp = `${job.output}.${randomBytes(4).toString('hex')}.tmp`
    try {
      const result = await runCommand(this.config.ffmpeg, job.args(tmp), { timeout: SEGMENT_TIMEOUT, signal: job.controller.signal })
      if (result.code !== 0)
        throw new Error(`ffmpeg exited with code ${result.code}: ${result.stderr.trim().slice(-500)}`)
      await rename(tmp, job.output)
    }
    catch (error) {
      await rm(tmp, { force: true }).catch(() => {})
      if (job.controller.signal.aborted)
        throw new AbortedError()
      logger.error(`Transcoding ${job.output} failed`, error)
      throw error
    }
    this.scheduleCleanup()
  }

  private scheduleCleanup(): void {
    const now = Date.now()
    if (now - this.lastCleanup < CLEANUP_INTERVAL)
      return
    this.lastCleanup = now
    this.cleanup().catch((error: Error) => logger.warn(`Transcode cache cleanup failed: ${error.message}`))
  }

  /** 缓存超出上限时，删除最久未使用的分片直至降到上限的 90% */
  async cleanup(): Promise<void> {
    const files: { path: string, size: number, time: number }[] = []
    const dirs: string[] = []
    const list = (dir: string): Promise<string[]> => readdir(dir).catch(() => [])
    for (const fileDir of await list(this.config.cacheDir)) {
      for (const levelDir of await list(join(this.config.cacheDir, fileDir))) {
        const dir = join(this.config.cacheDir, fileDir, levelDir)
        dirs.push(dir)
        for (const name of await list(dir)) {
          if (!name.endsWith('.ts'))
            continue
          const s = await stat(join(dir, name)).catch(() => undefined)
          if (s?.isFile())
            files.push({ path: join(dir, name), size: s.size, time: s.mtimeMs })
        }
      }
    }

    let total = files.reduce((sum, f) => sum + f.size, 0)
    if (total <= this.config.cacheSize)
      return
    files.sort((a, b) => a.time - b.time)
    const target = this.config.cacheSize * 0.9
    for (const file of files) {
      if (total <= target)
        break
      if (this.jobs.has(file.path))
        continue
      try {
        await rm(file.path, { force: true })
        total -= file.size
      }
      catch {}
    }
    // 目录非空时 rmdir 会失败，忽略即可
    for (const dir of dirs) {
      await rmdir(dir).catch(() => {})
      await rmdir(dirname(dir)).catch(() => {})
    }
  }

  /** 结束所有转码进程 */
  close(): void {
    this.closed = true
    for (const job of [...this.jobs.values()])
      this.cancel(job)
  }
}
