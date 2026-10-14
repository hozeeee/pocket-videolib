import { spawn } from 'node:child_process'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface CommandOptions {
  /** 超时后强制结束进程（毫秒） */
  timeout?: number
  signal?: AbortSignal
}

/** 执行命令并收集输出；进程无法启动（如命令不存在）时 reject */
export function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal: options.signal })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))

    const timer = options.timeout ? setTimeout(() => child.kill('SIGKILL'), options.timeout) : undefined
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') })
    })
  })
}

export type FfmpegStatus
  = | { available: true, version: string }
    | { available: false, reason: string }

/** 检测 ffmpeg（需带 libx264 编码器）与 ffprobe 是否可用 */
export async function detectFfmpeg(ffmpeg: string, ffprobe: string): Promise<FfmpegStatus> {
  let version: string
  try {
    const result = await runCommand(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 10_000 })
    if (result.code !== 0)
      return { available: false, reason: `${ffmpeg} exited with code ${result.code}` }
    if (!/\blibx264\b/.test(result.stdout))
      return { available: false, reason: `${ffmpeg} is built without libx264` }
    const versionResult = await runCommand(ffmpeg, ['-version'], { timeout: 10_000 })
    version = /ffmpeg version (\S+)/.exec(versionResult.stdout)?.[1] ?? 'unknown'
  }
  catch {
    return { available: false, reason: `${ffmpeg} not found` }
  }

  try {
    const result = await runCommand(ffprobe, ['-version'], { timeout: 10_000 })
    if (result.code !== 0)
      return { available: false, reason: `${ffprobe} exited with code ${result.code}` }
  }
  catch {
    return { available: false, reason: `${ffprobe} not found` }
  }
  return { available: true, version }
}

export interface ProbeResult {
  duration?: number
  /** 显示尺寸（已考虑旋转与像素宽高比） */
  width?: number
  height?: number
  videoCodec?: string
  audioCodec?: string
  /** 用于 `-map 0:<index>` 的流序号 */
  videoStream?: number
  audioStream?: number
}

interface FfprobeStream {
  index: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  sample_aspect_ratio?: string
  duration?: string
  disposition?: { attached_pic?: number }
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number | string }[]
}

export interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

function toPositiveNumber(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function getRotation(stream: FfprobeStream): number {
  const fromSideData = stream.side_data_list?.find(item => item.rotation !== undefined)?.rotation
  const rotation = Number(fromSideData ?? stream.tags?.rotate ?? 0)
  return Number.isFinite(rotation) ? rotation : 0
}

/** 解析 `ffprobe -print_format json -show_format -show_streams` 的输出 */
export function parseProbeOutput(output: FfprobeOutput): ProbeResult {
  const streams = output.streams ?? []
  // 跳过 mp3 / m4a 中作为封面的图片流
  const video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find(s => s.codec_type === 'audio')
  const result: ProbeResult = {
    duration: toPositiveNumber(output.format?.duration) ?? toPositiveNumber(video?.duration) ?? toPositiveNumber(audio?.duration),
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    videoStream: video?.index,
    audioStream: audio?.index,
  }

  if (video?.width && video.height) {
    let width = video.width
    let height = video.height
    const sar = /^(\d+):(\d+)$/.exec(video.sample_aspect_ratio ?? '')
    if (sar && Number(sar[1]) > 0 && Number(sar[2]) > 0)
      width = Math.round(width * Number(sar[1]) / Number(sar[2]))
    if (Math.abs(getRotation(video)) % 180 === 90)
      [width, height] = [height, width]
    result.width = width
    result.height = height
  }
  return result
}

export async function probeMedia(ffprobe: string, file: string): Promise<ProbeResult> {
  const result = await runCommand(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000 })
  if (result.code !== 0)
    throw new Error(`ffprobe failed: ${result.stderr.trim() || `exit code ${result.code}`}`)
  return parseProbeOutput(JSON.parse(result.stdout) as FfprobeOutput)
}
