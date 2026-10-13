<script setup lang="ts">
import type { DirectoryEntry } from '@shared/api'
import type { SubtitleTrack } from '@/components/player/MediaPlayer.vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BreadcrumbNav from '@/components/browser/BreadcrumbNav.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import StatusMessage from '@/components/common/StatusMessage.vue'
import CachePanel from '@/components/player/CachePanel.vue'
import ImageViewer from '@/components/player/ImageViewer.vue'
import MediaPlayer from '@/components/player/MediaPlayer.vue'
import PlaylistPanel from '@/components/player/PlaylistPanel.vue'
import { useDirectory } from '@/composables/useDirectory'
import { useDownloadTask } from '@/composables/useDownloadTask'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { usePlaybackSource } from '@/composables/usePlaybackSource'
import { useServerInfo } from '@/composables/useServerInfo'
import { getDownloadUrl, getSubtitleUrl } from '@/services/api'
import { swActive } from '@/services/sw-client'
import { formatBytes } from '@/utils/format'
import { parentPath, stripExtension } from '@/utils/path'

const route = useRoute()
const router = useRouter()
const { info } = useServerInfo()

const path = computed(() => typeof route.query.path === 'string' ? route.query.path : '')
const { data, loading, error } = useDirectory(() => parentPath(path.value))

const entry = computed(() => data.value?.entries.find(e => e.path === path.value))
const kind = computed(() => entry.value?.kind)
const isPlayable = computed(() => kind.value === 'video' || kind.value === 'audio')
const size = computed(() => entry.value?.size ?? 0)

const siblings = computed(() => (data.value?.entries ?? []).filter(e => e.type === 'file' && e.kind === kind.value))
const nextEntry = computed(() => {
  const index = siblings.value.findIndex(e => e.path === path.value)
  return index >= 0 ? siblings.value[index + 1] : undefined
})

/** 同名字幕：`movie.mp4` 匹配 `movie.srt`、`movie.zh.vtt` 等 */
const subtitles = computed<SubtitleTrack[]>(() => {
  if (!entry.value)
    return []
  const base = stripExtension(entry.value.name)
  return (data.value?.entries ?? [])
    .filter((e: DirectoryEntry) => e.kind === 'subtitle' && stripExtension(e.name).startsWith(base))
    .map((e) => {
      const lang = stripExtension(e.name).slice(base.length).replace(/^[.\-_ ]+/, '')
      return { label: lang || e.name, srclang: lang || undefined, src: getSubtitleUrl(e.path) }
    })
})

// 缓存与播放源
const cache = useDownloadTask(path, size)
const { src, fromLocal } = usePlaybackSource(path, cache.isDone)
const autoCache = useLocalStorage('autoCache', true)
const playhead = ref<number>()
const playError = ref<string>()

watch([entry, cache.task], ([current, task]) => {
  if (!current || !isPlayable.value || !autoCache.value)
    return
  if (!task || task.status === 'idle')
    cache.start()
}, { immediate: true })

watch(path, () => {
  playhead.value = undefined
  playError.value = undefined
})

function toOffset(time: number, duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? (time / duration) * size.value : 0
}

function onProgress(time: number, duration: number): void {
  if (Number.isFinite(duration) && duration > 0)
    playhead.value = time / duration
}

/** 拖动进度条后，优先缓存新位置之后的内容（按码率均匀估算字节偏移） */
function onSeeked(time: number, duration: number): void {
  cache.prioritize(toOffset(time, duration))
}

function startCache(): void {
  cache.start(playhead.value ? playhead.value * size.value : 0)
}

function playNext(): void {
  if (nextEntry.value)
    void router.replace({ name: 'view', query: { path: nextEntry.value.path } })
}
</script>

<template>
  <section class="media-view">
    <BreadcrumbNav :path="path" :root-name="info?.rootName" />

    <StatusMessage v-if="error" type="error" title="无法加载文件" :description="error" />
    <StatusMessage v-else-if="loading && !data" type="loading" title="加载中…" />
    <StatusMessage v-else-if="!entry" type="error" title="文件不存在" :description="path" />

    <ImageViewer v-else-if="kind === 'image'" :entry="entry" :siblings="siblings" />

    <div v-else-if="isPlayable" class="layout">
      <div class="main">
        <MediaPlayer
          v-if="src"
          :key="path"
          :src="src"
          :kind="kind === 'audio' ? 'audio' : 'video'"
          :resume-key="path"
          :subtitles="subtitles"
          autoplay
          @progress="onProgress"
          @seeked="onSeeked"
          @ended="playNext"
          @error="playError = $event"
        />

        <div class="title-row">
          <div class="title-info">
            <h1 class="title">
              {{ entry.name }}
            </h1>
            <span class="muted">{{ formatBytes(entry.size) }}</span>
          </div>
          <div class="title-actions">
            <button v-if="nextEntry" class="btn" @click="playNext">
              <AppIcon name="next" :size="16" />下一个
            </button>
            <a class="btn" :href="getDownloadUrl(entry.path)">
              <AppIcon name="download" :size="16" />下载
            </a>
          </div>
        </div>

        <p v-if="playError" class="play-error">
          <AppIcon name="alert" :size="16" />{{ playError }}
        </p>

        <CachePanel
          v-model:auto-cache="autoCache"
          :task="cache.task.value"
          :size="entry.size"
          :playhead="playhead"
          :streaming="swActive"
          :from-local="fromLocal"
          @start="startCache"
          @pause="cache.pause"
          @remove="cache.remove"
        />
      </div>

      <PlaylistPanel v-if="siblings.length > 1" class="side" :items="siblings" :current-path="path" />
    </div>

    <StatusMessage v-else title="该文件无法预览" icon="file">
      <a class="btn btn-primary" :href="getDownloadUrl(entry.path)">
        <AppIcon name="download" :size="16" />下载文件
      </a>
    </StatusMessage>
  </section>
</template>

<style scoped>
.media-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
  gap: 16px;
}

.main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.side {
  position: sticky;
  top: calc(var(--header-height) + 16px);
  max-height: calc(100vh - var(--header-height) - 32px);
}

.title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title-info {
  min-width: 0;
}

.title {
  margin: 0 0 2px;
  font-size: 18px;
  font-weight: 600;
  word-break: break-all;
}

.title-actions {
  display: flex;
  gap: 8px;
}

.play-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--warning);
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    position: static;
    max-height: 420px;
  }
}
</style>
