import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppConfig } from './config'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createHandler } from './handler'

export function createServer(config: AppConfig): Server {
  const handler = createHandler(config)
  const server: Server = config.https
    ? createHttpsServer({ cert: config.https.cert, key: config.https.key }, handler)
    : createHttpServer(handler)

  // 大文件传输 / 慢速网络下不要过早断开连接
  server.requestTimeout = 0
  server.keepAliveTimeout = 65_000
  return server
}

/**
 * 启动监听，返回实际监听的地址与端口（port 为 0 时由系统分配）。
 * 不传 host 时 Node 会优先监听 `::`（IPv4/IPv6 双栈），系统不支持 IPv6 时回退到 `0.0.0.0`。
 */
export function listen(server: Server, port: number, host?: string): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve(server.address() as AddressInfo)
    })
  })
}
