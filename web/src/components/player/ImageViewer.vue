<script setup lang="ts">
import type { DirectoryEntry } from '@shared/api'
import { toMediaUrl } from '@shared/api'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{
  entry: DirectoryEntry
  /** 同目录下的全部图片，用于前后切换 */
  siblings: DirectoryEntry[]
}>()

const router = useRouter()

const index = computed(() => props.siblings.findIndex(e => e.path === props.entry.path))
const prev = computed(() => index.value > 0 ? props.siblings[index.value - 1] : undefined)
const next = computed(() => index.value >= 0 && index.value < props.siblings.length - 1 ? props.siblings[index.value + 1] : undefined)

function go(target?: DirectoryEntry): void {
  if (target)
    void router.replace({ name: 'view', query: { path: target.path } })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft')
    go(prev.value)
  else if (event.key === 'ArrowRight')
    go(next.value)
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="viewer">
    <img :src="toMediaUrl(entry.path)" :alt="entry.name">
    <button v-if="prev" class="nav nav--prev btn btn-icon" title="上一张 (←)" @click="go(prev)">
      <AppIcon name="prev" />
    </button>
    <button v-if="next" class="nav nav--next btn btn-icon" title="下一张 (→)" @click="go(next)">
      <AppIcon name="next" />
    </button>
    <span v-if="index >= 0" class="counter">{{ index + 1 }} / {{ siblings.length }}</span>
  </div>
</template>

<style scoped>
.viewer {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 300px;
  overflow: hidden;
  border-radius: var(--radius);
  background: #000;
}

img {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - var(--header-height) - 120px);
  object-fit: contain;
}

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgb(0 0 0 / 50%);
  border-color: transparent;
}

.nav--prev {
  left: 12px;
}

.nav--next {
  right: 12px;
}

.counter {
  position: absolute;
  bottom: 10px;
  right: 12px;
  padding: 2px 8px;
  border-radius: 9px;
  background: rgb(0 0 0 / 60%);
  font-size: 12px;
}
</style>
