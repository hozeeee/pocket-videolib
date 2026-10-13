import type { NetworkInterfaceInfo } from 'node:os'
import { isIPv6 } from 'node:net'
import { networkInterfaces } from 'node:os'

type Family = NetworkInterfaceInfo['family']
type Interfaces = ReturnType<typeof networkInterfaces>

/** 链路本地地址（fe80::/10）需要带网卡 zone id，浏览器基本无法直接访问 */
function isLinkLocal(address: string): boolean {
  return /^fe[89ab]/i.test(address)
}

/** 获取本机所有非内部地址，IPv6 会跳过链路本地地址 */
export function getLanAddresses(families: Family[], interfaces: Interfaces = networkInterfaces()): string[] {
  const result: string[] = []
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.internal || !families.includes(item.family))
        continue
      if (item.family === 'IPv6' && isLinkLocal(item.address))
        continue
      result.push(item.address)
    }
  }
  return result
}

/** IPv6 地址在 URL 中需要用方括号包裹 */
export function formatUrlHost(host: string): string {
  return isIPv6(host) ? `[${host}]` : host
}

/** 根据实际监听地址生成可访问的 URL 列表 */
export function getAccessUrls(
  boundAddress: string,
  port: number,
  protocol: 'http' | 'https',
  interfaces?: Interfaces,
): string[] {
  let hosts: string[]
  if (boundAddress === '::')
    hosts = ['localhost', ...getLanAddresses(['IPv4', 'IPv6'], interfaces)]
  else if (boundAddress === '0.0.0.0')
    hosts = ['localhost', ...getLanAddresses(['IPv4'], interfaces)]
  else
    hosts = [boundAddress]
  return hosts.map(h => `${protocol}://${formatUrlHost(h)}:${port}`)
}
