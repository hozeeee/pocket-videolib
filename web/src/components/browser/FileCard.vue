<script setup lang="ts">
import type { DirectoryEntry, MediaKind } from '@shared/api'
import type { RouteLocationRaw } from 'vue-router'
import type { ViewMode } from './DirectoryToolbar.vue'
import type { IconName } from '@/components/common/AppIcon.vue'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'
import { getDownloadUrl } from '@/services/api'
import { formatBytes, formatDate, formatPercent } from '@/utils/format'

const props = defineProps<{
  entry: DirectoryEntry
  viewMode: ViewMode
  /** 缓存进度 0~1，未缓存时为 undefined */
  cacheProgress?: number
}>()

const ICONS: Record<MediaKind, IconName> = {
  video: 'video',
  audio: 'audio',
  image: 'image',
  subtitle: 'subtitle',
  other: 'file',
}

const icon = computed<IconName>(() => props.entry.type === 'directory' ? 'folder' : ICONS[props.entry.kind ?? 'other'])

const isViewable = computed(() => props.entry.kind === 'video' || props.entry.kind === 'audio' || props.entry.kind === 'image')

const to = computed<RouteLocationRaw | undefined>(() => {
  if (props.entry.type === 'directory')
    return { name: 'browse', query: { path: props.entry.path } }
  if (isViewable.value)
    return { name: 'view', query: { path: props.entry.path } }
  return undefined
})

const meta = computed(() => props.entry.type === 'directory'
  ? formatDate(props.entry.mtime)
  : `${formatBytes(props.entry.size)} · ${formatDate(props.entry.mtime)}`)
</script>

<template>
  <component
    :is="to ? RouterLink : 'a'"
    :to="to"
    :href="to ? undefined : getDownloadUrl(entry.path)"
    class="file-card"
    :class="[`file-card--${viewMode}`, `kind-${entry.type === 'directory' ? 'folder' : entry.kind}`]"
    :title="entry.name"
  >
    <div class="thumb">
      <AppIcon :name="icon" :size="viewMode === 'grid' ? 40 : 22" />
      <span v-if="cacheProgress !== undefined" class="cache-badge" :class="{ done: cacheProgress >= 1 }">
        <AppIcon :name="cacheProgress >= 1 ? 'check' : 'cache'" :size="12" />
        <template v-if="cacheProgress < 1">{{ formatPercent(cacheProgress) }}</template>
      </span>
    </div>
    <div class="info">
      <div class="name">
        {{ entry.name }}
      </div>
      <div class="meta muted ellipsis">
        {{ meta }}
      </div>
    </div>
  </component>
</template>

<style scoped>
.file-card {
  display: flex;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  transition:
    background 0.15s,
    border-color 0.15s;
}

.file-card:hover {
  border-color: var(--border);
  background: var(--bg-hover);
}

.thumb {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.kind-folder .thumb {
  color: #eab308;
}
.kind-video .thumb {
  color: var(--primary-hover);
}
.kind-audio .thumb {
  color: #ec4899;
}
.kind-image .thumb {
  color: #14b8a6;
}

.name {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-all;
}

.meta {
  font-size: 12px;
}

.cache-badge {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 6px;
  border-radius: 9px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
}

.cache-badge.done {
  background: var(--success);
}

/* 网格视图 */
.file-card--grid {
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.file-card--grid .thumb {
  aspect-ratio: 16 / 10;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
}

.file-card--grid .cache-badge {
  top: 6px;
  right: 6px;
}

/* 列表视图 */
.file-card--list {
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
}

.file-card--list .thumb {
  width: 36px;
  height: 36px;
}

.file-card--list .info {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.file-card--list .name {
  -webkit-line-clamp: 1;
}

.file-card--list .meta {
  flex-shrink: 0;
}

.file-card--list .cache-badge {
  right: -8px;
  bottom: -4px;
  padding: 1px 4px;
}

@media (max-width: 640px) {
  .file-card--list .info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
  }
}
</style>
