import { describe, expect, it } from 'vitest'
import { parseRange } from '../src/utils/range'

describe('parseRange', () => {
  const size = 1000

  it('returns none without header', () => {
    expect(parseRange(undefined, size)).toEqual({ type: 'none' })
  })

  it('parses closed range', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ type: 'range', range: { start: 0, end: 99 } })
  })

  it('parses open-ended range', () => {
    expect(parseRange('bytes=500-', size)).toEqual({ type: 'range', range: { start: 500, end: 999 } })
  })

  it('parses suffix range', () => {
    expect(parseRange('bytes=-100', size)).toEqual({ type: 'range', range: { start: 900, end: 999 } })
    expect(parseRange('bytes=-5000', size)).toEqual({ type: 'range', range: { start: 0, end: 999 } })
  })

  it('clamps end to file size', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({ type: 'range', range: { start: 900, end: 999 } })
  })

  it('reports unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', size)).toEqual({ type: 'unsatisfiable' })
    expect(parseRange('bytes=-0', size)).toEqual({ type: 'unsatisfiable' })
  })

  it('ignores malformed or multi ranges', () => {
    expect(parseRange('bytes=abc', size)).toEqual({ type: 'none' })
    expect(parseRange('bytes=0-1,5-6', size)).toEqual({ type: 'none' })
    expect(parseRange('bytes=50-10', size)).toEqual({ type: 'none' })
    expect(parseRange('items=0-1', size)).toEqual({ type: 'none' })
  })
})
