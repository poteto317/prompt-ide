import { describe, it, expect } from 'vitest'
import { sep } from 'node:path'
import { toPosixRelativePath } from '../pathNormalize'

describe('toPosixRelativePath', () => {
  it('バックスラッシュ区切り(Windows想定)をフォワードスラッシュ区切りに変換する', () => {
    // path.relative は Windows では \ 区切りの文字列を返す。実行環境自体を Windows に
    // する必要が無いよう、区切り文字を明示的に指定して決定的に検証する
    expect(toPosixRelativePath('sub\\dir\\file.ts', '\\')).toBe('sub/dir/file.ts')
  })

  it('フォワードスラッシュ区切り(POSIX想定)はそのまま返す', () => {
    expect(toPosixRelativePath('sub/dir/file.ts', '/')).toBe('sub/dir/file.ts')
  })

  it('区切り文字を含まない単一セグメントのパスはそのまま返す', () => {
    expect(toPosixRelativePath('file.ts', '\\')).toBe('file.ts')
  })

  it('separator を省略した場合、実行環境の path.sep が使われる', () => {
    const input = ['sub', 'dir', 'file.ts'].join(sep)
    expect(toPosixRelativePath(input)).toBe('sub/dir/file.ts')
  })
})
