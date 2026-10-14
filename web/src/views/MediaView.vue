<script setup lang="ts">
import type { DirectoryEntry, MediaInfo } from '@shared/api'
import type { SubtitleTrack } from '@/components/player/MediaPlayer.vue'
import type { QualityOption } from '@/components/player/QualitySelector.vue'
import type { CacheTarget } from '@/services/download-manager'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BreadcrumbNav from '@/components/browser/BreadcrumbNav.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import StatusMessage from '@/components/common/StatusMessage.vue'
import CachePanel from '@/components/player/CachePanel.vue'
import ImageViewer from '@/components/player/ImageViewer.vue'
import MediaPlayer from '@/components/player/MediaPlayer.vue'
import PlaylistPanel from '@/components/player/PlaylistPanel.vue'
import QualitySelector from '@/components/player/QualitySelector.vue'
import { useDirectory } from '@/composables/useDirectory'
import { useDownloadTask } from '@/composables/useDownloadTask'
import { useLocalStorage } from '@/composables/useLocalStorage'
import { usePlaybackSource } from '@/composables/usePlaybackSource'
import { useServerInfo } from '@/composables/useServerInfo'
import { fetchMediaInfo, getDownloadUrl, getSubtitleUrl } from '@/services/api'
import { downloadManager } from '@/services/download-manager'
import { hlsJsSupported } from '@/services/hls-loader'
import { swActive } from '@/services/sw-client'
import { formatBytes } from '@/utils/format'
import { parentPath, stripExtension } from '@/utils/path'
import { getQualityLabel, getSourceSupport, guessVideoMime, resolveQuality, SOURCE_QUALITY } from '@/utils/quality'

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

// 清晰度：等媒体信息与本地缓存状态都就绪后确定，之后只在用户选择或原画无法播放时改变
const mediaInfo = shallowRef<MediaInfo>()
const infoReady = ref(false)
const cacheReady = ref(false)
const preferredQuality = useLocalStorage('quality', SOURCE_QUALITY)
const quality = ref<string>()
/** 未按偏好、自动切换到了转码清晰度 */
const autoSwitched = ref(false)
const sourceFailed = ref(false)
const playError = ref<string>()
let infoController: AbortController | undefined

void downloadManager.loadAll().catch(() => {}).finally(() => {
  cacheReady.value = true
})

watch([path, kind], async ([p, k]) => {
  infoController?.abort()
  mediaInfo.value = undefined
  infoReady.value = k === 'audio'
  if (k !== 'video')
    return
  const controller = infoController = new AbortController()
  // 失败（离线、旧版服务端）时只提供原画与已缓存的清晰度
  mediaInfo.value = await fetchMediaInfo(p, controller.signal).catch(() => undefined)
  if (!controller.signal.aborted)
    infoReady.value = true
}, { immediate: true })

const levels = computed(() => mediaInfo.value?.levels ?? [])
const sourceSupport = computed(() => entry.value
  ? getSourceSupport(mediaInfo.value, guessVideoMime(entry.value.name), type => document.createElement('video').canPlayType(type))
  : 'unknown')
const cachedTasks = computed(() => downloadManager.getByPath(path.value))
const cachedQualities = computed(() => new Set(cachedTasks.value
  .filter(task => task.status === 'done')
  .map(task => task.level ?? SOURCE_QUALITY)))

/** 初始清晰度：优先使用已完整缓存的清晰度（离线可看、不耗流量），否则按偏好 */
function pickInitialQuality(): void {
  const sourcePlayable = sourceSupport.value !== 'no'
  const cached = [...cachedQualities.value].filter(id => id !== SOURCE_QUALITY || sourcePlayable)
  if (cached.length > 0) {
    quality.value = cached.includes(preferredQuality.value) ? preferredQuality.value : cached[0]
    return
  }
  const resolved = resolveQuality(preferredQuality.value, levels.value, sourcePlayable)
  quality.value = resolved.quality
  autoSwitched.value = resolved.auto
}

