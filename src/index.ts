import process from 'node:process'
import { HELP_TEXT, parseCli } from './cli'
import { ConfigError, resolveConfig } from './config'
import { createServer, listen } from './server'
import { color, logger } from './utils/logger'
import { getAccessUrls } from './utils/network'
import { APP_NAME, APP_VERSION } from './version'

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

  const server = createServer(config)
  const { address, port } = await listen(server, config.port, config.host)

  const urls = getAccessUrls(address, port, config.https ? 'https' : 'http')
  console.log()
  console.log(`  ${color.bold(color.cyan(APP_NAME))} ${color.dim(`v${APP_VERSION}`)}`)
  console.log()
  console.log(`  ${color.dim('Serving:')} ${config.root}`)
  for (const url of urls)
    console.log(`  ${color.dim('Open:   ')} ${color.green(url)}`)
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
