import { networkInterfaces } from 'node:os'

/** 获取本机所有非内部的 IPv4 地址 */
export function getLanAddresses(): string[] {
  const result: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal)
        result.push(item.address)
    }
  }
  return result
}

/** 根据监听地址生成可访问的 URL 列表 */
export function getAccessUrls(host: string, port: number, protocol: 'http' | 'https'): string[] {
  const hosts = host === '0.0.0.0' || host === '::'
    ? ['localhost', ...getLanAddresses()]
    : [host]
  return hosts.map(h => `${protocol}://${h.includes(':') ? `[${h}]` : h}:${port}`)
}
