import type { Credentials } from './utils/auth'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
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
  showHidden: boolean
  followSymlinks: boolean
  verbose: boolean
}

export interface RawOptions {
  dir?: string
  port?: string
  host?: string
  auth?: string
  cert?: string
  key?: string
  limitRate?: string
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
    showHidden: options.showHidden ?? false,
    followSymlinks: options.followSymlinks ?? false,
    verbose: options.verbose ?? false,
  }
}

export function getRootName(config: AppConfig): string {
  return basename(config.root) || config.root
}
