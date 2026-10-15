import type { LinkSpeed } from './utils/link-speed'
import type { InternetSpeed } from './utils/speed-test'
import process from 'node:process'
import { HELP_TEXT, parseCli } from './cli'
import { ConfigError, resolveConfig } from './config'
import { createServer, listen } from './server'
import { Transcoder } from './transcode'
import { detectLinkSpeeds } from './utils/link-speed'
import { color, logger } from './utils/logger'
import { getAccessUrls, getLanInterfaceNames } from './utils/network'
import { measureInternetSpeed } from './utils/speed-test'
import { formatBitrate, formatRate } from './utils/throttle'
import { APP_NAME, APP_VERSION } from './version'

function printBandwidth(limitRate: number | undefined, speeds: LinkSpeed[], internet: InternetSpeed | undefined, speedTestEnabled: boolean): void {
  const link = speeds.length > 0
    ? speeds.map(item => `${item.name} ${formatBitrate(item.mbps * 1e6)}`).join(', ')
    : color.dim('无法获取')
  console.log(`  ${color.dim('网卡链路:')} ${link} ${color.dim('（本机到路由器的协商速率）')}`)

  if (!speedTestEnabled) {
    console.log(`  ${color.dim('外网实测:')} ${color.dim('已关闭（移除 --no-speed-test 可开启）')}`)
  }
  else if (internet) {
    const download = internet.downloadBitsPerSecond ? formatBitrate(internet.downloadBitsPerSecond) : '测量失败'
    const upload = internet.uploadBitsPerSecond ? formatBitrate(internet.uploadBitsPerSecond) : '测量失败'
    console.log(`  ${color.dim('外网实测:')} 下载 ${color.green(download)} / 上传 ${color.green(upload)} ${color.dim('（Cloudflare，当前实际吞吐率）')}`)
  }
  else {
    console.log(`  ${color.dim('外网实测:')} ${color.yellow('测速失败')} ${color.dim('（请检查外网连接或使用 --no-speed-test 关闭）')}`)
  }

  if (!limitRate) {
    console.log(`  ${color.dim('上行限速:')} 不限速 ${color.dim('（可用 --limit-rate 设置）')}`)
    return
  }
  const measuredUpload = internet?.uploadBitsPerSecond
  const maxLink = Math.max(0, ...speeds.map(item => item.mbps)) * 1e6
  const reference = measuredUpload ?? maxLink
  const exceeds = reference > 0 && limitRate * 8 >= reference
  console.log(`  ${color.dim('上行限速:')} ${formatRate(limitRate)}${exceeds ? color.yellow('（不低于可用上行，可能不会生效）') : ''}`)
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
  // 网卡检测、外网测速与启动监听并行；测速失败不影响服务启动
  const linkSpeeds = detectLinkSpeeds(getLanInterfaceNames())
  const internetSpeed = config.speedTest ? measureInternetSpeed() : Promise.resolve(undefined)
  void transcoder?.getStatus()
  const { address, port } = await listen(server, config.port, config.host)

  const urls = getAccessUrls(address, port, config.https ? 'https' : 'http')
  console.log()
  console.log(`  ${color.bold(color.cyan(APP_NAME))} ${color.dim(`v${APP_VERSION}`)}`)
  console.log()
  console.log(`  ${color.dim('Serving:')} ${config.root}`)
  for (const url of urls)
    console.log(`  ${color.dim('Open:   ')} ${color.green(url)}`)
  const [links, internet] = await Promise.all([linkSpeeds, internetSpeed])
  printBandwidth(config.limitRate, links, internet, config.speedTest)
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
