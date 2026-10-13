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

export const API_PREFIX = '/api'
export const MEDIA_PREFIX = '/media/'

/** 将相对路径编码为媒体访问 URL，逐段编码以保留 `/` */
export function toMediaUrl(relativePath: string): string {
  return MEDIA_PREFIX + relativePath.split('/').map(encodeURIComponent).join('/')
}
