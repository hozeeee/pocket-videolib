/**
 * 服务端与 Web 端共享的接口类型定义
 */

export type MediaKind = 'video' | 'audio' | 'image' | 'subtitle' | 'other'

export type EntryType = 'directory' | 'file'

export interface DirectoryEntry {
  name: string
  /** 相对于媒体根目录的路径，使用 `/` 分隔，不以 `/` 开头 */
  path: string
  type: EntryType
  /** 仅 file 类型有效 */
  kind?: MediaKind
  size: number
  /** 修改时间，毫秒时间戳 */
  mtime: number
}

export interface ListResponse {
  path: string
  entries: DirectoryEntry[]
}

export interface ServerInfo {
  name: string
  version: string
  /** 媒体根目录名称（不暴露绝对路径） */
  rootName: string
}

export interface ErrorResponse {
  error: string
}

/** 一个转码清晰度 */
export interface QualityLevel {
  /** 如 `720p`，同时作为 HLS URL 中的路径段 */
  id: string
  width: number
  height: number
  /** 峰值码率估算（bit/s） */
  bandwidth: number
}

/** `GET /api/media-info` 的响应 */
export interface MediaInfo {
  /** 源文件版本（与 `/media` 的 ETag 相同），文件变更后改变 */
  version: string
  /** 以下字段来自 ffprobe，服务端未启用转码或探测失败时缺省 */
  duration?: number
  /** 显示尺寸（已考虑旋转与像素宽高比） */
  width?: number
  height?: number
  /** ffprobe 的编码名称，如 `h264`、`hevc`、`aac` */
  videoCodec?: string
  audioCodec?: string
  /** 可用的转码清晰度（从高到低），未启用转码时为空 */
  levels: QualityLevel[]
  /** HLS 分片时长（秒） */
  segmentDuration: number
}

export const API_PREFIX = '/api'
export const MEDIA_PREFIX = '/media/'
export const HLS_PREFIX = '/hls/'
export const HLS_PLAYLIST_NAME = 'index.m3u8'
/** HLS 分片响应中携带的源文件版本头 */
export const MEDIA_VERSION_HEADER = 'X-Media-Version'

function encodePath(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/')
}

/** 将相对路径编码为媒体访问 URL，逐段编码以保留 `/` */
export function toMediaUrl(relativePath: string): string {
  return MEDIA_PREFIX + encodePath(relativePath)
}

/**
 * 某个清晰度的 HLS 媒体播放列表：`/hls/<文件路径>/<清晰度>/index.m3u8`。
 * 分片与播放列表位于同一目录（`0.ts`、`1.ts`…），播放列表中使用相对地址。
 */
export function toHlsPlaylistUrl(relativePath: string, level: string): string {
  return `${HLS_PREFIX}${encodePath(relativePath)}/${encodeURIComponent(level)}/${HLS_PLAYLIST_NAME}`
}

export function toHlsSegmentName(index: number): string {
  return `${index}.ts`
}

/** 解析分片文件名，返回分片序号；不是分片时返回 -1 */
export function parseHlsSegmentName(name: string): number {
  const match = /^(\d+)\.ts$/.exec(name)
  return match ? Number(match[1]) : -1
}
