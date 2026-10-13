import { createHash, timingSafeEqual } from 'node:crypto'

export interface Credentials {
  username: string
  password: string
}

/** 解析 `user:pass` 格式的凭据字符串 */
export function parseCredentials(value: string): Credentials {
  const index = value.indexOf(':')
  if (index <= 0 || index === value.length - 1)
    throw new Error('Auth must be in the format "username:password"')
  return {
    username: value.slice(0, index),
    password: value.slice(index + 1),
  }
}

function safeEqual(a: string, b: string): boolean {
  // 先做哈希使长度一致，避免 timingSafeEqual 因长度不同抛错及长度泄露
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/** 校验 HTTP Basic Auth 请求头 */
export function verifyBasicAuth(header: string | undefined, credentials: Credentials): boolean {
  if (!header?.startsWith('Basic '))
    return false

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const index = decoded.indexOf(':')
  if (index < 0)
    return false

  const userOk = safeEqual(decoded.slice(0, index), credentials.username)
  const passOk = safeEqual(decoded.slice(index + 1), credentials.password)
  return userOk && passOk
}
