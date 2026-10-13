import type { MaybeRefOrGetter } from 'vue'
import type { DownloadTask } from '@/services/download-manager'
import { computed, toValue, watch } from 'vue'
import { getMediaKey } from '@/services/api'
import { downloadManager } from '@/services/download-manager'

/** 某个媒体文件的缓存任务状态及操作 */
export function useDownloadTask(path: MaybeRefOrGetter<string>, size: MaybeRefOrGetter<number>) {
  watch(() => toValue(path), p => void downloadManager.load(p), { immediate: true })

  const task = computed<DownloadTask | undefined>(() => downloadManager.tasks.get(getMediaKey(toValue(path))))
  const progress = computed(() => task.value && task.value.chunkCount > 0 ? task.value.cachedChunks / task.value.chunkCount : 0)
  const isDone = computed(() => task.value?.status === 'done')
  const isRunning = computed(() => task.value?.status === 'downloading' || task.value?.status === 'queued')

  return {
    task,
    progress,
    isDone,
    isRunning,
    start: (fromOffset = 0) => downloadManager.start(toValue(path), toValue(size), fromOffset),
    pause: () => downloadManager.pause(toValue(path)),
    remove: () => downloadManager.remove(toValue(path)),
    prioritize: (offset: number) => downloadManager.prioritize(toValue(path), offset),
  }
}
