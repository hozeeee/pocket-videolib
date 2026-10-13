<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useServerInfo } from '@/composables/useServerInfo'
import { downloadManager } from '@/services/download-manager'

const { info } = useServerInfo()

const activeDownloads = computed(() => {
  let count = 0
  for (const task of downloadManager.tasks.values()) {
    if (task.status === 'downloading' || task.status === 'queued')
      count++
  }
  return count
})
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <RouterLink to="/" class="brand">
        <span class="logo"><AppIcon name="play" :size="16" /></span>
        <span class="brand-text ellipsis">{{ info?.rootName ?? 'Pocket VideoLib' }}</span>
      </RouterLink>
      <nav class="nav">
        <RouterLink to="/" class="nav-link" exact-active-class="active">
          <AppIcon name="home" />
          <span class="nav-text">媒体库</span>
        </RouterLink>
        <RouterLink to="/cache" class="nav-link" active-class="active">
          <AppIcon name="cache" />
          <span class="nav-text">离线缓存</span>
          <span v-if="activeDownloads" class="badge">{{ activeDownloads }}</span>
        </RouterLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 10;
  height: var(--header-height);
  border-bottom: 1px solid var(--border);
  background: rgb(15 17 21 / 85%);
  backdrop-filter: blur(12px);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 100%;
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 0 var(--page-padding);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-weight: 600;
  font-size: 16px;
}

.logo {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
}

.nav {
  display: flex;
  gap: 4px;
}

.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}

.nav-link:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.nav-link.active {
  color: var(--text);
  background: var(--bg-hover);
}

.badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}

@media (max-width: 520px) {
  .nav-text {
    display: none;
  }
}
</style>
