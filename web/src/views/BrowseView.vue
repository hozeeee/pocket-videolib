<script setup lang="ts">
import type { DirectoryEntry } from '@shared/api'
import type { ViewMode } from '@/components/browser/DirectoryToolbar.vue'
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import BreadcrumbNav from '@/components/browser/BreadcrumbNav.vue'
import DirectoryToolbar from '@/components/browser/DirectoryToolbar.vue'
import FileGrid from '@/components/browser/FileGrid.vue'
import StatusMessage from '@/components/common/StatusMessage.vue'
import { useDirectory } from '@/composables/useDirectory'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { useServerInfo } from '@/composables/useServerInfo'
import { getMediaKey } from '@/services/api'
import { downloadManager } from '@/services/download-manager'

const route = useRoute()
const { info } = useServerInfo()

const path = computed(() => typeof route.query.path === 'string' ? route.query.path : '')
const { data, loading, error, reload } = useDirectory(path)

const keyword = ref('')
const viewMode = useLocalStorage<ViewMode>('viewMode', 'grid')
const showAll = useLocalStorage('showAllFiles', false)

watch(path, () => {
  keyword.value = ''
})

void downloadManager.loadAll()

const VISIBLE_KINDS = new Set(['video', 'audio', 'image'])

const entries = computed(() => {
  const list = data.value?.entries ?? []
  const word = keyword.value.trim().toLowerCase()
  return list.filter((entry) => {
    if (!showAll.value && entry.type === 'file' && !VISIBLE_KINDS.has(entry.kind ?? 'other'))
      return false
    return !word || entry.name.toLowerCase().includes(word)
  })
})

function getCacheProgress(entry: DirectoryEntry): number | undefined {
  if (entry.type !== 'file')
    return undefined
  const task = downloadManager.tasks.get(getMediaKey(entry.path))
  if (!task || task.chunkCount === 0 || (task.cachedChunks === 0 && task.status !== 'downloading'))
    return undefined
  return task.cachedChunks / task.chunkCount
}
</script>

<template>
  <section class="browse">
    <BreadcrumbNav :path="path" :root-name="info?.rootName" />
    <DirectoryToolbar
      v-model:keyword="keyword"
      v-model:view-mode="viewMode"
      v-model:show-all="showAll"
      :loading="loading"
      @refresh="reload"
    />

    <StatusMessage v-if="error" type="error" title="无法打开目录" :description="error" />
    <StatusMessage v-else-if="loading && !data" type="loading" title="加载中…" />
    <StatusMessage
      v-else-if="entries.length === 0"
      title="这里什么都没有"
      :description="keyword ? '没有匹配的文件' : showAll ? undefined : '没有可播放的媒体文件，可勾选「全部文件」查看'"
    />
    <FileGrid v-else :entries="entries" :view-mode="viewMode" :get-cache-progress="getCacheProgress" />
  </section>
</template>

<style scoped>
.browse {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
