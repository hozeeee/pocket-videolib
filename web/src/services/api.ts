import type { ErrorResponse, ListResponse, MediaInfo, ServerInfo } from '@shared/api'
import { API_PREFIX, toHlsPlaylistUrl, toMediaUrl } from '@shared/api'

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_PREFIX}${path}`, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as ErrorResponse | null
    throw new ApiError(res.status, body?.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export function fetchServerInfo(): Promise<ServerInfo> {
  return request<ServerInfo>('/info')
}

export function fetchDirectory(path: string, signal?: AbortSignal): Promise<ListResponse> {
  return request<ListResponse>(`/list?path=${encodeURIComponent(path)}`, signal)
}

export function fetchMediaInfo(path: string, signal?: AbortSignal): Promise<MediaInfo> {
  return request<MediaInfo>(`/media-info?path=${encodeURIComponent(path)}`, signal)
}

/**
 * 媒体文件的 URL pathname，同时作为缓存主键。
 * 经过 URL 解析以保证与 Service Worker 中 `new URL(request.url).pathname` 一致。
 */
export function getMediaKey(path: string): string {
  return new URL(toMediaUrl(path), location.origin).pathname
}

/** 某个清晰度的播放列表 pathname，同时作为该清晰度的缓存主键 */
export function getHlsKey(path: string, level: string): string {
  return new URL(toHlsPlaylistUrl(path, level), location.origin).pathname
}

export function getSubtitleUrl(path: string): string {
  return `${toMediaUrl(path)}?format=vtt`
}

export function getDownloadUrl(path: string): string {
  return `${toMediaUrl(path)}?download`
}
