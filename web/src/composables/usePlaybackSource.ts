import type { MaybeRefOrGetter } from 'vue'
import { onBeforeUnmount, ref, toValue, watch } from 'vue'
import { getMediaKey } from '@/services/api'
import { assembleFile } from '@/services/media-cache'
import { swActive } from '@/services/sw-client'

/**
 * 决定 <video> 使用的播放地址：
 * - Service Worker 已接管：始终使用网络地址，由 SW 透明地返回已缓存的分片（边缓存边播放）
 * - 否则：缓存完成后使用本地 Blob URL 播放，未完成时直接走网络
 */
export function usePlaybackSource(path: MaybeRefOrGetter<string>, cacheDone: MaybeRefOrGetter<boolean>) {
  const src = ref('')
  const fromLocal = ref(false)
  let objectUrl: string | undefined

  function revoke(): void {
    if (objectUrl)
      URL.revokeObjectURL(objectUrl)
    objectUrl = undefined
  }

  async function resolve(): Promise<void> {
    const key = getMediaKey(toValue(path))
    if (!swActive.value && toValue(cacheDone)) {
      const blob = await assembleFile(key).catch(() => undefined)
      if (blob) {
        revoke()
        objectUrl = URL.createObjectURL(blob)
        src.value = objectUrl
        fromLocal.value = true
        return
      }
    }
    // 已经在使用本地 Blob 时不再切回网络
    if (fromLocal.value && objectUrl)
      return
    src.value = key
    fromLocal.value = false
  }

  watch(() => toValue(path), () => {
    revoke()
    fromLocal.value = false
    void resolve()
  }, { immediate: true })
  watch([() => toValue(cacheDone), swActive], () => void resolve())

  onBeforeUnmount(revoke)

  return { src, fromLocal }
}
