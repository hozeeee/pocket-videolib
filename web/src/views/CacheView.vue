<script setup lang="ts">
import type { DownloadTask } from '@/services/download-manager'
import { computed, onMounted, ref } from 'vue'
import CachedFileItem from '@/components/cache/CachedFileItem.vue'
import StorageSummary from '@/components/cache/StorageSummary.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import StatusMessage from '@/components/common/StatusMessage.vue'
import { useStorageEstimate } from '@/composables/useStorageEstimate'
import { downloadManager } from '@/services/download-manager'
import { clearAll } from '@/services/media-cache'
import { swActive } from '@/services/sw-client'

const loading = ref(true)
const { usage, quota, persisted, refresh } = useStorageEstimate()

onMounted(async () => {
  await downloadManager.loadAll().catch(() => {})
  loading.value = false
})

const tasks = computed(() => [...downloadManager.tasks.values()]
  .filter(t => t.cachedChunks > 0 || t.status !== 'idle'))

const cachedBytes = computed(() => tasks.value.reduce((sum, t) => sum + t.cachedBytes, 0))

async function remove(task: DownloadTask): Promise<void> {
  await downloadManager.remove(task.key)
  await refresh()
}

async function removeAll(): Promise<void> {
  // eslint-disable-next-line no-alert
  if (!window.confirm('确定删除全部离线缓存吗？'))
    return
  downloadManager.reset()
  await clearAll()
  await refresh()
}
</script>

<template>
  <section class="cache-view">
    <div class="head">
      <h1>离线缓存</h1>
      <button class="btn btn-danger" :disabled="tasks.length === 0" @click="removeAll">
        <AppIcon name="trash" :size="16" />清空全部
      </button>
    </div>

    <StorageSummary
      :cached-bytes="cachedBytes"
      :file-count="tasks.length"
      :usage="usage"
      :quota="quota"
      :persisted="persisted"
      :streaming="swActive"
    />

    <StatusMessage v-if="loading" type="loading" title="加载中…" />
    <StatusMessage
      v-else-if="tasks.length === 0"
      icon="cache"
      title="还没有缓存任何视频"
      description="在播放页点击「开始缓存」，即可把当前清晰度的视频保存到本地，网络不佳时也能流畅观看"
    />
    <ul v-else class="list">
      <CachedFileItem
        v-for="task in tasks"
        :key="task.key"
        :task="task"
        @start="downloadManager.resume(task.key)"
        @pause="downloadManager.pause(task.key)"
        @remove="remove(task)"
      />
    </ul>
  </section>
</template>

<style scoped>
.cache-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h1 {
  margin: 0;
  font-size: 20px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
