import type { MediaInfo, QualityLevel } from '@shared/api'

/** 「原画」清晰度，直接播放源文件 */
export const SOURCE_QUALITY = 'source'

export function getQualityLabel(id: string): string {
  return id === SOURCE_QUALITY ? '原画' : id
}

/** 按扩展名推断的容器类型，用于判断能否直接播放 */
export function guessVideoMime(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'webm')
    return 'video/webm'
  if (ext === 'ogv' || ext === 'ogg')
    return 'video/ogg'
  return 'video/mp4'
}

/** ffprobe 编码名 → MSE / canPlayType 使用的 codecs 字符串 */
const VIDEO_CODECS: Record<string, string> = {
  h264: 'avc1.640028',
  hevc: 'hvc1.1.6.L120.90',
  av1: 'av01.0.08M.08',
  vp9: 'vp09.00.40.08',
  vp8: 'vp8',
  mpeg4: 'mp4v.20.9',
}

const AUDIO_CODECS: Record<string, string> = {
  aac: 'mp4a.40.2',
  mp3: 'mp4a.6B',
  opus: 'opus',
  vorbis: 'vorbis',
  flac: 'flac',
  ac3: 'ac-3',
  eac3: 'ec-3',
}

/** 浏览器原生支持的容器，其余（mkv、avi…）按 mp4 判断编码 */
function getContainer(mime: string): string {
  if (mime === 'video/webm' || mime === 'video/ogg')
    return mime
  return 'video/mp4'
}

export type SourceSupport = 'yes' | 'no' | 'unknown'

/**
 * 根据探测到的编码判断浏览器能否直接播放源文件。
 * 未探测到编码时返回 unknown，按可播放处理，播放失败后再回退到转码。
 */
export function getSourceSupport(info: Pick<MediaInfo, 'videoCodec' | 'audioCodec'> | undefined, mime: string, canPlayType: (type: string) => string): SourceSupport {
  if (!info?.videoCodec)
    return 'unknown'
  const video = VIDEO_CODECS[info.videoCodec]
  if (!video)
    return 'no'
  const codecs = [video]
  const audio = info.audioCodec ? AUDIO_CODECS[info.audioCodec] : undefined
  if (info.audioCodec && !audio)
    return 'no'
  if (audio)
    codecs.push(audio)
  return canPlayType(`${getContainer(mime)}; codecs="${codecs.join(', ')}"`) === '' ? 'no' : 'yes'
}

/** 档位高度，如 `720p` → 720（宽银幕视频的实际高度会更小） */
function getTier(id: string): number {
  return Number.parseInt(id) || 0
}

/** 源文件无法播放时的默认转码清晰度：不超过 720p 的最高一档 */
function pickFallbackLevel(levels: QualityLevel[]): string {
  return (levels.find(level => getTier(level.id) <= 720) ?? levels.at(-1)!).id
}

export interface ResolvedQuality {
  quality: string
  /** 未按用户偏好、自动切换到了转码清晰度 */
  auto: boolean
}

/**
 * 根据偏好决定实际使用的清晰度。
 * levels 从高到低排列；偏好的清晰度不存在时（如 720p 视频偏好 1080p），选择不高于偏好的最高一档。
 */
export function resolveQuality(preferred: string, levels: QualityLevel[], sourcePlayable: boolean): ResolvedQuality {
  if (levels.length === 0)
    return { quality: SOURCE_QUALITY, auto: false }
  if (preferred === SOURCE_QUALITY) {
    return sourcePlayable
      ? { quality: SOURCE_QUALITY, auto: false }
      : { quality: pickFallbackLevel(levels), auto: true }
  }
  if (levels.some(level => level.id === preferred))
    return { quality: preferred, auto: false }

  const tier = getTier(preferred)
  const lower = tier > 0 ? levels.find(level => getTier(level.id) <= tier) : undefined
  if (lower)
    return { quality: lower.id, auto: false }
  return sourcePlayable ? { quality: SOURCE_QUALITY, auto: false } : { quality: levels.at(-1)!.id, auto: false }
}