watch([infoReady, cacheReady], ([info, cacheLoaded]) => {
  if (info && cacheLoaded && !quality.value)
    pickInitialQuality()
}, { immediate: true })

watch(path, () => {
  quality.value = undefined
  autoSwitched.value = false
  sourceFailed.value = false
})

function selectQuality(id: string): void {
  quality.value = id
  preferredQuality.value = id
  autoSwitched.value = false
  playError.value = undefined
  if (id === SOURCE_QUALITY)
    sourceFailed.value = false
}

const qualityOptions = computed<QualityOption[]>(() => {
  const ids = [SOURCE_QUALITY, ...levels.value.map(level => level.id)]
  for (const id of [...cachedQualities.value, quality.value]) {
    if (id && !ids.includes(id))
      ids.push(id)
  }
  return ids.map(id => ({
    id,
    label: getQualityLabel(id),
    note: cachedQualities.value.has(id)
      ? '已缓存'
      : id === SOURCE_QUALITY && (sourceFailed.value || sourceSupport.value === 'no') ? '可能无法播放' : undefined,
  }))
})

const autoHint = computed(() => {
  if (!autoSwitched.value || !quality.value)
    return ''
  const codec = sourceSupport.value === 'no' && mediaInfo.value?.videoCodec ? `（${mediaInfo.value.videoCodec.toUpperCase()} 编码）` : ''
  return `当前浏览器无法直接播放原画${codec}，已自动切换为 ${getQualityLabel(quality.value)} 转码播放`
})

// 缓存与播放源：缓存的是当前清晰度，播放与缓存共用同一份数据
const cacheTarget = computed<CacheTarget | undefined>(() => {
  if (!entry.value || !isPlayable.value || !quality.value)
    return undefined
  if (quality.value === SOURCE_QUALITY)
    return { type: 'file', path: path.value, size: size.value }
  const level = levels.value.find(l => l.id === quality.value)
  const duration = mediaInfo.value?.duration
  return {
    type: 'hls',
    path: path.value,
    level: quality.value,
    sizeHint: level && duration ? Math.round(level.bandwidth * duration / 8) : undefined,
  }
})
const cache = useDownloadTask(cacheTarget)
const { source, fromLocal, fallbackToNetwork } = usePlaybackSource(path, quality, () => cache.isDone.value)
const autoCache = useLocalStorage('autoCache', true)
const playhead = ref<number>()
/** 当前缓存任务是否已按播放位置调整过下载顺序 */
let positioned = false

/** 转码分片由 hls.js 加载器或 SW 读穿缓存；原画只有 SW 接管时才能边缓存边播放 */
const streaming = computed(() => quality.value === SOURCE_QUALITY ? swActive.value : swActive.value || hlsJsSupported)

watch([cacheTarget, cache.task], ([target, task]) => {
  if (!target || !autoCache.value)
    return
  if (!task || task.status === 'idle')
    cache.start(playhead.value ?? 0)
}, { immediate: true })

// 切换清晰度后暂停同一文件其他清晰度的缓存，把带宽留给当前清晰度
watch(cache.key, (_key, oldKey) => {
  positioned = false
  if (oldKey && downloadManager.get(oldKey)?.path === path.value)
    downloadManager.pause(oldKey)
})

watch(path, () => {
  playhead.value = undefined
  playError.value = undefined
  downloadManager.setYield(false)
})

watch(source, () => {
  playError.value = undefined
})

onBeforeUnmount(() => downloadManager.setYield(false))

function onProgress(time: number, duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0)
    return
  playhead.value = time / duration
  // 从上次的播放位置继续观看时，优先缓存该位置之后的内容
  if (!positioned && cache.task.value) {
    positioned = true
    cache.prioritize(playhead.value)
  }
}

