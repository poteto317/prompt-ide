import { describe, it, expect } from 'vitest'
import {
  parseNulSeparatedPaths,
  parseUnstagedStatusEntries,
  parseUnstagedStatusPaths,
  stripTrailingNewline,
  toLiteralPathspec
} from '../gitPathParsing'
import { isUnstagedFile } from '../../renderer/src/lib/gitUtils'

describe('stripTrailingNewline', () => {
  it('末尾の改行(LF・CRLF)を 1 つだけ除く', () => {
    expect(stripTrailingNewline('/repo\n')).toBe('/repo')
    expect(stripTrailingNewline('/repo\r\n')).toBe('/repo')
    expect(stripTrailingNewline('/repo\n\n')).toBe('/repo\n')
  })

  it('パスの先頭・末尾の空白は残す(trim しない)', () => {
    expect(stripTrailingNewline(' /my repo \n')).toBe(' /my repo ')
  })
})

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

describe('toLiteralPathspec', () => {
  it('パスに :(literal) 接頭辞を付ける', () => {
    expect(toLiteralPathspec('src/index.ts')).toBe(':(literal)src/index.ts')
  })

  it('グロブとして解釈されうる文字を含むパスもそのまま後ろに続ける', () => {
    expect(toLiteralPathspec('a[1].txt')).toBe(':(literal)a[1].txt')
  })
})

// 出力形式は mktemp の一時リポジトリで git status --porcelain -z --untracked-files=all を実行して確認した:
// ステージ済みのリネームは「R  新\0旧\0」、ステージ済み + 作業ツリーは「RM 新\0旧\0」、
// ネストした git リポジトリは「?? nested/\0」、コンフリクトは UU / AA / UD / DU など
describe('parseUnstagedStatusEntries', () => {
  it('パス・生のパス・2 文字のステータスを出力の順に返す', () => {
    expect(parseUnstagedStatusEntries(' M a.txt\0?? sub/\0MM b.txt\0')).toEqual([
      { path: 'a.txt', rawPath: 'a.txt', status: ' M' },
      { path: 'sub', rawPath: 'sub/', status: '??' },
      { path: 'b.txt', rawPath: 'b.txt', status: 'MM' }
    ])
  })

  it('リネームは新パスだけを返し、旧パスは別のエントリにしない', () => {
    expect(parseUnstagedStatusEntries('RM new.txt\0old.txt\0 R n2.txt\0o2.txt\0')).toEqual([
      { path: 'new.txt', rawPath: 'new.txt', status: 'RM' },
      { path: 'n2.txt', rawPath: 'n2.txt', status: ' R' }
    ])
  })

  it('先頭の空白も生のパスと path に残す', () => {
    expect(parseUnstagedStatusEntries('?? \u3000zen\0AM  lead\0')).toEqual([
      { path: '\u3000zen', rawPath: '\u3000zen', status: '??' },
      { path: ' lead', rawPath: ' lead', status: 'AM' }
    ])
  })

  it('末尾の空白は生のパスに残す', () => {
    expect(parseUnstagedStatusEntries('?? trailsp \0')).toEqual([
      { path: 'trailsp ', rawPath: 'trailsp ', status: '??' }
    ])
  })
})

