import type { networkInterfaces } from 'node:os'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { parseCli } from '../src/cli'
import { resolveConfig } from '../src/config'
import { parseCredentials, verifyBasicAuth } from '../src/utils/auth'
import { formatUrlHost, getAccessUrls, getLanInterfaceNames } from '../src/utils/network'
import { srtToVtt } from '../src/utils/subtitle'

describe('parseCli', () => {
  it('parses options and positional directory', () => {
    const result = parseCli(['./videos', '-p', '3000', '--auth', 'u:p', '--verbose'])
    expect(result).toMatchObject({
      type: 'run',
      options: { dir: './videos', port: '3000', auth: 'u:p', verbose: true },
    })
  })

  it('prefers --dir over positional', () => {
    expect(parseCli(['a', '--dir', 'b'])).toMatchObject({ options: { dir: 'b' } })
  })

  it('handles help and version', () => {
    expect(parseCli(['-h'])).toEqual({ type: 'help' })
    expect(parseCli(['--version'])).toEqual({ type: 'version' })
  })

  it('throws on unknown options', () => {
    expect(() => parseCli(['--unknown'])).toThrow()
  })
})

describe('auth', () => {
  it('parses credentials containing colons in password', () => {
    expect(parseCredentials('admin:pa:ss')).toEqual({ username: 'admin', password: 'pa:ss' })
    expect(() => parseCredentials('admin')).toThrow()
    expect(() => parseCredentials(':pass')).toThrow()
  })

  it('verifies basic auth header', () => {
    const credentials = { username: 'admin', password: 'secret' }
    const header = (v: string): string => `Basic ${Buffer.from(v).toString('base64')}`
    expect(verifyBasicAuth(header('admin:secret'), credentials)).toBe(true)
    expect(verifyBasicAuth(header('admin:wrong'), credentials)).toBe(false)
    expect(verifyBasicAuth(undefined, credentials)).toBe(false)
    expect(verifyBasicAuth('Bearer x', credentials)).toBe(false)
  })
})

describe('srtToVtt', () => {
  it('converts timestamps and adds header', () => {
    const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello\n')
  })
})

describe('host & access urls', () => {
  const iface = (address: string, family: 'IPv4' | 'IPv6', internal = false) =>
    ({ address, family, internal, netmask: '', mac: '', cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) })
  const interfaces = {
    lo: [iface('127.0.0.1', 'IPv4', true), iface('::1', 'IPv6', true)],
    eth0: [
      iface('192.168.1.10', 'IPv4'),
      iface('240e:3b7::1', 'IPv6'),
      iface('fe80::1', 'IPv6'),
    ],
  } as ReturnType<typeof networkInterfaces>

  it('defaults to binding all addresses and accepts bracketed IPv6', () => {
    expect(resolveConfig({}).host).toBeUndefined()
    expect(resolveConfig({ host: '[::1]' }).host).toBe('::1')
    expect(resolveConfig({ host: '::' }).host).toBe('::')
  })

  it('wraps IPv6 hosts in brackets', () => {
    expect(formatUrlHost('::1')).toBe('[::1]')
    expect(formatUrlHost('192.168.1.10')).toBe('192.168.1.10')
    expect(formatUrlHost('localhost')).toBe('localhost')
  })

  it('lists IPv4 and IPv6 urls for dual-stack, skipping link-local', () => {
    expect(getAccessUrls('::', 8080, 'http', interfaces)).toEqual([
      'http://localhost:8080',
      'http://192.168.1.10:8080',
      'http://[240e:3b7::1]:8080',
    ])
  })

  it('lists IPv4 urls only when bound to 0.0.0.0', () => {
    expect(getAccessUrls('0.0.0.0', 8080, 'https', interfaces)).toEqual([
      'https://localhost:8080',
      'https://192.168.1.10:8080',
    ])
  })

  it('uses the bound address directly otherwise', () => {
    expect(getAccessUrls('::1', 3000, 'http', interfaces)).toEqual(['http://[::1]:3000'])
  })

  it('lists interfaces with reachable addresses only', () => {
    const withVeth = { ...interfaces, veth0: [iface('fe80::2', 'IPv6')] } as ReturnType<typeof networkInterfaces>
    expect(getLanInterfaceNames(withVeth)).toEqual(['eth0'])
  })
})
