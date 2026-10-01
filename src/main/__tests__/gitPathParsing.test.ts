import { describe, it, expect } from 'vitest'
import { parseNulSeparatedPaths } from '../gitPathParsing'

describe('parseNulSeparatedPaths', () => {
  it('NUL 区切りのパスを配列にする', () => {
    expect(parseNulSeparatedPaths('a.txt\0dir/b.txt\0')).toEqual(['a.txt', 'dir/b.txt'])
  })

  it('空文字は空配列', () => {
    expect(parseNulSeparatedPaths('')).toEqual([])
  })

  it('末尾の NUL や連続した NUL による空要素は除く', () => {
    expect(parseNulSeparatedPaths('a\0\0b\0\0')).toEqual(['a', 'b'])
  })

  it('NUL が無ければ 1 件として扱う', () => {
    expect(parseNulSeparatedPaths('a.txt')).toEqual(['a.txt'])
  })

  it('withStageInfo が無いとき、TAB を含む行はそのまま返す', () => {
    expect(parseNulSeparatedPaths('100644 abc 1\ta.txt\0')).toEqual(['100644 abc 1\ta.txt'])
  })

  it('withStageInfo のとき、最初の TAB より後ろをパスとして取り出す', () => {
    expect(
      parseNulSeparatedPaths(
        ['100644 abc 1\ta.txt', '100644 def 2\ta.txt', '100644 123 3\tdir/b.txt'].join('\0'),
        true
      )
    ).toEqual(['a.txt', 'a.txt', 'dir/b.txt'])
  })

  it('withStageInfo でもパス自体に TAB があれば、最初の TAB より後ろ全部をパスとする', () => {
    expect(parseNulSeparatedPaths('100644 abc 1\tx\ty.txt\0', true)).toEqual(['x\ty.txt'])
  })

  it('withStageInfo で TAB の無い行は全体をパスとする', () => {
    expect(parseNulSeparatedPaths('plain.txt\0', true)).toEqual(['plain.txt'])
  })
})
