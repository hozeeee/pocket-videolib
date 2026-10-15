import type { AddressInfo } from 'node:net'
import type { MediaInfo } from '../shared/api'
import type { AppConfig } from '../src/config'
import type { ProbeResult } from '../src/utils/ffmpeg'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MEDIA_VERSION_HEADER } from '../shared/api'
import { parseSize } from '../src/config'
import { createServer, listen } from '../src/server'
import { buildPlaylist, buildSegmentArgs, getQualityLevels, getSegments } from '../src/transcode'
import { detectFfmpeg, parseProbeOutput, runCommand } from '../src/utils/ffmpeg'

describe('getQualityLevels', () => {
  it('builds the ladder below the source resolution', () => {
    expect(getQualityLevels(1920, 1080).map(l => `${l.id}:${l.width}x${l.height}`))
      .toEqual(['1080p:1920x1080', '720p:1280x720', '480p:854x480', '360p:640x360'])
    expect(getQualityLevels(1280, 720).map(l => l.id)).toEqual(['720p', '480p', '360p'])
  })

  it('treats widescreen and portrait videos by their equivalent height', () => {
    const wide = getQualityLevels(1920, 800)
    expect(wide[0]).toMatchObject({ id: '1080p', width: 1920, height: 800 })
    const portrait = getQualityLevels(1080, 1920)
    expect(portrait[0]).toMatchObject({ id: '1080p', width: 1080, height: 1920 })
    expect(portrait[1]).toMatchObject({ id: '720p', width: 720, height: 1280 })
  })

  it('never upscales and always offers at least one level', () => {
    expect(getQualityLevels(320, 240)).toEqual([expect.objectContaining({ id: '360p', width: 320, height: 240 })])
    expect(getQualityLevels(3840, 2160)[0].id).toBe('1080p')
  })

  it('uses even dimensions', () => {
    for (const level of getQualityLevels(1918, 1078)) {
      expect(level.width % 2).toBe(0)
      expect(level.height % 2).toBe(0)
    }
  })
})

describe('getSegments / buildPlaylist', () => {
  it('splits into fixed segments and merges a tiny tail', () => {
    expect(getSegments(14, 6)).toEqual([{ start: 0, duration: 6 }, { start: 6, duration: 6 }, { start: 12, duration: 2 }])
    expect(getSegments(12.5, 6)).toEqual([{ start: 0, duration: 6 }, { start: 6, duration: 6.5 }])
    expect(getSegments(0.5, 6)).toEqual([{ start: 0, duration: 0.5 }])
    expect(getSegments(0, 6)).toEqual([])
  })

  it('builds a VOD playlist with relative segment names', () => {
    const playlist = buildPlaylist(getSegments(12.5, 6))
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(playlist).toContain('#EXT-X-TARGETDURATION:7')
    expect(playlist).toContain('#EXTINF:6.500,\n1.ts')
    expect(playlist.trim().endsWith('#EXT-X-ENDLIST')).toBe(true)
  })
})

describe('buildSegmentArgs', () => {
  const level = getQualityLevels(1920, 1080)[1]
  const probe: ProbeResult = { duration: 60, width: 1920, height: 1080, videoStream: 0, audioStream: 1 }

  it('seeks, scales and keeps the original timestamps', () => {
    const args = buildSegmentArgs('/in.mp4', '/out.ts', { start: 12, duration: 6 }, level, probe)
    const joined = args.join(' ')
    expect(joined).toContain('-ss 12.000 -i /in.mp4 -t 6.000')
    expect(joined).toContain('-map 0:0 -map 0:1')
    expect(joined).toContain('scale=1280:720')
    expect(joined).toContain('-c:a aac')
    expect(joined).toContain('-output_ts_offset 12.000 -f mpegts /out.ts')
  })

  it('skips audio when the source has none', () => {
    const args = buildSegmentArgs('/in.mp4', '/out.ts', { start: 0, duration: 6 }, level, { ...probe, audioStream: undefined })
    expect(args).not.toContain('-c:a')
    expect(args.filter(a => a === '-map')).toHaveLength(1)
  })
})

describe('parseProbeOutput', () => {
  it('picks the first real video stream and audio stream', () => {
    const result = parseProbeOutput({
      format: { duration: '61.5' },
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', width: 300, height: 300, disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 },
        { index: 2, codec_type: 'audio', codec_name: 'aac' },
      ],
    })
    expect(result).toEqual({ duration: 61.5, width: 3840, height: 2160, videoCodec: 'hevc', audioCodec: 'aac', videoStream: 1, audioStream: 2 })
  })

  it('applies rotation and sample aspect ratio', () => {
    expect(parseProbeOutput({
      streams: [{ index: 0, codec_type: 'video', width: 1920, height: 1080, side_data_list: [{ rotation: -90 }], duration: '10' }],
    })).toMatchObject({ width: 1080, height: 1920, duration: 10 })
    expect(parseProbeOutput({
      streams: [{ index: 0, codec_type: 'video', width: 720, height: 576, sample_aspect_ratio: '16:11' }],
    })).toMatchObject({ width: 1047, height: 576 })
  })

  it('handles audio-only files', () => {
    const result = parseProbeOutput({ format: { duration: 'N/A' }, streams: [{ index: 0, codec_type: 'audio', codec_name: 'mp3', duration: '30' }] })
    expect(result).toMatchObject({ duration: 30, audioCodec: 'mp3', videoStream: undefined })
    expect(result.width).toBeUndefined()
  })
})

