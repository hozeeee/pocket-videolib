import type { RawOptions } from './config'
import { parseArgs } from 'node:util'
import { DEFAULT_PORT } from './config'
import { APP_NAME } from './version'

export type CliResult
  = | { type: 'help' }
    | { type: 'version' }
    | { type: 'run', options: RawOptions }

export const HELP_TEXT = `
${APP_NAME} - Serve a local media directory to any device on your network.

Usage:
  ${APP_NAME} [dir] [options]

Options:
  -d, --dir <path>        Media directory to serve (default: current directory)
  -p, --port <number>     Port to listen on (default: ${DEFAULT_PORT})
  -H, --host <address>    Host to bind (default: all IPv4 and IPv6 addresses)
  -a, --auth <user:pass>  Enable HTTP Basic authentication
      --cert <path>       TLS certificate file (enables HTTPS)
      --key <path>        TLS private key file (enables HTTPS)
      --limit-rate <rate> Cap total upload bandwidth, e.g. 2M (MiB/s), 500K, 20Mbps
      --no-speed-test     Skip internet download/upload speed test on startup
      --ffmpeg <path>     ffmpeg executable for HLS quality levels (default: ffmpeg in PATH)
      --ffprobe <path>    ffprobe executable (default: next to ffmpeg)
      --no-transcode      Disable HLS transcoding, always serve original files
      --transcode-cache <dir>
                          Directory for transcoded segments (default: system temp dir)
      --transcode-cache-size <size>
                          Max disk usage of transcoded segments (default: 10G)
      --show-hidden       Show hidden files (dot files)
      --follow-symlinks   Allow symlinks pointing outside the media directory
      --verbose           Print access logs
  -v, --version           Show version
  -h, --help              Show this help

Examples:
  ${APP_NAME} ~/Videos
  ${APP_NAME} -d /data/movies -p 3000 --auth admin:secret
  ${APP_NAME} ~/Videos --limit-rate 20Mbps
  ${APP_NAME} ~/Videos --host ::        # IPv6 + IPv4
  ${APP_NAME} ~/Videos --host 0.0.0.0   # IPv4 only
`.trimStart()

/** 解析命令行参数；未知参数会抛出错误 */
export function parseCli(argv: string[]): CliResult {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      'dir': { type: 'string', short: 'd' },
      'port': { type: 'string', short: 'p' },
      'host': { type: 'string', short: 'H' },
      'auth': { type: 'string', short: 'a' },
      'cert': { type: 'string' },
      'key': { type: 'string' },
      'limit-rate': { type: 'string' },
      'no-speed-test': { type: 'boolean' },
      'ffmpeg': { type: 'string' },
      'ffprobe': { type: 'string' },
      'no-transcode': { type: 'boolean' },
      'transcode-cache': { type: 'string' },
      'transcode-cache-size': { type: 'string' },
      'show-hidden': { type: 'boolean' },
      'follow-symlinks': { type: 'boolean' },
      'verbose': { type: 'boolean' },
      'version': { type: 'boolean', short: 'v' },
      'help': { type: 'boolean', short: 'h' },
    },
  })

  if (values.help)
    return { type: 'help' }
  if (values.version)
    return { type: 'version' }

  return {
    type: 'run',
    options: {
      dir: values.dir ?? positionals[0],
      port: values.port ?? process.env.PORT,
      host: values.host,
      auth: values.auth ?? process.env.POCKET_VIDEOLIB_AUTH,
      cert: values.cert,
      key: values.key,
      limitRate: values['limit-rate'] ?? process.env.POCKET_VIDEOLIB_LIMIT_RATE,
      speedTest: values['no-speed-test'] ? false : undefined,
      transcode: values['no-transcode'] ? false : undefined,
      ffmpeg: values.ffmpeg ?? process.env.POCKET_VIDEOLIB_FFMPEG,
      ffprobe: values.ffprobe ?? process.env.POCKET_VIDEOLIB_FFPROBE,
      transcodeCache: values['transcode-cache'],
      transcodeCacheSize: values['transcode-cache-size'],
      showHidden: values['show-hidden'],
      followSymlinks: values['follow-symlinks'],
      verbose: values.verbose,
    },
  }
}
