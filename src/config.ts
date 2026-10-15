import type { Credentials } from './utils/auth'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import process from 'node:process'
import { parseCredentials } from './utils/auth'
import { MIN_RATE, parseRate } from './utils/throttle'

export interface AppConfig {
  /** 媒体根目录的绝对真实路径 */
  root: string
  port: number
  /** 未指定时由 Node 监听所有地址：支持 IPv6 时为 `::`（IPv4/IPv6 双栈），否则为 `0.0.0.0` */
  host?: string
  auth?: Credentials
  https?: {
    cert: Buffer
    key: Buffer
  }
  /** 媒体文件传输的总上行限速（字节/秒），所有连接共享；未设置时不限速 */
  limitRate?: number
  /** 启动时通过 Cloudflare 实测外网下载与上传速度 */
  speedTest: boolean
  /** HLS 转码配置；未设置时不提供清晰度切换 */
  transcode?: TranscodeConfig
  showHidden: boolean
  followSymlinks: boolean
  verbose: boolean
}

export interface TranscodeConfig {
  /** ffmpeg / ffprobe 可执行文件，可以是 PATH 中的命令名 */
  ffmpeg: string
  ffprobe: string
  /** 转码分片的磁盘缓存目录 */
  cacheDir: string
  /** 磁盘缓存上限（字节），超出后优先清理最久未使用的分片 */
  cacheSize: number
}

export interface RawOptions {
  dir?: string
  port?: string
  host?: string
  auth?: string
  cert?: string
  key?: string
  limitRate?: string
  /** `false` 表示关闭启动测速 */
  speedTest?: boolean
  /** `false` 表示关闭转码 */
  transcode?: boolean
  ffmpeg?: string
  ffprobe?: string
  transcodeCache?: string
  transcodeCacheSize?: string
  showHidden?: boolean
  followSymlinks?: boolean
  verbose?: boolean
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export const DEFAULT_PORT = 8080
export const DEFAULT_TRANSCODE_CACHE_SIZE = 10 * 1024 ** 3

function parsePort(value: string | undefined): number {
  if (value === undefined)
    return DEFAULT_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new ConfigError(`Invalid port: ${value}`)
  return port
}

/** 兼容 URL 风格的 `[::1]` 写法 */
function parseHost(value: string | undefined): string | undefined {
  return value?.replace(/^\[(.*)\]$/, '$1') || undefined
}

/** `0` 表示不限速 */
function parseLimitRate(value: string | undefined): number | undefined {
  if (value === undefined)
    return undefined
  const rate = parseRate(value)
  if (rate === undefined)
    throw new ConfigError(`Invalid rate: ${value} (examples: 2M, 500K, 20Mbps)`)
  if (rate === 0)
    return undefined
  if (rate < MIN_RATE)
    throw new ConfigError(`Rate is too low: ${value} (minimum: 1K)`)
  return rate
}

const SIZE_UNITS: Record<string, number> = { '': 1, 'k': 1024, 'm': 1024 ** 2, 'g': 1024 ** 3, 't': 1024 ** 4 }

/** 解析 `500M`、`10G`、`1.5TB` 等大小，按 1024 换算 */
export function parseSize(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)(?:i?b)?$/i.exec(value.trim())
  if (!match)
    return undefined
  return Math.floor(Number(match[1]) * SIZE_UNITS[match[2].toLowerCase()])
}

/** 未单独指定 ffprobe 时，使用与 ffmpeg 同目录的 ffprobe */
function defaultFfprobe(ffmpeg: string): string {
  if (!/[\\/]/.test(ffmpeg))
    return 'ffprobe'
  return join(dirname(ffmpeg), `ffprobe${extname(ffmpeg)}`)
}

function resolveTranscode(options: RawOptions): TranscodeConfig | undefined {
  if (options.transcode === false)
    return undefined
  let cacheSize = DEFAULT_TRANSCODE_CACHE_SIZE
  if (options.transcodeCacheSize !== undefined) {
    const size = parseSize(options.transcodeCacheSize)
    if (!size)
      throw new ConfigError(`Invalid cache size: ${options.transcodeCacheSize} (examples: 500M, 10G)`)
    cacheSize = size
  }
  const ffmpeg = options.ffmpeg || 'ffmpeg'
  return {
    ffmpeg,
    ffprobe: options.ffprobe || defaultFfprobe(ffmpeg),
    cacheDir: resolve(options.transcodeCache || join(tmpdir(), 'pocket-videolib', 'hls')),
    cacheSize,
  }
}

function resolveRoot(dir: string | undefined): string {
  const root = resolve(dir ?? process.cwd())
  if (!existsSync(root))
    throw new ConfigError(`Directory does not exist: ${root}`)
  if (!statSync(root).isDirectory())
    throw new ConfigError(`Not a directory: ${root}`)
  return root
}

function readFileOption(name: string, path: string): Buffer {
  try {
    return readFileSync(resolve(path))
  }
  catch {
    throw new ConfigError(`Cannot read ${name} file: ${path}`)
  }
}

/** 校验原始命令行参数，生成运行配置 */
export function resolveConfig(options: RawOptions): AppConfig {
  if (Boolean(options.cert) !== Boolean(options.key))
    throw new ConfigError('--cert and --key must be provided together')

  let auth: Credentials | undefined
  if (options.auth) {
    try {
      auth = parseCredentials(options.auth)
    }
    catch (error) {
      throw new ConfigError((error as Error).message)
    }
  }

  return {
    root: resolveRoot(options.dir),
    port: parsePort(options.port),
    host: parseHost(options.host),
    auth,
    https: options.cert && options.key
      ? { cert: readFileOption('cert', options.cert), key: readFileOption('key', options.key) }
      : undefined,
    limitRate: parseLimitRate(options.limitRate),
    speedTest: options.speedTest ?? true,
    transcode: resolveTranscode(options),
    showHidden: options.showHidden ?? false,
    followSymlinks: options.followSymlinks ?? false,
    verbose: options.verbose ?? false,
  }
}

export function getRootName(config: AppConfig): string {
  return basename(config.root) || config.root
}
