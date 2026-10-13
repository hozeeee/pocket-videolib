<script setup lang="ts">
import { computed } from 'vue'
import { formatBytes, formatPercent } from '@/utils/format'

const props = defineProps<{
  /** 缓存的媒体总字节数 */
  cachedBytes: number
  fileCount: number
  usage?: number
  quota?: number
  persisted: boolean
  streaming: boolean
}>()

const usageRatio = computed(() => props.usage !== undefined && props.quota ? props.usage / props.quota : undefined)
</script>

<template>
  <div class="summary card">
    <div class="stat">
      <span class="value">{{ fileCount }}</span>
      <span class="label muted">缓存文件</span>
    </div>
    <div class="stat">
      <span class="value">{{ formatBytes(cachedBytes) }}</span>
      <span class="label muted">已缓存数据</span>
    </div>
    <div v-if="usageRatio !== undefined" class="stat stat--wide">
      <span class="value">{{ formatBytes(usage ?? 0) }} / {{ formatBytes(quota ?? 0) }}</span>
      <span class="label muted">浏览器存储用量 {{ formatPercent(usageRatio) }}{{ persisted ? ' · 已持久化' : '' }}</span>
      <div class="meter">
        <span :style="{ width: `${usageRatio * 100}%` }" />
      </div>
    </div>
    <p class="note muted">
      缓存保存在当前浏览器的 IndexedDB 中，
      {{ streaming
        ? '已启用 Service Worker：播放时优先读取本地缓存，离线也能观看已缓存的部分。'
        : '当前连接未启用 Service Worker（需 HTTPS 或 localhost），完整缓存后才会切换为本地播放。' }}
    </p>
  </div>
</template>

<style scoped>
.summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  padding: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat--wide {
  flex: 1;
  min-width: 220px;
}

.value {
  font-size: 18px;
  font-weight: 600;
}

.label {
  font-size: 12px;
}

.meter {
  height: 4px;
  margin-top: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--bg-hover);
}

.meter span {
  display: block;
  height: 100%;
  background: var(--primary);
}

.note {
  flex-basis: 100%;
  margin: 0;
  font-size: 12px;
}
</style>
