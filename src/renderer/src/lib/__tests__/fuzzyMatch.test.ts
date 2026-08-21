import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from '../fuzzyMatch'

const scoreOf = (query: string, target: string): number => {
  const result = fuzzyMatch(query, target)
  if (result === null) throw new Error(`マッチしませんでした: ${query} / ${target}`)
  return result.score
}

describe('fuzzyMatch', () => {
  it('空クエリのとき null を返す', () => {
    expect(fuzzyMatch('', 'useFileSystem.ts')).toBeNull()
  })

  it('クエリがターゲットより長いとき null を返す', () => {
    expect(fuzzyMatch('useFileSystemHook', 'index.ts')).toBeNull()
  })

  it('文字が部分列として含まれないとき null を返す', () => {
    expect(fuzzyMatch('xyz', 'useFileSystem.ts')).toBeNull()
  })

  it('順序が異なるとき null を返す', () => {
    expect(fuzzyMatch('sfu', 'useFileSystem.ts')).toBeNull()
  })

  it('連続する完全一致の位置を indices として返す', () => {
    expect(fuzzyMatch('index', 'index.ts')?.indices).toEqual([0, 1, 2, 3, 4])
  })

  it('飛び飛びの部分列一致で単語境界の位置を優先して indices を返す', () => {
    // useFileSystem.ts の 'u'(0) 's'(1) 'F'(3) 'S'(7) を選ぶ。
    // 's' は 1 と 7 以外にも 9 に存在するが、camelCase 境界の 7 が優先される。
    expect(fuzzyMatch('usfs', 'useFileSystem.ts')?.indices).toEqual([0, 1, 3, 7])
  })

  it('後続文字の候補が複数あるとき単語境界の位置を選ぶ', () => {
    expect(fuzzyMatch('fs', 'useFileSystem.ts')?.indices).toEqual([3, 7])
  })

  it('大文字小文字を無視して照合する', () => {
    expect(fuzzyMatch('USFS', 'useFileSystem.ts')?.indices).toEqual([0, 1, 3, 7])
  })

  it('連続一致は分散した一致より高いスコアになる', () => {
    expect(scoreOf('abc', 'abcxxx')).toBeGreaterThan(scoreOf('abc', 'axbxc'))
  })

  it('単語境界から始まる一致は途中から始まる一致より高いスコアになる', () => {
    expect(scoreOf('sys', 'my-system.ts')).toBeGreaterThan(scoreOf('sys', 'analysystem.ts'))
  })

  it('先頭に近い一致は末尾に近い一致より高いスコアになる', () => {
    expect(scoreOf('ts', 'tsconfig.json')).toBeGreaterThan(scoreOf('ts', 'a-very-long-name-ts'))
  })

  it('大文字小文字まで一致するほうが高いスコアになる', () => {
    expect(scoreOf('README', 'README.md')).toBeGreaterThan(scoreOf('readme', 'README.md'))
  })

  it('パス区切り直後を単語境界として扱う', () => {
    expect(fuzzyMatch('h', 'src/hooks')?.indices).toEqual([4])
  })

  it('2文字目以降がターゲット先頭の文字と一致しても正しくマッチする', () => {
    // query[1] が target[0] と一致する組み合わせ。DP の左上参照が範囲外に出ると
    // スコアが NaN になり、後続のマッチまで巻き込んで null 化する
    expect(fuzzyMatch('ss', 'src/styles.css')?.indices).toEqual([0, 4])
  })

  it('ディレクトリ区切りをまたぐ長いクエリでもマッチする', () => {
    expect(fuzzyMatch('hooks/use', 'src/hooks/useFileSystem.ts')?.indices).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12
    ])
  })

  it('クエリと同じ長さのターゲットに完全一致する', () => {
    expect(fuzzyMatch('abc', 'abc')?.indices).toEqual([0, 1, 2])
  })

  it('ターゲットが空文字列のとき null を返す', () => {
    expect(fuzzyMatch('a', '')).toBeNull()
  })

  it('日本語のファイル名でも部分列としてマッチする', () => {
    expect(fuzzyMatch('設計', '設計メモ.md')?.indices).toEqual([0, 1])
  })

  it('候補の単語境界条件が同じとき連続した並びを選ぶ', () => {
    // 'xaxaa' の 'a' はいずれも単語境界ではないため、連続ボーナスだけで決まる
    expect(fuzzyMatch('aa', 'xaxaa')?.indices).toEqual([3, 4])
  })

  it('連続した並びより先頭の単語境界から始まる一致を優先する', () => {
    // 'a-b-aa' では先頭の 'a'(index 0)が単語境界のため [0, 4] を選ぶ。
    // 連続ボーナスだけで末尾の [4, 5] に倒れないことを固定する
    expect(fuzzyMatch('aa', 'a-b-aa')?.indices).toEqual([0, 4])
  })

  it('indices は常に昇順で重複しない', () => {
    const indices = fuzzyMatch('ete', 'quickOpenSearch.test.ts')?.indices ?? []
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(new Set(indices).size).toBe(indices.length)
  })

  it('小文字化で長さが変わる文字があっても indices が元の文字列の位置を指す', () => {
    // 'İ'.toLowerCase() は 2 コードユニットになるため、文字列全体を先に
    // 小文字化すると以降のインデックスがずれ、ハイライト位置が壊れる
    const result = fuzzyMatch('is', 'İstanbul.md')
    expect(result?.indices).toEqual([0, 1])
    expect(result?.indices.map((i) => 'İstanbul.md'[i]).join('')).toBe('İs')
  })

  it('DP を打ち切る長さのクエリでも一致位置を返す', () => {
    // 計算量の上限を超えると貪欲法へ切り替える。最適な位置ではなくなり得るが、
    // 一致判定と indices の整合(昇順・クエリの各文字に対応)は保つ
    const target = `${'src/renderer/src/components/quick-open/'.repeat(3)}QuickOpenDialog.tsx`
    const query = target
    const result = fuzzyMatch(query, target)
    expect(result).not.toBeNull()
    const indices = result?.indices ?? []
    expect(indices).toHaveLength(query.length)
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(indices.map((i) => target[i]).join('')).toBe(query)
    expect(Number.isFinite(result?.score)).toBe(true)
  })

  it('DP を打ち切る長さでも一致しないものは null を返す', () => {
    const target = 'a'.repeat(200)
    expect(fuzzyMatch(`${'a'.repeat(150)}z`, target)).toBeNull()
  })

  it('スコアは常に有限の数値を返す', () => {
    const result = fuzzyMatch('u', 'useFileSystem.ts')
    expect(Number.isFinite(result?.score)).toBe(true)
  })
})
