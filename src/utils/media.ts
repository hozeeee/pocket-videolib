import type { Stats } from 'node:fs'
import type { MediaKind } from '../../shared/api'
import { extname } from 'node:path'

/** 文件版本标识，同时用作强校验 ETag（If-Range 要求强比较） */
export function createEtag(s: Stats): string {
  return `"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`
}

interface MediaType {
  kind: MediaKind
  mime: string
}

const MEDIA_TYPES: Record<string, MediaType> = {
  // video
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.ogv': { kind: 'video', mime: 'video/ogg' },
  '.avi': { kind: 'video', mime: 'video/x-msvideo' },
  '.wmv': { kind: 'video', mime: 'video/x-ms-wmv' },
  '.flv': { kind: 'video', mime: 'video/x-flv' },
  '.ts': { kind: 'video', mime: 'video/mp2t' },
  '.3gp': { kind: 'video', mime: 'video/3gpp' },
  // audio
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.flac': { kind: 'audio', mime: 'audio/flac' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.oga': { kind: 'audio', mime: 'audio/ogg' },
  '.opus': { kind: 'audio', mime: 'audio/opus' },
  // image
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.avif': { kind: 'image', mime: 'image/avif' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  '.svg': { kind: 'image', mime: 'image/svg+xml' },
  // subtitle
  '.vtt': { kind: 'subtitle', mime: 'text/vtt; charset=utf-8' },
  '.srt': { kind: 'subtitle', mime: 'application/x-subrip; charset=utf-8' },
}

const FALLBACK: MediaType = { kind: 'other', mime: 'application/octet-stream' }

export function getMediaType(filePath: string): MediaType {
  return MEDIA_TYPES[extname(filePath).toLowerCase()] ?? FALLBACK
}

export function getMediaKind(filePath: string): MediaKind {
  return getMediaType(filePath).kind
}
