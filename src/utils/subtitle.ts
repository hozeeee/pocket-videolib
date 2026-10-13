/** 将 SRT 字幕转换为 WebVTT，以便 `<track>` 直接使用 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // 时间轴中的逗号毫秒分隔符替换为点
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .trim()
  return `WEBVTT\n\n${body}\n`
}
