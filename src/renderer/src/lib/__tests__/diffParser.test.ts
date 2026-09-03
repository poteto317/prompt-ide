import { describe, it, expect } from 'vitest'
import { parseDiff, buildHunkPatch } from '../diffParser'

const SAMPLE_DIFF = [
  'diff --git a/src/index.ts b/src/index.ts',
  'index abc123..def456 100644',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-line2',
  '+line2modified',
  '+line3new',
  ' line4',
  '@@ -10,2 +11,3 @@',
  ' line10',
  '+line11new',
  ' line12',
  '',
].join('\n')

describe('parseDiff', () => {
  it('ヘッダー行群とハンク群を正しく分割する', () => {
    const result = parseDiff(SAMPLE_DIFF)
    expect(result.headerLines).toEqual([
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc123..def456 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
    ])
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].header).toBe('@@ -1,3 +1,4 @@')
    expect(result.hunks[0].lines).toEqual([
      ' line1',
      '-line2',
      '+line2modified',
      '+line3new',
      ' line4',
    ])
    expect(result.hunks[1].header).toBe('@@ -10,2 +11,3 @@')
    expect(result.hunks[1].lines).toEqual([' line10', '+line11new', ' line12'])
  })

  it('空文字列の場合、ヘッダーもハンクも空になる', () => {
    const result = parseDiff('')
    expect(result.headerLines).toEqual([])
    expect(result.hunks).toEqual([])
  })
})

describe('buildHunkPatch', () => {
  it('ヘッダー行群 + 指定ハンクのみを結合したパッチ文字列を返す', () => {
    const parsed = parseDiff(SAMPLE_DIFF)
    const patch = buildHunkPatch(parsed, 0)
    expect(patch).toBe(
      [
        'diff --git a/src/index.ts b/src/index.ts',
        'index abc123..def456 100644',
        '--- a/src/index.ts',
        '+++ b/src/index.ts',
        '@@ -1,3 +1,4 @@',
        ' line1',
        '-line2',
        '+line2modified',
        '+line3new',
        ' line4',
        '',
      ].join('\n')
    )
  })

  it('2番目のハンクだけを指定した場合、1番目のハンクは含まれない', () => {
    const parsed = parseDiff(SAMPLE_DIFF)
    const patch = buildHunkPatch(parsed, 1)
    expect(patch).not.toContain('line2modified')
    expect(patch).toContain('@@ -10,2 +11,3 @@')
    expect(patch).toContain('+line11new')
  })
})
