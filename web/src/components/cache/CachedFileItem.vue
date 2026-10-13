<script setup lang="ts">
import type { DownloadTask, TaskStatus } from '@/services/download-manager'
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import CacheProgressBar from '@/components/player/CacheProgressBar.vue'
import { formatBytes, formatPercent, formatSpeed } from '@/utils/format'

const props = defineProps<{
  task: DownloadTask
}>()

const emit = defineEmits<{
  start: []
  pause: []
  remove: []
}>()

const STATUS_TEXT: Record<TaskStatus, string> = {
  idle: '未开始',
  queued: '排队中',
  downloading: '缓存中',
  paused: '已暂停',
  done: '已完成',
  error: '失败',
}

const progress = computed(() => props.task.chunkCount > 0 ? props.task.cachedChunks / props.task.chunkCount : 1)
const running = computed(() => props.task.status === 'downloading' || props.task.status === 'queued')
</script>

<template>
  <li class="item card">
    <RouterLink :to="{ name: 'view', query: { path: task.path } }" class="name-link">
      <AppIcon name="video" :size="20" class="icon" />
      <div class="info">
        <div class="name ellipsis" :title="task.path">
          {{ task.name }}
        </div>
        <div class="meta muted">
          <span :class="`status--${task.status}`">{{ STATUS_TEXT[task.status] }}</span>
          · {{ formatPercent(progress) }} · {{ formatBytes(progress * task.size) }} / {{ formatBytes(task.size) }}
          <template v-if="task.status === 'downloading'">
            · {{ formatSpeed(task.speed) }}
          </template>
        </div>
      </div>
    </RouterLink>
    <div class="actions">
      <button v-if="running" class="btn btn-icon" title="暂停" @click="emit('pause')">
        <AppIcon name="pause" :size="16" />
      </button>
      <button v-else-if="task.status !== 'done'" class="btn btn-icon" title="继续" @click="emit('start')">
        <AppIcon name="download" :size="16" />
      </button>
      <button class="btn btn-icon btn-danger" title="删除" @click="emit('remove')">
        <AppIcon name="trash" :size="16" />
      </button>
    </div>
    <CacheProgressBar class="bar" :bitmap="task.bitmap" :version="task.version" />
  </li>
</template>

<style scoped>
.item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 14px;
}

.name-link {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.icon {
  color: var(--primary-hover);
}

.info {
  min-width: 0;
}

.name-link:hover .name {
  color: var(--primary-hover);
}

.meta {
  font-size: 12px;
}

.status--done {
  color: var(--success);
}

.status--error {
  color: var(--danger);
}

.status--downloading {
  color: var(--primary-hover);
}

.actions {
  display: flex;
  gap: 6px;
}

.bar {
  grid-column: 1 / -1;
  height: 4px;
}
</style>
