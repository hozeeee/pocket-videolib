import type { Server } from 'node:http'
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

/** 启动监听，返回实际监听的端口（port 为 0 时由系统分配） */
export function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    })
  })
}
