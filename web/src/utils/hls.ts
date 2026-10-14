import { HLS_PLAYLIST_NAME, HLS_PREFIX, parseHlsSegmentName, toHlsSegmentName } from '@shared/api'

/** HLS 相关的纯函数，页面与 Service Worker 共用 */

/** 播放列表中的分片地址（非注释行） */
export function parsePlaylistSegments(playlist: string): string[] {
  return playlist
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

/**
 * 解析分片的 pathname：`/hls/a.mp4/720p/3.ts` → 播放列表 `/hls/a.mp4/720p/index.m3u8`（缓存主键）与序号 3。
 * 不是分片时返回 null。
 */
export function parseHlsSegmentPath(pathname: string): { key: string, index: number } | null {
  if (!pathname.startsWith(HLS_PREFIX))
    return null
  const slash = pathname.lastIndexOf('/')
  const index = parseHlsSegmentName(pathname.slice(slash + 1))
  if (index < 0)
    return null
  return { key: pathname.slice(0, slash + 1) + HLS_PLAYLIST_NAME, index }
}

export function isHlsPlaylistPath(pathname: string): boolean {
  return pathname.startsWith(HLS_PREFIX) && pathname.endsWith(`/${HLS_PLAYLIST_NAME}`)
}

/** 由播放列表主键得到第 index 个分片的地址 */
export function getHlsSegmentPath(key: string, index: number): string {
  return key.slice(0, key.lastIndexOf('/') + 1) + toHlsSegmentName(index)
}
