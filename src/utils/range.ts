export interface ByteRange {
  start: number
  /** 包含 end */
  end: number
}

export type RangeResult
  = | { type: 'none' }
    | { type: 'range', range: ByteRange }
    | { type: 'unsatisfiable' }

const RANGE_RE = /^bytes=(\d*)-(\d*)$/

/**
 * 解析 HTTP Range 请求头，仅支持单段范围。
 * 格式错误或多段范围时按 RFC 9110 忽略 Range，返回完整内容。
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header)
    return { type: 'none' }

  const match = RANGE_RE.exec(header.trim())
  if (!match)
    return { type: 'none' }

  const [, startStr, endStr] = match
  if (startStr === '' && endStr === '')
    return { type: 'none' }

  // 后缀范围：bytes=-500 表示最后 500 字节
  if (startStr === '') {
    const suffix = Number(endStr)
    if (suffix === 0 || size === 0)
      return { type: 'unsatisfiable' }
    return { type: 'range', range: { start: Math.max(0, size - suffix), end: size - 1 } }
  }

  const start = Number(startStr)
  const end = endStr === '' ? size - 1 : Math.min(Number(endStr), size - 1)

  if (start >= size)
    return { type: 'unsatisfiable' }
  if (end < start)
    return { type: 'none' }

  return { type: 'range', range: { start, end } }
}