describe('parseUnstagedStatusPaths', () => {
  it.each([
    [' M a.txt\0', ['a.txt']],
    ['M  a.txt\0', []],
    ['MM a.txt\0', ['a.txt']],
    ['?? n.txt\0', ['n.txt']],
    ['UU c.txt\0', ['c.txt']],
    ['AA c.txt\0', ['c.txt']],
    ['UD c.txt\0', ['c.txt']],
    ['DU c.txt\0', ['c.txt']],
    [' D d.txt\0', ['d.txt']],
    [' A i.txt\0', ['i.txt']],
    ['A  s.txt\0', []],
    ['D  s.txt\0', []]
  ])('%j を解釈する', (output, expected) => {
    expect(parseUnstagedStatusPaths(output)).toEqual(expected)
  })

  it('ステージ済みのリネームは、旧パスを別のエントリとして読まない', () => {
    expect(parseUnstagedStatusPaths('R  new.txt\0old.txt\0 M b.txt\0')).toEqual(['b.txt'])
  })

  it('ステージ済みのリネームに作業ツリーの変更があれば新パスだけ返す', () => {
    expect(parseUnstagedStatusPaths('RM new.txt\0old.txt\0')).toEqual(['new.txt'])
  })

  it('ステージ済みのコピーも旧パスを読み飛ばす', () => {
    expect(parseUnstagedStatusPaths('C  new.txt\0old.txt\0?? n.txt\0')).toEqual(['n.txt'])
  })

  it('旧パスが「XY 」で始まる形に見えても、リネームの直後なら読み飛ばす', () => {
    expect(parseUnstagedStatusPaths('R  new.txt\0?? old.txt\0 M b.txt\0')).toEqual(['b.txt'])
  })

  // git add -N で新パスを intent-to-add にしたリネームは、index が ' ' で workingDir が 'R' で出る
  // (実 git 2.50.1 で確認: ' R new-name.txt\0old-name.txt\0')。旧パスも読み飛ばさないと、
  // 旧パスを別のエントリとして読んで件数がずれる
  it.each([
    [' R new-name.txt\0old-name.txt\0', ['new-name.txt']],
    [' R new.txt\0old.txt\0', ['new.txt']],
    [' R new.txt\0o\0 M b.txt\0', ['new.txt', 'b.txt']],
    [' C new.txt\0old-name.txt\0 M b.txt\0', ['new.txt', 'b.txt']],
    [' R new.txt\0 M old.txt\0 M b.txt\0', ['new.txt', 'b.txt']]
  ])('workingDir が R / C のエントリは旧パスを読み飛ばす: %j', (output, expected) => {
    expect(parseUnstagedStatusPaths(output)).toEqual(expected)
  })

  it('末尾の / (ネストした git リポジトリ)を削る', () => {
    expect(parseUnstagedStatusPaths('?? sub/\0')).toEqual(['sub'])
  })

  it('日本語・空白・改行を含むパスをそのまま返す', () => {
    expect(parseUnstagedStatusPaths(' M 日本語 a.txt\0?? x\ny.txt\0')).toEqual([
      '日本語 a.txt',
      'x\ny.txt'
    ])
  })

  it('出力の順に返す', () => {
    expect(parseUnstagedStatusPaths(' M b.txt\0?? a.txt\0 D c.txt\0')).toEqual([
      'b.txt',
      'a.txt',
      'c.txt'
    ])
  })

  it('空文字は空配列', () => {
    expect(parseUnstagedStatusPaths('')).toEqual([])
  })

  // renderer の「変更」セクションの件数(isUnstagedFile)と main の件数がずれると、確認ダイアログで
  // 見せた件数と実行時の件数が常に食い違い、一括の取り消しが動かなくなる(または見せていない
  // 取り消しを実行する)。同じ表を両方向から固定する
  describe('renderer の isUnstagedFile と件数の定義が一致する', () => {
    const combos: [string, string][] = [
      [' ', 'M'],
      [' ', 'D'],
      [' ', 'A'],
      [' ', 'T'],
      [' ', 'R'],
      [' ', 'C'],
      ['M', ' '],
      ['A', ' '],
      ['D', ' '],
      ['R', ' '],
      ['C', ' '],
      ['M', 'M'],
      ['M', 'D'],
      ['A', 'M'],
      ['R', 'M'],
      ['A', 'D'],
      ['?', '?'],
      ['U', 'U'],
      ['A', 'A'],
      ['D', 'D'],
      ['A', 'U'],
      ['U', 'D'],
      ['U', 'A'],
      ['D', 'U']
    ]

    it.each(combos)('index=%j workingDir=%j: main が数えるなら renderer も数える', (i, w) => {
      const rest = [i, w].some((c) => c === 'R' || c === 'C') ? 'old.txt\0' : ''
      const countedByMain = parseUnstagedStatusPaths(`${i}${w} p.txt\0${rest}`).length === 1
      expect(countedByMain).toBe(isUnstagedFile({ path: 'p.txt', index: i, workingDir: w }))
    })

    it.each(combos)('index=%j workingDir=%j: renderer が数えるなら main も数える', (i, w) => {
      const rest = [i, w].some((c) => c === 'R' || c === 'C') ? 'old.txt\0' : ''
      const file = { path: 'p.txt', index: i, workingDir: w }
      expect(isUnstagedFile(file)).toBe(
        parseUnstagedStatusPaths(`${i}${w} p.txt\0${rest}`).includes('p.txt')
      )
    })
  })
})
