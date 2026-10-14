import type { CacheMessage } from '../web/src/services/cache-sync'
import type { CachedFile } from '../web/src/services/media-cache'
import { describe, expect, it } from 'vitest'
import { broadcastChunk, getFetching, markFetching, subscribeCache, waitForChunk } from '../web/src/services/cache-sync'
import { getHlsSegmentPath, isHlsPlaylistPath, parseHlsSegmentPath, parsePlaylistSegments } from '../web/src/utils/hls'
import { getSourceSupport, guessVideoMime, resolveQuality, SOURCE_QUALITY } from '../web/src/utils/quality'

const LEVELS = ['1080p', '720p', '480p', '360p'].map(id => ({ id, width: 0, height: Number.parseInt(id), bandwidth: 0 }))

describe('hls utils', () => {
  it('parses segment paths into the playlist key', () => {
    expect(parseHlsSegmentPath('/hls/%E5%89%A7/a.mp4/720p/12.ts')).toEqual({ key: '/hls/%E5%89%A7/a.mp4/720p/index.m3u8', index: 12 })
    expect(parseHlsSegmentPath('/hls/a.mp4/720p/index.m3u8')).toBeNull()
    expect(parseHlsSegmentPath('/media/a.ts')).toBeNull()
    expect(getHlsSegmentPath('/hls/a.mp4/720p/index.m3u8', 3)).toBe('/hls/a.mp4/720p/3.ts')
    expect(isHlsPlaylistPath('/hls/a.mp4/720p/index.m3u8')).toBe(true)
    expect(isHlsPlaylistPath('/media/index.m3u8')).toBe(false)
  })

  it('lists playlist segments', () => {
    expect(parsePlaylistSegments('#EXTM3U\r\n#EXTINF:6.000,\n0.ts\n#EXTINF:2.000,\n1.ts\n#EXT-X-ENDLIST\n')).toEqual(['0.ts', '1.ts'])
  })
})

describe('quality utils', () => {
  it('guesses the container from the extension', () => {
    expect(guessVideoMime('a.MP4')).toBe('video/mp4')
    expect(guessVideoMime('a.webm')).toBe('video/webm')
    expect(guessVideoMime('a.mkv')).toBe('video/mp4')
  })

  it('checks codecs with canPlayType', () => {
    const asked: string[] = []
    const h264Only = (type: string): string => {
      asked.push(type)
      return type.includes('avc1') ? 'probably' : ''
    }
    expect(getSourceSupport({ videoCodec: 'h264', audioCodec: 'aac' }, 'video/mp4', h264Only)).toBe('yes')
    expect(asked[0]).toBe('video/mp4; codecs="avc1.640028, mp4a.40.2"')
    expect(getSourceSupport({ videoCodec: 'hevc', audioCodec: 'aac' }, 'video/mp4', h264Only)).toBe('no')
    // 浏览器不支持的音频编码同样无法播放
    expect(getSourceSupport({ videoCodec: 'h264', audioCodec: 'dts' }, 'video/mp4', h264Only)).toBe('no')
    expect(getSourceSupport(undefined, 'video/mp4', h264Only)).toBe('unknown')
  })

  it('resolves the preferred quality', () => {
    expect(resolveQuality(SOURCE_QUALITY, LEVELS, true)).toEqual({ quality: SOURCE_QUALITY, auto: false })
    // 原画无法播放时自动选择不超过 720p 的最高一档
    expect(resolveQuality(SOURCE_QUALITY, LEVELS, false)).toEqual({ quality: '720p', auto: true })
    expect(resolveQuality('480p', LEVELS, true)).toEqual({ quality: '480p', auto: false })
    // 偏好的档位不存在时取不高于偏好的最高一档
    expect(resolveQuality('1080p', LEVELS.slice(2), true)).toEqual({ quality: '480p', auto: false })
    expect(resolveQuality('240p', LEVELS, false)).toEqual({ quality: '360p', auto: false })
    expect(resolveQuality('720p', [], true)).toEqual({ quality: SOURCE_QUALITY, auto: false })
  })
})

describe('cache sync', () => {
  const file = { url: '/media/a.mp4' } as CachedFile

  it('tracks chunks being fetched until they are stored or released', () => {
    markFetching('/media/a.mp4', 1, 'play', true)
    expect(getFetching('/media/a.mp4', 1)).toBe('play')
    expect(getFetching('/media/a.mp4', 2)).toBeUndefined()
    broadcastChunk('/media/a.mp4', 1, file)
    expect(getFetching('/media/a.mp4', 1)).toBeUndefined()

    markFetching('/media/a.mp4', 3, 'download', true)
    markFetching('/media/a.mp4', 3, 'download', false)
    expect(getFetching('/media/a.mp4', 3)).toBeUndefined()
  })

  it('notifies local subscribers', () => {
    const messages: CacheMessage[] = []
    const unsubscribe = subscribeCache(message => messages.push(message))
    broadcastChunk('/media/b.mp4', 0, file)
    unsubscribe()
    broadcastChunk('/media/b.mp4', 1, file)
    expect(messages.map(m => `${m.type}:${m.index}`)).toEqual(['chunk:0'])
  })

  it('waits for a chunk fetched by someone else', async () => {
    expect(await waitForChunk('/media/c.mp4', 0, 1000)).toBe(false)

    markFetching('/media/c.mp4', 0, 'download', true)
    const stored = waitForChunk('/media/c.mp4', 0, 1000)
    setTimeout(broadcastChunk, 10, '/media/c.mp4', 0, file)
    expect(await stored).toBe(true)

    markFetching('/media/c.mp4', 1, 'download', true)
    const released = waitForChunk('/media/c.mp4', 1, 1000)
    setTimeout(markFetching, 10, '/media/c.mp4', 1, 'download', false)
    expect(await released).toBe(false)

    markFetching('/media/c.mp4', 2, 'download', true)
    expect(await waitForChunk('/media/c.mp4', 2, 20)).toBe(false)

    const controller = new AbortController()
    const aborted = waitForChunk('/media/c.mp4', 2, 1000, controller.signal)
    controller.abort()
    expect(await aborted).toBe(false)
  })
})
