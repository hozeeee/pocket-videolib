<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { splitPath } from '@/utils/path'

const props = defineProps<{
  path: string
  rootName?: string
  /** 最后一段是否可点击（查看媒体时最后一段是文件名） */
  linkLast?: boolean
}>()

const crumbs = computed(() => {
  const segments = splitPath(props.path)
  return segments.map((name, i) => ({ name, path: segments.slice(0, i + 1).join('/') }))
})
</script>

<template>
  <nav class="breadcrumb" aria-label="breadcrumb">
    <RouterLink :to="{ name: 'browse' }" class="crumb">
      <AppIcon name="home" :size="16" />
      <span class="ellipsis">{{ rootName ?? '根目录' }}</span>
    </RouterLink>
    <template v-for="(crumb, i) in crumbs" :key="crumb.path">
      <span class="sep">/</span>
      <span v-if="i === crumbs.length - 1 && !linkLast" class="crumb current ellipsis">{{ crumb.name }}</span>
      <RouterLink v-else :to="{ name: 'browse', query: { path: crumb.path } }" class="crumb ellipsis">
        {{ crumb.name }}
      </RouterLink>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  min-width: 0;
  font-size: 14px;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

a.crumb:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.current {
  color: var(--text);
  font-weight: 500;
}

.sep {
  color: var(--border);
}
</style>
