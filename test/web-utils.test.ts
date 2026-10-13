import { describe, expect, it } from 'vitest'
import { getChunkCount, getChunkIndex, getChunkRange, parseRangeHeader, pickNextChunk } from '../web/src/utils/chunk'
import { formatBytes, formatDuration } from '../web/src/utils/format'
import { parentPath, stripExtension } from '../web/src/utils/path'

describe('chunk utils', () => {
  const chunk = 100

  it('computes chunk count and ranges', () => {
    expect(getChunkCount(250, chunk)).toBe(3)
    expect(getChunkCount(0, chunk)).toBe(0)
    expect(getChunkRange(0, 250, chunk)).toEqual({ start: 0, end: 99 })
    expect(getChunkRange(2, 250, chunk)).toEqual({ start: 200, end: 249 })
    expect(getChunkIndex(199, chunk)).toBe(1)
  })

  it('picks next chunk from cursor and wraps around', () => {
    const taken = new Set([2, 3])
    expect(pickNextChunk(5, 2, i => taken.has(i))).toBe(4)
    taken.add(4)
    expect(pickNextChunk(5, 2, i => taken.has(i))).toBe(0)
    expect(pickNextChunk(2, 0, () => true)).toBe(-1)
  })

  it('parses range header for service worker', () => {
    expect(parseRangeHeader('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRangeHeader('bytes=10-20', 1000)).toEqual({ start: 10, end: 20 })
    expect(parseRangeHeader('bytes=-20', 1000)).toBeNull()
    expect(parseRangeHeader(null, 1000)).toBeNull()
    expect(parseRangeHeader('bytes=1000-', 1000)).toBeNull()
  })
})

describe('format utils', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('formats duration', () => {
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(Number.NaN)).toBe('--:--')
  })
})

describe('path utils', () => {
  it('handles parent path and extension', () => {
    expect(parentPath('a/b/c.mp4')).toBe('a/b')
    expect(parentPath('c.mp4')).toBe('')
    expect(stripExtension('movie.part1.mp4')).toBe('movie.part1')
    expect(stripExtension('.hidden')).toBe('.hidden')
  })
})