/** 拖动进度条后，优先缓存新位置之后的内容（原画按码率均匀估算字节偏移） */
function onSeeked(time: number, duration: number): void {
  if (Number.isFinite(duration) && duration > 0)
    cache.prioritize(time / duration)
}

/** 播放缓冲不足时让下载器暂停发起新请求，缓冲充足或暂停播放后恢复 */
function onBuffer(ahead: number, playing: boolean): void {
  if (!playing || ahead > 20)
    downloadManager.setYield(false)
  else if (ahead < 8)
    downloadManager.setYield(true)
}

function onPlayError(message: string, code?: number): void {
  // 本地 Blob 播放失败（缓存损坏等）时改为网络播放
  if (fallbackToNetwork())
    return
  const unsupported = code === 3 || code === 4
  if (quality.value === SOURCE_QUALITY && unsupported && levels.value.length > 0) {
    sourceFailed.value = true
    quality.value = resolveQuality(SOURCE_QUALITY, levels.value, false).quality
    autoSwitched.value = true
    return
  }
  playError.value = quality.value === SOURCE_QUALITY && unsupported
    ? `${message}${infoReady.value && !mediaInfo.value?.levels.length ? '，服务器未启用转码（需安装 ffmpeg），可下载后用本地播放器打开' : ''}`
    : message
}

function startCache(): void {
  cache.start(playhead.value ?? 0)
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
          v-if="source"
          :key="path"
          :source="source"
          :kind="kind === 'audio' ? 'audio' : 'video'"
          :resume-key="path"
          :subtitles="subtitles"
          autoplay
          @progress="onProgress"
          @seeked="onSeeked"
          @buffer="onBuffer"
          @ended="playNext"
          @error="onPlayError"
        />
        <div v-else class="player-placeholder" :class="{ 'player-placeholder--audio': kind === 'audio' }">
          <StatusMessage type="loading" title="正在准备播放…" />
        </div>

        <div class="title-row">
          <div class="title-info">
            <h1 class="title">
              {{ entry.name }}
            </h1>
            <span class="muted">
              {{ formatBytes(entry.size) }}
              <template v-if="mediaInfo?.width && mediaInfo.height"> · {{ mediaInfo.width }}×{{ mediaInfo.height }}</template>
              <template v-if="mediaInfo?.videoCodec"> · {{ mediaInfo.videoCodec.toUpperCase() }}</template>
            </span>
          </div>
          <div class="title-actions">
            <QualitySelector
              v-if="kind === 'video' && quality && qualityOptions.length > 1"
              :model-value="quality"
              :options="qualityOptions"
              @update:model-value="selectQuality"
            />
            <button v-if="nextEntry" class="btn" @click="playNext">
              <AppIcon name="next" :size="16" />下一个
            </button>
            <a class="btn" :href="getDownloadUrl(entry.path)">
              <AppIcon name="download" :size="16" />下载
            </a>
          </div>
        </div>

        <p v-if="autoHint" class="play-notice muted">
          {{ autoHint }}
        </p>
        <p v-if="playError" class="play-error">
          <AppIcon name="alert" :size="16" />{{ playError }}
        </p>

        <CachePanel
          v-model:auto-cache="autoCache"
          :task="cache.task.value"
          :size="cacheTarget?.type === 'hls' ? cacheTarget.sizeHint ?? 0 : entry.size"
          :quality-label="quality ? getQualityLabel(quality) : undefined"
          :transcoded="cacheTarget?.type === 'hls'"
          :playhead="playhead"
          :streaming="streaming"
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
  flex-wrap: wrap;
  gap: 8px;
}

.player-placeholder {
  display: grid;
  place-items: center;
  aspect-ratio: 16 / 9;
  max-height: calc(100vh - var(--header-height) - 120px);
  border-radius: var(--radius);
  background: #000;
}

.player-placeholder--audio {
  aspect-ratio: auto;
  min-height: 120px;
  background: var(--bg-elevated);
}

.play-notice {
  margin: 0;
  font-size: 13px;
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
