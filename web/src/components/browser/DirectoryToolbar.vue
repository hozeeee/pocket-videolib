<script setup lang="ts">
import AppIcon from '@/components/common/AppIcon.vue'

export type ViewMode = 'grid' | 'list'

defineProps<{
  loading?: boolean
}>()

defineEmits<{
  refresh: []
}>()

const keyword = defineModel<string>('keyword', { required: true })
const viewMode = defineModel<ViewMode>('viewMode', { required: true })
const showAll = defineModel<boolean>('showAll', { required: true })
</script>

<template>
  <div class="toolbar">
    <label class="search">
      <AppIcon name="search" :size="16" class="muted" />
      <input v-model="keyword" type="search" placeholder="筛选当前目录…">
    </label>
    <label class="toggle" title="显示非媒体文件">
      <input v-model="showAll" type="checkbox">
      <span>全部文件</span>
    </label>
    <div class="group">
      <button class="btn btn-icon" :class="{ active: viewMode === 'grid' }" title="网格视图" @click="viewMode = 'grid'">
        <AppIcon name="grid" :size="16" />
      </button>
      <button class="btn btn-icon" :class="{ active: viewMode === 'list' }" title="列表视图" @click="viewMode = 'list'">
        <AppIcon name="list" :size="16" />
      </button>
      <button class="btn btn-icon" title="刷新" :disabled="loading" @click="$emit('refresh')">
        <AppIcon name="refresh" :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
}

.search:focus-within {
  border-color: var(--primary);
}

.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.group {
  display: flex;
  gap: 4px;
}

.btn.active {
  border-color: var(--primary);
  color: var(--primary-hover);
}
</style>
