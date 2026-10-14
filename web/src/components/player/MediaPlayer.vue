<script setup lang="ts">
import type { ErrorData } from 'hls.js'
import type { PlaybackSource } from '@/composables/usePlaybackSource'
import Hls from 'hls.js/light'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cachingLoaderConfig, hlsJsSupported } from '@/services/hls-loader'
import { swActive } from '@/services/sw-client'

export interface SubtitleTrack {
  label: string
  src: string
  srclang?: string
}

const props = defineProps<{
  source: PlaybackSource
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
  /** code 为 MediaError 的错误码（3 解码失败、4 格式不支持） */
  error: [message: string, code?: number]
  /** 播放位置之后已缓冲的秒数 */
  buffer: [ahead: number, playing: boolean]
}>()

const ERROR_MESSAGES: Record<number, string> = {
  1: '播放被中止',
  2: '网络错误，加载失败',
  3: '解码失败，文件可能已损坏',
  4: '浏览器不支持该媒体格式',
}

const media = ref<HTMLMediaElement>()
const RESUME_PREFIX = 'pocket-videolib:resume:'
/** 切换播放源（清晰度 / 网络 → 本地 Blob）时需要恢复的状态 */
let pendingRestore: { time: number, playing: boolean } | undefined
/** 当前播放源加载完成后要跳转到的位置及是否播放 */
let startState = { time: 0, restoring: false, playing: false }
let hls: Hls | undefined
let mediaRecovered = false
/** 当前播放源是否已原地重新加载过 */
let sourceReloaded = false
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

function destroyHls(): void {
  hls?.destroy()
  hls = undefined
}

function onHlsError(_event: unknown, data: ErrorData): void {
  if (!data.fatal)
    return
  // 解码错误先尝试恢复一次（重建 MediaSource）
  if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) {
    mediaRecovered = true
    hls?.recoverMediaError()
    return
  }
  destroyHls()
  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
    const status = data.response?.code ?? 0
    emit('error', status >= 500 ? '服务器转码失败，可尝试其他清晰度' : ERROR_MESSAGES[2], 2)
  }
  else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    emit('error', ERROR_MESSAGES[3], 3)
  }
  else {
    emit('error', `播放出错（${data.details}）`)
  }
}

function createHls(startTime: number): Hls {
  const instance = new Hls({
    // 没有 Service Worker 时由加载器读写本地缓存
    ...(swActive.value ? {} : cachingLoaderConfig),
    startPosition: startTime > 0 ? startTime : -1,
    maxBufferLength: 60,
    maxMaxBufferLength: 120,
    backBufferLength: 60,
    // 分片按需转码，首字节可能较慢
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 30_000,
        maxLoadTimeMs: 120_000,
        timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 5, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      },
    },
  })
  instance.on(Hls.Events.ERROR, onHlsError)
  return instance
}

function load(source: PlaybackSource, reload = false): void {
  const el = media.value
  if (!el)
    return
  destroyHls()
  mediaRecovered = false
  sourceReloaded = reload
  const restore = pendingRestore
  pendingRestore = undefined
  startState = restore
    ? { time: restore.time, restoring: true, playing: restore.playing }
    : { time: readResume(), restoring: false, playing: Boolean(props.autoplay) }

  if (source.type === 'hls' && hlsJsSupported) {
    // iOS 的 ManagedMediaSource 要求关闭远程播放（AirPlay）
    el.disableRemotePlayback = true
    hls = createHls(startState.time)
    hls.loadSource(source.url)
    hls.attachMedia(el)
    return
  }
  el.disableRemotePlayback = false
  if (source.type === 'hls' && el.canPlayType('application/vnd.apple.mpegurl') === '') {
    el.removeAttribute('src')
    emit('error', '当前浏览器不支持转码播放（HLS）', 4)
    return
  }
  el.src = source.url
}

/** 父组件以文件路径作为 key，因此同一实例内 source 变化只可能是播放源切换 */
watch(() => props.source, (source) => {
  const el = media.value
  pendingRestore = el ? { time: el.currentTime, playing: !el.paused } : undefined
  load(source)
})

onMounted(() => load(props.source))

function onLoadedMetadata(): void {
  const el = media.value!
  const { time, restoring, playing } = startState
  // hls.js 已通过 startPosition 从该位置开始加载
  if (!hls && time > 0 && (restoring || time < el.duration - 10))
    el.currentTime = time
  if (playing)
    void el.play().catch(() => {})
}

function getBufferAhead(el: HTMLMediaElement): number {
  const time = el.currentTime
  for (let i = 0; i < el.buffered.length; i++) {
    if (el.buffered.start(i) <= time + 0.5 && el.buffered.end(i) >= time)
      return el.buffered.end(i) - time
  }
  return 0
}

function emitBuffer(): void {
  const el = media.value
  if (el)
    emit('buffer', getBufferAhead(el), !el.paused)
}

function onTimeUpdate(): void {
  const el = media.value!
  emit('progress', el.currentTime, el.duration)
  emitBuffer()
  saveResume()
}

function onSeeked(): void {
  const el = media.value!
  emit('seeked', el.currentTime, el.duration)
}

function onPause(): void {
  saveResume(true)
  emitBuffer()
}

function onError(): void {
  const el = media.value
  // hls.js 的错误由 onHlsError 处理；移除播放源、切换播放源后迟到的错误忽略
  if (!el || hls || !el.getAttribute('src') || !el.error)
    return
  const code = el.error.code
  // Service Worker 在播放中途接管时，前后响应来源不一致会导致播放失败，重新加载一次即可恢复
  if (props.source.type === 'file' && swActive.value && !sourceReloaded) {
    pendingRestore = { time: el.currentTime || startState.time, playing: !el.paused || startState.playing }
    load(props.source, true)
    return
  }
  emit('error', ERROR_MESSAGES[code] || '播放出错', code)
}

onBeforeUnmount(() => {
  saveResume(true)
  destroyHls()
})
</script>

<template>
  <div class="player" :class="`player--${kind}`">
    <component
      :is="kind"
      ref="media"
      controls
      playsinline
      preload="metadata"
      @loadedmetadata="onLoadedMetadata"
      @timeupdate="onTimeUpdate"
      @progress="emitBuffer"
      @waiting="emitBuffer"
      @seeked="onSeeked"
      @pause="onPause"
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
