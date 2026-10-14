import type { MaybeRefOrGetter } from 'vue'
import { onBeforeUnmount, ref, shallowRef, toValue, watch } from 'vue'
import { getHlsKey, getMediaKey } from '@/services/api'
import { assembleFile } from '@/services/media-cache'
import { swActive } from '@/services/sw-client'
import { SOURCE_QUALITY } from '@/utils/quality'

/** 播放源：原画文件，或某个清晰度的 HLS 播放列表 */
export type PlaybackSource
  = | { type: 'file', url: string }
    | { type: 'hls', url: string }

/**
 * 决定播放器使用的播放源：
 * - 转码清晰度：使用 HLS 播放列表，已缓存的分片由 Service Worker / hls.js 加载器从本地读取
 * - 原画 + Service Worker 已接管：使用网络地址，由 SW 透明地返回已缓存的分片（边缓存边播放）
 * - 原画 + 无 Service Worker：缓存完成后使用本地 Blob URL 播放，未完成时直接走网络
 *
 * quality 为空表示尚未确定清晰度，此时不返回播放源。
 */
export function usePlaybackSource(path: MaybeRefOrGetter<string>, quality: MaybeRefOrGetter<string | undefined>, cacheDone: MaybeRefOrGetter<boolean>) {
  const source = shallowRef<PlaybackSource>()
  const fromLocal = ref(false)
  let objectUrl: string | undefined
  /** 本地 Blob 播放失败后，当前文件不再尝试本地播放 */
  let localFailed = false
  let generation = 0

  function revoke(): void {
    if (objectUrl)
      URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
    fromLocal.value = false
  }

  function setSource(next: PlaybackSource): void {
    if (source.value?.type !== next.type || source.value.url !== next.url)
      source.value = next
  }

  async function resolve(): Promise<void> {
    const current = ++generation
    const p = toValue(path)
    const q = toValue(quality)
    if (!p || !q) {
      revoke()
      source.value = undefined
      return
    }
    if (q !== SOURCE_QUALITY) {
      revoke()
      setSource({ type: 'hls', url: getHlsKey(p, q) })
      return
    }

    const key = getMediaKey(p)
    if (!swActive.value && toValue(cacheDone) && !localFailed) {
      // 已经在使用本地 Blob 时保持不变
      if (objectUrl)
        return
      const blob = await assembleFile(key).catch(() => undefined)
      if (current !== generation)
        return
      if (blob) {
        objectUrl = URL.createObjectURL(blob)
        fromLocal.value = true
        setSource({ type: 'file', url: objectUrl })
        return
      }
    }
    // 播放中途缓存被删除等情况，已加载的 Blob 仍可继续播放
    if (objectUrl && !localFailed && !swActive.value)
      return
    revoke()
    setSource({ type: 'file', url: key })
  }

  /** 本地 Blob 播放失败时改为从网络播放，返回是否进行了切换 */
  function fallbackToNetwork(): boolean {
    if (!fromLocal.value)
      return false
    localFailed = true
    void resolve()
    return true
  }

  watch(() => toValue(path), () => {
    revoke()
    localFailed = false
    void resolve()
  }, { immediate: true })
  watch([() => toValue(quality), () => toValue(cacheDone), swActive], () => void resolve())

  onBeforeUnmount(() => {
    generation++
    revoke()
  })

  return { source, fromLocal, fallbackToNetwork }
}
