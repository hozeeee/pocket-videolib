import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { parseCli } from '../src/cli'
import { resolveConfig } from '../src/config'
import { parseIfconfigMedia, parseIwBitrate, parseSystemProfilerWifi, parseWindowsAdapters } from '../src/utils/link-speed'
import { formatBitrate, formatRate, parseRate, RateLimiter, ThrottleStream } from '../src/utils/throttle'

describe('parseRate', () => {
  it('parses byte units with 1024 base', () => {
    expect(parseRate('512')).toBe(512)
    expect(parseRate('500K')).toBe(500 * 1024)
    expect(parseRate('2M')).toBe(2 * 1024 ** 2)
    expect(parseRate('1.5MB/s')).toBe(1.5 * 1024 ** 2)
    expect(parseRate('1GiB')).toBe(1024 ** 3)
  })

  it('parses bit units with 1000 base', () => {
    expect(parseRate('20Mbps')).toBe(2_500_000)
    expect(parseRate('800 kbit')).toBe(100_000)
    expect(parseRate('1Gbps')).toBe(125_000_000)
  })

  it('rejects invalid values', () => {
    expect(parseRate('fast')).toBeUndefined()
    expect(parseRate('-1M')).toBeUndefined()
    expect(parseRate('10X')).toBeUndefined()
  })
})

describe('limit rate option', () => {
  it('is passed through cli and validated by config', () => {
    expect(parseCli(['--limit-rate', '2M'])).toMatchObject({ options: { limitRate: '2M' } })
    expect(resolveConfig({ limitRate: '2M' }).limitRate).toBe(2 * 1024 ** 2)
    expect(resolveConfig({ limitRate: '0' }).limitRate).toBeUndefined()
    expect(resolveConfig({}).limitRate).toBeUndefined()
    expect(() => resolveConfig({ limitRate: 'abc' })).toThrow(/Invalid rate/)
    expect(() => resolveConfig({ limitRate: '100' })).toThrow(/too low/)
  })
})

describe('format', () => {
  it('formats bitrates and byte rates', () => {
    expect(formatBitrate(1e9)).toBe('1 Gbps')
    expect(formatBitrate(866.7e6)).toBe('867 Mbps')
    expect(formatBitrate(54e6)).toBe('54 Mbps')
    expect(formatRate(10 * 1024 ** 2)).toBe('10 MiB/s (83.9 Mbps)')
    expect(formatRate(2_500_000)).toBe('2.4 MiB/s (20 Mbps)')
  })
})

describe('rate limiter', () => {
  it('allows a small burst then delays according to the rate', () => {
    let now = 0
    const limiter = new RateLimiter(10_000, () => now)
    // 突发容量为 1000 字节（100ms）
    expect(limiter.reserve(1000)).toBe(0)
    expect(limiter.reserve(500)).toBe(50)
    expect(limiter.reserve(500)).toBe(100)
    now = 100
    expect(limiter.reserve(0)).toBe(0)
  })

  it('does not accumulate tokens beyond the burst while idle', () => {
    let now = 0
    const limiter = new RateLimiter(10_000, () => now)
    now = 60_000
    expect(limiter.reserve(1000)).toBe(0)
    expect(limiter.reserve(1000)).toBe(100)
  })

  it('throttles stream throughput', async () => {
    const data = Buffer.alloc(6 * 1024, 7)
    const limiter = new RateLimiter(16 * 1024)
    const startedAt = Date.now()
    const chunks: Buffer[] = []
    for await (const chunk of Readable.from([data]).pipe(new ThrottleStream(limiter)))
      chunks.push(chunk as Buffer)
    // 6 KiB 减去 1.6 KiB 突发，按 16 KiB/s 约需 275ms
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200)
    expect(Buffer.concat(chunks)).toEqual(data)
  })
})

describe('link speed parsers', () => {
  it('parses iw output', () => {
    expect(parseIwBitrate('\ttx bitrate: 866.7 MBit/s VHT-MCS 9 80MHz short GI VHT-NSS 2\n')).toBe(866.7)
    expect(parseIwBitrate('Not connected.')).toBeUndefined()
  })

  it('parses macOS ifconfig media', () => {
    expect(parseIfconfigMedia('\tmedia: autoselect (1000baseT <full-duplex>)\n')).toBe(1000)
    expect(parseIfconfigMedia('\tmedia: autoselect (10GbaseT <full-duplex>)\n')).toBe(10_000)
    expect(parseIfconfigMedia('\tmedia: autoselect\n')).toBeUndefined()
  })

  it('parses macOS system profiler Wi-Fi rate', () => {
    const output = JSON.stringify({
      SPAirPortDataType: [{
        spairport_airport_interfaces: [{
          _name: 'en0',
          spairport_current_network_information: {
            _name: '<redacted>',
            spairport_network_rate: 1200,
          },
        }],
      }],
    })
    expect(parseSystemProfilerWifi(output)).toEqual([{ name: 'en0', mbps: 1200, virtual: false }])
    expect(parseSystemProfilerWifi('{ invalid')).toEqual([])
  })

  it('accepts string Wi-Fi rates from system profiler', () => {
    const output = JSON.stringify({
      SPAirPortDataType: [{
        spairport_airport_interfaces: [{
          _name: 'en1',
          spairport_current_network_information: { spairport_network_rate: '866.7 Mbps' },
        }],
      }],
    })
    expect(parseSystemProfilerWifi(output)).toEqual([{ name: 'en1', mbps: 866.7, virtual: false }])
  })

  it('parses windows adapters', () => {
    const output = '以太网\t1000000000\tFalse\r\nWLAN\t433300000\tFalse\r\nvEthernet (WSL)\t10000000000\tTrue\r\n断开\t0\tFalse\r\n'
    expect(parseWindowsAdapters(output)).toEqual([
      { name: '以太网', mbps: 1000, virtual: false },
      { name: 'WLAN', mbps: 433.3, virtual: false },
      { name: 'vEthernet (WSL)', mbps: 10_000, virtual: true },
    ])
  })
})
