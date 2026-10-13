<script setup lang="ts">
import type { DownloadTask, TaskStatus } from '@/services/download-manager'
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { formatBytes, formatDuration, formatPercent, formatSpeed } from '@/utils/format'
import CacheProgressBar from './CacheProgressBar.vue'

const props = defineProps<{
  task?: DownloadTask
  size: number
  playhead?: number
  /** Service Worker 是否已接管（可边缓存边播放） */
  streaming: boolean
  /** 当前是否正在播放本地缓存 */
  fromLocal: boolean
}>()

const emit = defineEmits<{
  start: []
  pause: []
  remove: []
}>()

const autoCache = defineModel<boolean>('autoCache', { required: true })

const STATUS_TEXT: Record<TaskStatus, string> = {
  idle: '未缓存',
  queued: '排队中',
  downloading: '缓存中',
  paused: '已暂停',
  done: '已缓存',
  error: '缓存失败',
}

const status = computed<TaskStatus>(() => props.task?.status ?? 'idle')
const progress = computed(() => props.task && props.task.chunkCount > 0 ? props.task.cachedChunks / props.task.chunkCount : 0)
const cachedBytes = computed(() => Math.min(progress.value * props.size, props.size))
const eta = computed(() => {
  const speed = props.task?.speed ?? 0
  return speed > 0 ? (props.size - cachedBytes.value) / speed : Number.NaN
})
const running = computed(() => status.value === 'downloading' || status.value === 'queued')

const modeHint = computed(() => {
  if (props.fromLocal)
    return '正在播放本地缓存，不消耗服务器带宽'
  if (props.streaming)
    return '已缓存的部分将直接从本地读取，可先缓存一段再观看'
  return '当前连接不支持边缓存边播放（需 HTTPS 或 localhost），缓存完成后会自动切换为本地播放'
})
</script>

<template>
  <div class="cache-panel card">
    <div class="head">
      <div class="title">
        <AppIcon name="cache" :size="16" />
        <span>离线缓存</span>
        <span class="status" :class="`status--${status}`">{{ STATUS_TEXT[status] }}</span>
      </div>
      <div class="actions">
        <button v-if="running" class="btn" @click="emit('pause')">
          <AppIcon name="pause" :size="16" />暂停
        </button>
        <button v-else-if="status !== 'done'" class="btn btn-primary" @click="emit('start')">
          <AppIcon name="download" :size="16" />{{ status === 'idle' ? '开始缓存' : '继续缓存' }}
        </button>
        <button v-if="task && (task.cachedChunks > 0 || status === 'error')" class="btn btn-danger btn-icon" title="删除缓存" @click="emit('remove')">
          <AppIcon name="trash" :size="16" />
        </button>
      </div>
    </div>

    <CacheProgressBar v-if="task" :bitmap="task.bitmap" :version="task.version" :playhead="playhead" />

    <div class="stats muted">
      <span>{{ formatPercent(progress) }} · {{ formatBytes(cachedBytes) }} / {{ formatBytes(size) }}</span>
      <span v-if="status === 'downloading'">{{ formatSpeed(task?.speed ?? 0) }} · 剩余 {{ formatDuration(eta) }}</span>
    </div>

    <p v-if="task?.error" class="error">
      {{ task.error }}
    </p>
    <p class="hint muted">
      {{ modeHint }}
    </p>

    <label class="auto">
      <input v-model="autoCache" type="checkbox">
      <span>打开视频时自动缓存（从当前播放位置开始）</span>
    </label>
  </div>
</template>

<style scoped>
.cache-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.status {
  padding: 1px 8px;
  border-radius: 9px;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
}

.status--downloading,
.status--queued {
  background: rgb(99 102 241 / 20%);
  color: var(--primary-hover);
}

.status--done {
  background: rgb(34 197 94 / 15%);
  color: var(--success);
}

.status--error {
  background: rgb(239 68 68 / 15%);
  color: var(--danger);
}

.actions {
  display: flex;
  gap: 6px;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.error {
  margin: 0;
  color: var(--danger);
}

.hint {
  margin: 0;
  font-size: 12px;
}

.auto {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}
</style>
