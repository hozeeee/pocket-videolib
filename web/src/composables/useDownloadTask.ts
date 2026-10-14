import type { MaybeRefOrGetter } from 'vue'
import type { CacheTarget, DownloadTask } from '@/services/download-manager'
import { computed, toValue, watch } from 'vue'
import { downloadManager, getTargetKey } from '@/services/download-manager'

/** 某个缓存目标（原画或某个清晰度）的缓存任务状态及操作 */
export function useDownloadTask(target: MaybeRefOrGetter<CacheTarget | undefined>) {
  const key = computed(() => {
    const value = toValue(target)
    return value ? getTargetKey(value) : undefined
  })
  watch(key, k => k && void downloadManager.load(k), { immediate: true })

  const task = computed<DownloadTask | undefined>(() => key.value ? downloadManager.tasks.get(key.value) : undefined)
  const progress = computed(() => task.value && task.value.chunkCount > 0 ? task.value.cachedChunks / task.value.chunkCount : 0)
  const isDone = computed(() => task.value?.status === 'done')
  const isRunning = computed(() => task.value?.status === 'downloading' || task.value?.status === 'queued')

  return {
    key,
    task,
    progress,
    isDone,
    isRunning,
    /** position：优先缓存的位置（0~1） */
    start: (position = 0) => {
      const value = toValue(target)
      if (value)
        downloadManager.start(value, position)
    },
    pause: () => key.value && downloadManager.pause(key.value),
    remove: () => key.value ? downloadManager.remove(key.value) : Promise.resolve(),
    prioritize: (position: number) => key.value && downloadManager.prioritize(key.value, position),
  }
}
