<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

export interface SubtitleTrack {
  label: string
  src: string
  srclang?: string
}

const props = defineProps<{
  src: string
  kind: 'video' | 'audio'
  /** 用于记忆播放进度的键 */
  resumeKey: string
  subtitles?: SubtitleTrack[]
  autoplay?: boolean
}>()

const emit = defineEmits<{
  progress: [currentTime: number, duration: number]
  seeked: [currentTime: number, duration: number]
  ended: []
  error: [message: string]
}>()

const media = ref<HTMLMediaElement>()
const RESUME_PREFIX = 'pocket-videolib:resume:'
/** 切换播放源（网络 → 本地 Blob）时需要恢复的状态 */
let pendingRestore: { time: number, playing: boolean } | undefined
let lastSavedAt = 0

function readResume(): number {
  return Number(localStorage.getItem(RESUME_PREFIX + props.resumeKey)) || 0
}

function saveResume(force = false): void {
  const el = media.value
  if (!el || !Number.isFinite(el.duration))
    return
  const now = Date.now()
  if (!force && now - lastSavedAt < 3000)
    return
  lastSavedAt = now
  // 接近结尾时视为看完，清除进度
  if (el.duration - el.currentTime < 10)
    localStorage.removeItem(RESUME_PREFIX + props.resumeKey)
  else
    localStorage.setItem(RESUME_PREFIX + props.resumeKey, String(Math.floor(el.currentTime)))
}

/** 父组件以文件路径作为 key，因此同一实例内 src 变化只可能是播放源切换 */
watch(() => props.src, (_src, oldSrc) => {
  const el = media.value
  pendingRestore = el && oldSrc ? { time: el.currentTime, playing: !el.paused } : undefined
}, { flush: 'pre' })

function onLoadedMetadata(): void {
  const el = media.value!
  if (pendingRestore) {
    el.currentTime = pendingRestore.time
    if (pendingRestore.playing)
      void el.play().catch(() => {})
    pendingRestore = undefined
    return
  }
  const resume = readResume()
  if (resume > 0 && resume < el.duration - 10)
    el.currentTime = resume
  if (props.autoplay)
    void el.play().catch(() => {})
}

function onTimeUpdate(): void {
  const el = media.value!
  emit('progress', el.currentTime, el.duration)
  saveResume()
}

function onSeeked(): void {
  const el = media.value!
  emit('seeked', el.currentTime, el.duration)
}

function onError(): void {
  const code = media.value?.error?.code
  const messages: Record<number, string> = {
    1: '播放被中止',
    2: '网络错误，加载失败',
    3: '解码失败，文件可能已损坏',
    4: '浏览器不支持该媒体格式，可尝试下载后用本地播放器打开',
  }
  emit('error', (code && messages[code]) || '播放出错')
}

onBeforeUnmount(() => saveResume(true))
</script>

<template>
  <div class="player" :class="`player--${kind}`">
    <component
      :is="kind"
      ref="media"
      :src="src"
      controls
      playsinline
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @seeked="onSeeked"
      @pause="saveResume(true)"
      @ended="emit('ended')"
      @error="onError"
    >
      <track
        v-for="(track, i) in subtitles"
        :key="track.src"
        kind="subtitles"
        :label="track.label"
        :srclang="track.srclang"
        :src="track.src"
        :default="i === 0"
      >
    </component>
  </div>
</template>

<style scoped>
.player {
  overflow: hidden;
  border-radius: var(--radius);
  background: #000;
}

.player video {
  display: block;
  width: 100%;
  max-height: calc(100vh - var(--header-height) - 120px);
  aspect-ratio: 16 / 9;
  background: #000;
}

.player--audio {
  padding: 32px 16px;
  background: var(--bg-elevated);
}

.player audio {
  display: block;
  width: 100%;
}
</style>
