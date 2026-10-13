<script setup lang="ts">
import type { DirectoryEntry } from '@shared/api'
import type { ViewMode } from './DirectoryToolbar.vue'
import FileCard from './FileCard.vue'

defineProps<{
  entries: DirectoryEntry[]
  viewMode: ViewMode
  getCacheProgress: (entry: DirectoryEntry) => number | undefined
}>()
</script>

<template>
  <div class="file-grid" :class="`file-grid--${viewMode}`">
    <FileCard
      v-for="entry in entries"
      :key="entry.path"
      :entry="entry"
      :view-mode="viewMode"
      :cache-progress="getCacheProgress(entry)"
    />
  </div>
</template>

<style scoped>
.file-grid--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}

.file-grid--list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

@media (max-width: 520px) {
  .file-grid--grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
