<script setup lang="ts">
import type { DirectoryEntry } from '@shared/api'
import AppIcon from '@/components/common/AppIcon.vue'
import { getMediaKey } from '@/services/api'
import { downloadManager } from '@/services/download-manager'
import { formatBytes } from '@/utils/format'

defineProps<{
  items: DirectoryEntry[]
  currentPath: string
}>()

function isCached(entry: DirectoryEntry): boolean {
  return downloadManager.tasks.get(getMediaKey(entry.path))?.status === 'done'
}
</script>

<template>
  <aside class="playlist card">
    <div class="head">
      <span>同目录 · {{ items.length }}</span>
    </div>
    <ol class="list">
      <li v-for="item in items" :key="item.path">
        <RouterLink
          :to="{ name: 'view', query: { path: item.path } }"
          replace
          class="item"
          :class="{ current: item.path === currentPath }"
          :title="item.name"
        >
          <AppIcon :name="item.path === currentPath ? 'play' : item.kind === 'audio' ? 'audio' : 'video'" :size="16" />
          <span class="name ellipsis">{{ item.name }}</span>
          <AppIcon v-if="isCached(item)" name="check" :size="14" class="cached" />
          <span class="size muted">{{ formatBytes(item.size) }}</span>
        </RouterLink>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.playlist {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}

.list {
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.item.current {
  background: rgb(99 102 241 / 15%);
  color: var(--primary-hover);
}

.name {
  flex: 1;
  min-width: 0;
}

.cached {
  color: var(--success);
}

.size {
  flex-shrink: 0;
  font-size: 12px;
}
</style>
