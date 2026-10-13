<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  bitmap: Uint8Array
  /** 位图变化计数，用于触发重新计算 */
  version: number
  /** 当前播放位置比例 0~1 */
  playhead?: number
}>()

/** 将连续的已缓存分片合并为区间，按百分比定位 */
const segments = computed(() => {
  void props.version
  const total = props.bitmap.length
  const result: Array<{ left: number, width: number }> = []
  let start = -1
  for (let i = 0; i <= total; i++) {
    const cached = i < total && props.bitmap[i] === 1
    if (cached && start < 0)
      start = i
    if (!cached && start >= 0) {
      result.push({ left: (start / total) * 100, width: ((i - start) / total) * 100 })
      start = -1
    }
  }
  return result
})
</script>

<template>
  <div class="cache-bar" role="progressbar">
    <span
      v-for="(seg, i) in segments"
      :key="i"
      class="segment"
      :style="{ left: `${seg.left}%`, width: `${seg.width}%` }"
    />
    <span v-if="playhead !== undefined" class="playhead" :style="{ left: `${playhead * 100}%` }" />
  </div>
</template>

<style scoped>
.cache-bar {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--bg-hover);
}

.segment {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 1px;
  background: var(--primary);
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: #fff;
  box-shadow: 0 0 4px rgb(0 0 0 / 60%);
}
</style>
