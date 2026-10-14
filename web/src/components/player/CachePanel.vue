<script setup lang="ts">
import type { DownloadTask, TaskStatus } from '@/services/download-manager'
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { formatBytes, formatDuration, formatPercent, formatSpeed } from '@/utils/format'
import CacheProgressBar from './CacheProgressBar.vue'

const props = defineProps<{
  task?: DownloadTask
  /** 尚未开始缓存时显示的大小（转码清晰度为预估值） */
  size: number
  /** 当前缓存的清晰度 */
  qualityLabel?: string
  /** 当前为转码清晰度 */
  transcoded: boolean
  playhead?: number
  /** 能否边缓存边播放（已缓存的部分从本地读取） */
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
const isHls = computed(() => props.task ? props.task.type === 'hls' : props.transcoded)
const total = computed(() => props.task?.size || props.size)
const cachedBytes = computed(() => props.task?.cachedBytes ?? 0)
/** 转码后的大小在缓存完成前只是预估 */
const approximate = computed(() => isHls.value && status.value !== 'done')
const eta = computed(() => {
  const speed = props.task?.speed ?? 0
  return speed > 0 ? Math.max(0, total.value - cachedBytes.value) / speed : Number.NaN
})
const running = computed(() => status.value === 'downloading' || status.value === 'queued')

const modeHint = computed(() => {
  if (props.fromLocal)
    return '正在播放本地缓存，不消耗服务器带宽'
  if (props.streaming)
    return '已缓存的部分直接从本地读取；开始缓存后，播放过的内容也会一并保存，播放缓冲不足时缓存会自动让路'
  if (isHls.value)
    return '当前浏览器播放转码清晰度时无法读取本地缓存（需 HTTPS 或 localhost）'
  return '当前连接不支持边缓存边播放原画（需 HTTPS 或 localhost），缓存完成后会自动切换为本地播放；也可以选择转码清晰度边看边缓存'
})
</script>

<template>
  <div class="cache-panel card">
    <div class="head">
      <div class="title">
        <AppIcon name="cache" :size="16" />
        <span>离线缓存</span>
        <span v-if="qualityLabel" class="quality">{{ qualityLabel }}</span>
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
      <span>{{ formatPercent(progress) }} · {{ formatBytes(cachedBytes) }} / {{ approximate ? '约 ' : '' }}{{ formatBytes(total) }}</span>
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
      <span>打开视频时自动缓存当前清晰度（从播放位置开始）</span>
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

.quality {
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
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
