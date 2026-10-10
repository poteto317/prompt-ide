import { describe, it, expect } from 'vitest'
import {
  appendAddedPath,
  hasAddedPath,
  removeAddedPath,
  removeSentPaths
} from '../agentAddedReferencePaths'

describe('hasAddedPath', () => {
  it('同じパスがあれば true、無ければ false', () => {
    expect(hasAddedPath(['/repo/a.md'], '/repo/a.md')).toBe(true)
    expect(hasAddedPath(['/repo/a.md'], '/repo/b.md')).toBe(false)
    expect(hasAddedPath([], '/repo/a.md')).toBe(false)
  })

  it('Windows のパスは区切りと大文字小文字の違いを吸収する', () => {
    expect(hasAddedPath(['C:\\repo\\a.md'], 'c:/repo/A.md')).toBe(true)
  })
})

describe('appendAddedPath', () => {
  it('末尾に加え、同じパスがすでにあれば元の一覧(同じ参照)を返す', () => {
    const prev = ['/repo/a.md']
    expect(appendAddedPath(prev, '/repo/b.md')).toEqual(['/repo/a.md', '/repo/b.md'])
    expect(appendAddedPath(prev, '/repo/a.md')).toBe(prev)
  })

  it('表記が違うだけの同じ Windows のパスは加えない', () => {
    const prev = ['C:\\repo\\a.md']
    expect(appendAddedPath(prev, 'c:/repo/A.md')).toBe(prev)
  })

  it('元の一覧は変えない', () => {
    const prev = ['/repo/a.md']
    appendAddedPath(prev, '/repo/b.md')
    expect(prev).toEqual(['/repo/a.md'])
  })
})

describe('removeAddedPath', () => {
  it('一致するものだけを外し、並びを保つ', () => {
    expect(removeAddedPath(['/repo/a.md', '/repo/b.md', '/repo/c.md'], '/repo/b.md')).toEqual([
      '/repo/a.md',
      '/repo/c.md'
    ])
  })

  it('一致しなければ同じ中身の一覧を返す', () => {
    expect(removeAddedPath(['/repo/a.md'], '/repo/x.md')).toEqual(['/repo/a.md'])
  })
})

describe('removeSentPaths', () => {
  it('送れた写しに入れたものだけを外し、後から足したものは残す', () => {
    expect(
      removeSentPaths(['/repo/a.md', '/repo/b.md', '/repo/c.md'], ['/repo/a.md', '/repo/c.md'])
    ).toEqual(['/repo/b.md'])
  })

  it('送れた写しが空なら何も外さない', () => {
    expect(removeSentPaths(['/repo/a.md'], [])).toEqual(['/repo/a.md'])
  })

  it('Windows のパスは表記の違いを吸収して外す', () => {
    expect(removeSentPaths(['C:\\repo\\a.md', 'C:\\repo\\b.md'], ['c:/repo/A.md'])).toEqual([
      'C:\\repo\\b.md'
    ])
  })
})
