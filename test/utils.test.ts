import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { parseCli } from '../src/cli'
import { parseCredentials, verifyBasicAuth } from '../src/utils/auth'
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
