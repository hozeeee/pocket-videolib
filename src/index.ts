import type { LinkSpeed } from './utils/link-speed'
import process from 'node:process'
import { HELP_TEXT, parseCli } from './cli'
import { ConfigError, resolveConfig } from './config'
import { createServer, listen } from './server'
import { Transcoder } from './transcode'
import { detectLinkSpeeds } from './utils/link-speed'
import { color, logger } from './utils/logger'
import { getAccessUrls, getLanInterfaceNames } from './utils/network'
import { formatBitrate, formatRate } from './utils/throttle'
import { APP_NAME, APP_VERSION } from './version'

function printBandwidth(limitRate: number | undefined, speeds: LinkSpeed[]): void {
  const network = speeds.length > 0
    ? speeds.map(item => `${item.name} ${formatBitrate(item.mbps * 1e6)}`).join(', ')
    : color.dim('link speed unavailable')
  console.log(`  ${color.dim('Network:')} ${network}`)

  if (!limitRate) {
    console.log(`  ${color.dim('Limit:  ')} unlimited ${color.dim('(use --limit-rate to cap upload bandwidth)')}`)
    return
  }
  const maxMbps = Math.max(0, ...speeds.map(item => item.mbps))
  const exceeds = maxMbps > 0 && limitRate * 8 >= maxMbps * 1e6
  console.log(`  ${color.dim('Limit:  ')} ${formatRate(limitRate)}${exceeds ? color.yellow(' ≥ link speed, has no effect') : ''}`)
}

async function printTranscode(transcoder: Transcoder | undefined): Promise<void> {
  const label = color.dim('Quality:')
  if (!transcoder) {
    console.log(`  ${label} original only ${color.dim('(transcoding disabled)')}`)
    return
  }
  const status = await transcoder.getStatus()
  if (status.available)
    console.log(`  ${label} original + up to 1080p HLS ${color.dim(`(ffmpeg ${status.version})`)}`)
  else
    console.log(`  ${label} original only ${color.yellow(`(${status.reason}; install ffmpeg or use --ffmpeg to enable quality levels)`)}`)
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  if (cli.type === 'help') {
    console.log(HELP_TEXT)
    return
  }
  if (cli.type === 'version') {
    console.log(APP_VERSION)
    return
  }

  const config = resolveConfig(cli.options)
  logger.verbose = config.verbose

  const transcoder = config.transcode ? new Transcoder(config.transcode) : undefined
  const server = createServer(config, transcoder)
  // 与启动监听并行，尽量不拖慢启动
  const linkSpeeds = detectLinkSpeeds(getLanInterfaceNames())
  void transcoder?.getStatus()
  const { address, port } = await listen(server, config.port, config.host)

  const urls = getAccessUrls(address, port, config.https ? 'https' : 'http')
  console.log()
  console.log(`  ${color.bold(color.cyan(APP_NAME))} ${color.dim(`v${APP_VERSION}`)}`)
  console.log()
  console.log(`  ${color.dim('Serving:')} ${config.root}`)
  for (const url of urls)
    console.log(`  ${color.dim('Open:   ')} ${color.green(url)}`)
  printBandwidth(config.limitRate, await linkSpeeds)
  await printTranscode(transcoder)
  if (config.auth)
    console.log(`  ${color.dim('Auth:   ')} enabled (user: ${config.auth.username})`)
  if (!config.https)
    console.log(`  ${color.dim('Tip:     Service Worker caching on remote devices requires HTTPS (--cert/--key).')}`)
  console.log()

  const shutdown = (): void => {
    logger.info('Shutting down...')
    server.close(() => process.exit(0))
    server.closeAllConnections()
    // 兜底：防止仍有连接未关闭
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError || (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
    console.error(`${color.red('Error:')} ${(error as Error).message}`)
    console.error(`Run "${APP_NAME} --help" for usage.`)
  }
  else if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`${color.red('Error:')} Port is already in use. Try another one with --port.`)
  }
  else if (['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes((error as NodeJS.ErrnoException).code ?? '')) {
    console.error(`${color.red('Error:')} Cannot bind to this address (IPv6 may be disabled). Check --host.`)
  }
  else {
    console.error(error)
  }
  process.exit(1)
})