describe('parseSize', () => {
  it('parses binary sizes', () => {
    expect(parseSize('500M')).toBe(500 * 1024 ** 2)
    expect(parseSize('10G')).toBe(10 * 1024 ** 3)
    expect(parseSize('1.5TB')).toBe(Math.floor(1.5 * 1024 ** 4))
    expect(parseSize('2048')).toBe(2048)
    expect(parseSize('abc')).toBeUndefined()
  })
})

// 需要本机安装带 libx264 的 ffmpeg（可通过 FFMPEG / FFPROBE 环境变量指定），否则跳过
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
const FFPROBE = process.env.FFPROBE ?? 'ffprobe'
const ffmpeg = await detectFfmpeg(FFMPEG, FFPROBE)

describe.skipIf(!ffmpeg.available)('hls transcoding (ffmpeg)', () => {
  let root: string
  let cacheDir: string
  let base: string
  let close: () => void

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pvl-hls-'))
    cacheDir = await mkdtemp(join(tmpdir(), 'pvl-hls-cache-'))
    await writeFile(join(root, 'notes.txt'), 'hello')
    const result = await runCommand(FFMPEG, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440',
      '-t',
      '8',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      join(root, 'clip.mp4'),
    ], { timeout: 60_000 })
    expect(result.code).toBe(0)

    const config: AppConfig = {
      root,
      port: 0,
      host: '127.0.0.1',
      speedTest: false,
      showHidden: false,
      followSymlinks: false,
      verbose: false,
      transcode: { ffmpeg: FFMPEG, ffprobe: FFPROBE, cacheDir, cacheSize: 1024 ** 3 },
    }
    const server = createServer(config)
    await listen(server, 0, '127.0.0.1')
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    close = () => server.close()
  }, 90_000)

  afterAll(async () => {
    close?.()
    await rm(root, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('reports codecs and quality levels', async () => {
    const res = await fetch(`${base}/api/media-info?path=clip.mp4`)
    const info = await res.json() as MediaInfo
    expect(info).toMatchObject({ width: 640, height: 360, videoCodec: 'h264', audioCodec: 'aac', segmentDuration: 6 })
    expect(info.duration).toBeCloseTo(8, 0)
    expect(info.levels.map(l => l.id)).toEqual(['360p'])
    expect(info.version).toBe((await fetch(`${base}/media/clip.mp4`, { method: 'HEAD' })).headers.get('ETag'))
  })

  it('serves a playlist and transcodes segments on demand', async () => {
    const playlist = await fetch(`${base}/hls/clip.mp4/360p/index.m3u8`)
    expect(playlist.status).toBe(200)
    expect(playlist.headers.get('Content-Type')).toContain('mpegurl')
    const version = playlist.headers.get(MEDIA_VERSION_HEADER)
    expect(version).toBeTruthy()
    expect((await playlist.text()).match(/\.ts$/gm)).toHaveLength(2)

    const segment = await fetch(`${base}/hls/clip.mp4/360p/1.ts`)
    expect(segment.status).toBe(200)
    expect(segment.headers.get('Content-Type')).toBe('video/mp2t')
    expect(segment.headers.get(MEDIA_VERSION_HEADER)).toBe(version)
    const data = new Uint8Array(await segment.arrayBuffer())
    expect(data.length).toBeGreaterThan(10_000)
    // MPEG-TS 同步字节
    expect(data[0]).toBe(0x47)
    expect(data[188]).toBe(0x47)

    // 第二次请求命中磁盘缓存，内容一致
    const again = new Uint8Array(await (await fetch(`${base}/hls/clip.mp4/360p/1.ts`)).arrayBuffer())
    expect(again).toEqual(data)
  }, 60_000)

  it('rejects unknown levels, segments and non-video files', async () => {
    expect((await fetch(`${base}/hls/clip.mp4/1080p/index.m3u8`)).status).toBe(404)
    expect((await fetch(`${base}/hls/clip.mp4/360p/9.ts`)).status).toBe(404)
    expect((await fetch(`${base}/hls/notes.txt/360p/index.m3u8`)).status).toBe(404)
  })
})
