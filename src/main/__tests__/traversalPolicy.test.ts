import { describe, it, expect } from 'vitest'
import { SKIP_DIRS, MAX_DEPTH, shouldSkipDir, sortFileTree } from '../traversalPolicy'

describe('SKIP_DIRS', () => {
  it.each([...SKIP_DIRS])('"%s" はスキップ対象に含まれる', (dir) => {
    expect(SKIP_DIRS.has(dir)).toBe(true)
  })

  it('通常のディレクトリ名はスキップ対象に含まれない', () => {
    expect(SKIP_DIRS.has('src')).toBe(false)
    expect(SKIP_DIRS.has('lib')).toBe(false)
    expect(SKIP_DIRS.has('components')).toBe(false)
  })
})

describe('MAX_DEPTH', () => {
  it('正の整数である', () => {
    expect(Number.isInteger(MAX_DEPTH)).toBe(true)
    expect(MAX_DEPTH).toBeGreaterThan(0)
  })
})

describe('shouldSkipDir', () => {
  it.each([...SKIP_DIRS])('"%s" に対して true を返す', (dir) => {
    expect(shouldSkipDir(dir)).toBe(true)
  })

  it('通常のディレクトリ名に対して false を返す', () => {
    expect(shouldSkipDir('src')).toBe(false)
    expect(shouldSkipDir('lib')).toBe(false)
    expect(shouldSkipDir('components')).toBe(false)
  })
})

describe('sortFileTree', () => {
  it('ディレクトリはファイルより先にくる', () => {
    const nodes = [
      { name: 'index.ts', type: 'file' as const },
      { name: 'src', type: 'directory' as const },
      { name: 'README.md', type: 'file' as const },
    ]
    const result = sortFileTree(nodes)
    expect(result[0].type).toBe('directory')
  })

  it('同種のエントリはアルファベット順にソートされる', () => {
    const nodes = [
      { name: 'z.ts', type: 'file' as const },
      { name: 'a.ts', type: 'file' as const },
      { name: 'm.ts', type: 'file' as const },
    ]
    const result = sortFileTree(nodes)
    expect(result.map((n) => n.name)).toEqual(['a.ts', 'm.ts', 'z.ts'])
  })

  it('ディレクトリ同士もアルファベット順にソートされる', () => {
    const nodes = [
      { name: 'z-dir', type: 'directory' as const },
      { name: 'a-dir', type: 'directory' as const },
    ]
    const result = sortFileTree(nodes)
    expect(result[0].name).toBe('a-dir')
  })

  it('元の配列を破壊しない', () => {
    const nodes = [
      { name: 'b.ts', type: 'file' as const },
      { name: 'a.ts', type: 'file' as const },
    ]
    const original = [...nodes]
    sortFileTree(nodes)
    expect(nodes).toEqual(original)
  })

  it('空配列を渡すと空配列を返す', () => {
    expect(sortFileTree([])).toEqual([])
  })
})
