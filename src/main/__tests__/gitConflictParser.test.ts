import { describe, expect, it } from 'vitest'
import type { ConflictSegment } from '../../shared/types/git'
import {
  applyConflictChoices,
  digestConflictBlocks,
  hasConflictMarker,
  parseConflictFile
} from '../gitConflictParser'

const simple = ['a', '<<<<<<< HEAD', 'mine', '=======', 'theirs', '>>>>>>> feature', 'z'].join('\n')

function parsed(content: string): NonNullable<ReturnType<typeof parseConflictFile>> {
  const r = parseConflictFile(content)
  if (!r) throw new Error('解析できませんでした')
  return r
}

describe('parseConflictFile', () => {
  it('1 ブロックを解析する', () => {
    const r = parsed(simple + '\n')
    expect(r.segments).toEqual([
      { kind: 'text', lines: ['a'] },
      {
        kind: 'conflict',
        ours: ['mine'],
        theirs: ['theirs'],
        oursLabel: 'HEAD',
        theirsLabel: 'feature'
      },
      { kind: 'text', lines: ['z'] }
    ])
    expect(r.eol).toBe('\n')
    expect(r.endsWithEol).toBe(true)
  })

  it('複数ブロック（間にテキスト）を解析する', () => {
    const c = [
      '<<<<<<< HEAD',
      '1',
      '=======',
      '2',
      '>>>>>>> b',
      'mid',
      '<<<<<<< HEAD',
      '3',
      '=======',
      '4',
      '>>>>>>> b'
    ].join('\n')
    const r = parsed(c)
    expect(r.segments.map((s) => s.kind)).toEqual(['conflict', 'text', 'conflict'])
    expect(r.endsWithEol).toBe(false)
  })

  it('片側が空のブロックを解析する', () => {
    const r1 = parsed(['<<<<<<< HEAD', '=======', 'x', '>>>>>>> b'].join('\n'))
    expect(r1.segments[0]).toMatchObject({ kind: 'conflict', ours: [], theirs: ['x'] })
    const r2 = parsed(['<<<<<<< HEAD', 'x', '=======', '>>>>>>> b'].join('\n'))
    expect(r2.segments[0]).toMatchObject({ kind: 'conflict', ours: ['x'], theirs: [] })
  })

  it('diff3 形式で base が入る', () => {
    const c = ['<<<<<<< HEAD', 'o', '||||||| base', 'b', '=======', 't', '>>>>>>> br'].join('\n')
    const r = parsed(c)
    expect(r.segments[0]).toMatchObject({ ours: ['o'], base: ['b'], theirs: ['t'] })
  })

  it('空白を含むラベルを保つ', () => {
    const c = ['<<<<<<< my branch name', 'o', '=======', 't', '>>>>>>> other branch'].join('\n')
    expect(parsed(c).segments[0]).toMatchObject({
      oursLabel: 'my branch name',
      theirsLabel: 'other branch'
    })
  })

  it('ラベルの無いマーカーを解析する', () => {
    const c = ['<<<<<<<', 'o', '=======', 't', '>>>>>>>'].join('\n')
    expect(parsed(c).segments[0]).toMatchObject({ oursLabel: '', theirsLabel: '' })
  })

  it('CRLF が主なら eol は CRLF で、行に \\r が残らない', () => {
    const r = parsed(simple.replace(/\n/g, '\r\n') + '\r\n')
    expect(r.eol).toBe('\r\n')
    for (const s of r.segments) {
      const lines = s.kind === 'text' ? s.lines : [...s.ours, ...s.theirs]
      for (const l of lines) expect(l).not.toContain('\r')
    }
    expect(r.endsWithEol).toBe(true)
  })

  it.each([
    ['インデント付き', '  <<<<<<< x'],
    ['6 文字', '<<<<<< x'],
    ['8 文字', '<<<<<<<< x'],
    ['= を含む行', '======= x'],
    ['8 個の =', '========'],
    ['8 個の >', '>>>>>>>> x'],
    ['8 個の |', '|||||||| x']
  ])('本文のマーカーに見える文字列を本文として扱う: %s', (_n, line) => {
    const r = parsed(['a', line, 'b'].join('\n'))
    expect(r.segments).toEqual([{ kind: 'text', lines: ['a', line, 'b'] }])
  })

  it('ブロックの中のマーカーに見える文字列も本文として扱う', () => {
    const c = ['<<<<<<< HEAD', '  <<<<<<< x', '=======', '======= x', '>>>>>>> b'].join('\n')
    expect(parsed(c).segments[0]).toMatchObject({
      ours: ['  <<<<<<< x'],
      theirs: ['======= x']
    })
  })

  it('ブロックの外の ======= 単独行（setext 見出しの下線）は本文として残り、往復で一致する', () => {
    const c = [
      'Title',
      '=======',
      '<<<<<<< HEAD',
      'o',
      '=======',
      't',
      '>>>>>>> b',
      'Sub',
      '=======',
      '<<<<<<< HEAD',
      'o2',
      '=======',
      't2',
      '>>>>>>> b',
      'End',
      '======='
    ].join('\n')
    const r = parsed(c + '\n')
    expect(r.segments.filter((s) => s.kind === 'conflict')).toHaveLength(2)
    expect(r.segments[0]).toEqual({ kind: 'text', lines: ['Title', '======='] })
    expect(applyConflictChoices(r, {})).toBe(c + '\n')
    expect(applyConflictChoices(r, { 0: 'ours', 1: 'theirs' })).toBe(
      ['Title', '=======', 'o', 'Sub', '=======', 't2', 'End', '======='].join('\n') + '\n'
    )
  })

  it.each([
    ['閉じていない', '<<<<<<< HEAD\nx\n'],
    ['= が無い', '<<<<<<< HEAD\nx\n>>>>>>> b\n'],
    ['> が無い', '<<<<<<< HEAD\nx\n=======\ny\n'],
    ['ネスト', '<<<<<<< a\n<<<<<<< b\nx\n=======\ny\n>>>>>>> b\n=======\n>>>>>>> a\n'],
    ['順序の崩れ', '>>>>>>> b\nx\n=======\n<<<<<<< a\n'],
    ['ブロックの外の >', 'a\n>>>>>>> x\nb\n'],
    ['ブロックの外の |', 'a\n||||||| x\nb\n'],
    ['base の後に base', '<<<<<<< a\n||||||| b\n||||||| c\n=======\n>>>>>>> d\n'],
    ['theirs で base', '<<<<<<< a\n=======\n||||||| b\n>>>>>>> d\n']
  ])('解析不能は null: %s', (_n, content) => {
    expect(parseConflictFile(content)).toBeNull()
  })
})

describe('applyConflictChoices', () => {
  const multi = [
    'top',
    '<<<<<<< HEAD',
    'o1',
    '=======',
    't1',
    '>>>>>>> br',
    'mid',
    '<<<<<<< HEAD',
    'o2',
    '||||||| base',
    'b2',
    '=======',
    't2',
    '>>>>>>> br',
    'end'
  ].join('\n')

  it('選択なしだと元のテキストに復元される（ラベル・base も）', () => {
    const r = parsed(multi + '\n')
    expect(applyConflictChoices(r, {})).toBe(multi + '\n')
  })

  it('ours / theirs / both を選べる', () => {
    const r = parsed(multi)
    const f = (c: Record<number, 'ours' | 'theirs' | 'both'>): string => applyConflictChoices(r, c)
    expect(f({ 0: 'ours', 1: 'ours' })).toBe('top\no1\nmid\no2\nend')
    expect(f({ 0: 'theirs', 1: 'theirs' })).toBe('top\nt1\nmid\nt2\nend')
    expect(f({ 0: 'both', 1: 'both' })).toBe('top\no1\nt1\nmid\no2\nt2\nend')
  })

  it('未指定のブロックは元のマーカー付きで残る', () => {
    const r = parsed(multi)
    const out = applyConflictChoices(r, { 0: 'ours' })
    expect(out).toBe(
      [
        'top',
        'o1',
        'mid',
        '<<<<<<< HEAD',
        'o2',
        '||||||| base',
        'b2',
        '=======',
        't2',
        '>>>>>>> br',
        'end'
      ].join('\n')
    )
  })

  it('すべて選ぶとマーカーが残らない', () => {
    const r = parsed(multi)
    const out = applyConflictChoices(r, { 0: 'both', 1: 'theirs' })
    expect(out).not.toMatch(/^(<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)/m)
  })

  it('CRLF で出力し、元のテキスト部分と一致する', () => {
    const crlf = multi.replace(/\n/g, '\r\n') + '\r\n'
    const r = parsed(crlf)
    expect(applyConflictChoices(r, {})).toBe(crlf)
    const out = applyConflictChoices(r, { 0: 'ours', 1: 'ours' })
    expect(out).toBe('top\r\no1\r\nmid\r\no2\r\nend\r\n')
  })

  it.each([
    ['末尾に改行あり', '\n'],
    ['末尾に改行なし', '']
  ])('%s の有無を元のとおりに保つ', (_n, tail) => {
    const r = parsed(multi + tail)
    const out = applyConflictChoices(r, { 0: 'ours', 1: 'theirs' })
    expect(out.endsWith('\n')).toBe(tail === '\n')
  })

  it('末尾がブロックで片側が空でも末尾の改行を保つ', () => {
    const c = ['<<<<<<< a', 'x', '=======', '>>>>>>> b'].join('\n') + '\n'
    const r = parsed(c)
    expect(applyConflictChoices(r, { 0: 'theirs' })).toBe('')
    expect(applyConflictChoices(r, { 0: 'ours' })).toBe('x\n')
  })

  it('範囲外の番号は Error を投げる', () => {
    const r = parsed(multi)
    expect(() => applyConflictChoices(r, { 2: 'ours' })).toThrow('ブロックの番号が範囲外です')
    expect(() => applyConflictChoices(r, { [-1]: 'ours' })).toThrow('ブロックの番号が範囲外です')
  })

  it.each([
    ['空のキー', ''],
    ['先頭ゼロ', '01'],
    ['小数', '0.5'],
    ['数値でない', 'abc']
  ])('正規の 10 進表記でないキー(%s)も範囲外として Error を投げる', (_n, key) => {
    const r = parsed(multi)
    expect(() =>
      applyConflictChoices(r, { [key]: 'ours' } as unknown as Record<number, 'ours'>)
    ).toThrow('ブロックの番号が範囲外です')
  })
})

// 改行コードは行ごとに元のまま保つ(多数派の 1 種へ揃えない)。マーカー行の改行は、
// 選んだ側の行の改行を変えない。ファイル末尾の改行の有無は元のとおりに保つ
describe('applyConflictChoices(行ごとの改行コードの保持)', () => {
  it('CRLF のファイルで最終行だけ LF のとき、ours を選んでも最終行は LF のまま', () => {
    const c = 'line1\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> b\r\nend\n'
    const r = parsed(c)
    expect(applyConflictChoices(r, {})).toBe(c)
    expect(applyConflictChoices(r, { 0: 'ours' })).toBe('line1\r\nmine\r\nend\n')
    expect(applyConflictChoices(r, { 0: 'theirs' })).toBe('line1\r\ntheirs\r\nend\n')
  })

  it('LF と CRLF が混在するファイルで、コンフリクトと無関係な行の改行を変えない', () => {
    const c = [
      'a\n',
      'b\r\n',
      '<<<<<<< HEAD\n',
      'o\n',
      '=======\n',
      't\n',
      '>>>>>>> br\n',
      'c\r\n',
      'd\r\n',
      'e\n'
    ].join('')
    const r = parsed(c)
    expect(applyConflictChoices(r, {})).toBe(c)
    expect(applyConflictChoices(r, { 0: 'ours' })).toBe('a\nb\r\no\nc\r\nd\r\ne\n')
  })

  it('未選択のブロックをマーカーごと書き戻すとき、マーカー行・基底の行の元の改行を保つ', () => {
    // 本文は CRLF、マーカー行(開始・基底・区切り・終了)と基底の行だけ LF
    const c = [
      'p1\r\n',
      'p2\r\n',
      'p3\r\n',
      'p4\r\n',
      'p5\r\n',
      'p6\r\n',
      'x\r\n',
      '<<<<<<< HEAD\n',
      'o\r\n',
      '||||||| base\n',
      'b\n',
      '=======\n',
      't\r\n',
      '>>>>>>> br\n',
      'y\r\n',
      '<<<<<<< HEAD\n',
      'o2\r\n',
      '=======\n',
      't2\r\n',
      '>>>>>>> br\n'
    ].join('')
    const r = parsed(c)
    expect(applyConflictChoices(r, {})).toBe(c)
    // 部分選択でも、残ったブロックは元のバイト列のまま
    expect(applyConflictChoices(r, { 0: 'ours' })).toBe(
      'p1\r\np2\r\np3\r\np4\r\np5\r\np6\r\nx\r\no\r\ny\r\n<<<<<<< HEAD\no2\r\n=======\nt2\r\n>>>>>>> br\n'
    )
    expect(applyConflictChoices(r, { 1: 'theirs' })).toBe(
      [
        'p1\r\np2\r\np3\r\np4\r\np5\r\np6\r\n',
        'x\r\n',
        '<<<<<<< HEAD\n',
        'o\r\n',
        '||||||| base\n',
        'b\n',
        '=======\n',
        't\r\n',
        '>>>>>>> br\n',
        'y\r\n',
        't2\r\n'
      ].join('')
    )
  })

  it('選んだ側の行は、その行の元の改行のまま出力する', () => {
    const c = '<<<<<<< HEAD\r\no1\r\no2\n=======\nt1\r\nt2\n>>>>>>> b\n'
    const r = parsed(c)
    expect(applyConflictChoices(r, { 0: 'ours' })).toBe('o1\r\no2\n')
    expect(applyConflictChoices(r, { 0: 'theirs' })).toBe('t1\r\nt2\n')
  })

  it('both では、自分の最終行と相手の先頭行の境界で改行が欠けも重なりもしない', () => {
    const c = 'x\n<<<<<<< HEAD\r\no\r\n=======\nt\n>>>>>>> b\ny\n'
    const r = parsed(c)
    expect(applyConflictChoices(r, { 0: 'both' })).toBe('x\no\r\nt\ny\n')
  })

  it.each([
    ['ours', 'a\nmine'],
    ['theirs', 'a\ntheirs'],
    ['both', 'a\nmine\ntheirs']
  ] as const)(
    '終了マーカーが最終行で改行が無いとき、%s を選んでも末尾に改行を足さない',
    (choice, expected) => {
      const c = 'a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b'
      const r = parsed(c)
      expect(applyConflictChoices(r, {})).toBe(c)
      expect(applyConflictChoices(r, { 0: choice })).toBe(expected)
    }
  )

  it('終了マーカーが最終行で改行が無く、選んだ側が空なら、直前の行の改行も除く(元と同じく改行なしで終わる)', () => {
    const r = parsed('a\r\n<<<<<<< HEAD\r\nmine\r\n=======\r\n>>>>>>> b')
    expect(applyConflictChoices(r, { 0: 'theirs' })).toBe('a')
  })

  it('最終行が本文で改行が無いとき、そのまま改行なしで終わる', () => {
    const c = '<<<<<<< HEAD\r\no\r\n=======\r\nt\r\n>>>>>>> b\r\nlast'
    const r = parsed(c)
    expect(applyConflictChoices(r, { 0: 'theirs' })).toBe('t\r\nlast')
  })

  it('digest は改行コードに依存しない(LF と CRLF で同じ値、行の内容に \\r を含めない)', () => {
    const lf = 'a\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> b\n'
    const crlf = lf.replace(/\n/g, '\r\n')
    const mixed = 'a\r\n<<<<<<< HEAD\nmine\r\n=======\ntheirs\r\n>>>>>>> b\n'
    const d = digestConflictBlocks(parsed(lf).segments)
    expect(digestConflictBlocks(parsed(crlf).segments)).toEqual(d)
    expect(digestConflictBlocks(parsed(mixed).segments)).toEqual(d)
  })
})

describe('hasConflictMarker', () => {
  it.each([
    ['開始(ラベルあり)', '<<<<<<< HEAD'],
    ['開始(ラベルなし)', '<<<<<<<'],
    ['基底(ラベルあり)', '||||||| base'],
    ['基底(ラベルなし)', '|||||||'],
    ['終了(ラベルあり)', '>>>>>>> feature'],
    ['終了(ラベルなし)', '>>>>>>>']
  ])('%s の行があれば true', (_n, line) => {
    expect(hasConflictMarker(`a\n${line}\nb\n`)).toBe(true)
  })

  it('CRLF の行でも検出する', () => {
    expect(hasConflictMarker('a\r\n>>>>>>> x\r\nb\r\n')).toBe(true)
  })

  it.each([
    ['区切り(=======)', '======='],
    ['6 文字', '<<<<<< x'],
    ['8 文字', '<<<<<<<< x'],
    ['8 文字(終了)', '>>>>>>>> x'],
    ['8 文字(基底)', '||||||||'],
    ['直後が空白でない', '<<<<<<<x'],
    ['インデント付き', '  <<<<<<< HEAD']
  ])('%s は本文として false', (_n, line) => {
    expect(hasConflictMarker(`a\n${line}\nb\n`)).toBe(false)
  })
})

describe('digestConflictBlocks', () => {
  const block = (o: string, t: string, base?: string[]): ConflictSegment => ({
    kind: 'conflict',
    ours: [o],
    theirs: [t],
    ...(base ? { base } : {}),
    oursLabel: 'HEAD',
    theirsLabel: 'b'
  })

  it('同じ内容で同じ値になる', () => {
    expect(digestConflictBlocks([block('a', 'b')])).toEqual(digestConflictBlocks([block('a', 'b')]))
  })

  it('自分側 1 文字の変更で値が変わる', () => {
    expect(digestConflictBlocks([block('a', 'b')])).not.toEqual(
      digestConflictBlocks([block('c', 'b')])
    )
  })

  it('相手側・base の変更でも値が変わる', () => {
    const d = digestConflictBlocks([block('a', 'b')])
    expect(digestConflictBlocks([block('a', 'c')])).not.toEqual(d)
    expect(digestConflictBlocks([block('a', 'b', ['x'])])).not.toEqual(d)
  })

  it('ours と theirs の境界の入れ替えで衝突しない', () => {
    const a: ConflictSegment = {
      kind: 'conflict',
      ours: ['a', 'b'],
      theirs: ['c'],
      oursLabel: '',
      theirsLabel: ''
    }
    const b: ConflictSegment = { ...a, ours: ['a'], theirs: ['b', 'c'] } as ConflictSegment
    expect(digestConflictBlocks([a])).not.toEqual(digestConflictBlocks([b]))
  })

  it('ブロックの順で並び、テキストは含まない', () => {
    const t: ConflictSegment = { kind: 'text', lines: ['x'] }
    const d = digestConflictBlocks([block('a', 'b'), t, block('c', 'd')])
    expect(d).toHaveLength(2)
    expect(d[0]).toBe(digestConflictBlocks([block('a', 'b')])[0])
    expect(d[1]).toBe(digestConflictBlocks([block('c', 'd')])[0])
    expect(d[0]).toMatch(/^[0-9a-f]{40}$/)
  })
})

// .gitattributes の conflict-marker-size=N のファイルでは、git は N 文字のマーカーを書く
describe('マーカーの長さ(conflict-marker-size)', () => {
  const block = (n: number, withLabels = true): string[] => [
    'a',
    '<'.repeat(n) + (withLabels ? ' HEAD' : ''),
    'mine',
    '='.repeat(n),
    'theirs',
    '>'.repeat(n) + (withLabels ? ' feature' : ''),
    'z',
    ''
  ]

  it.each([3, 7, 10])('サイズ %i のマーカーを解析し、ラベルを取り出す', (n) => {
    const r = parseConflictFile(block(n).join('\n'), n)
    expect(r?.segments).toEqual([
      { kind: 'text', lines: ['a'] },
      {
        kind: 'conflict',
        ours: ['mine'],
        theirs: ['theirs'],
        oursLabel: 'HEAD',
        theirsLabel: 'feature'
      },
      { kind: 'text', lines: ['z'] }
    ])
    expect(r?.markerSize).toBe(n)
  })

  it.each([3, 7, 10])('サイズ %i のラベルの無いマーカーも解析する', (n) => {
    const r = parseConflictFile(block(n, false).join('\n'), n)
    expect(r?.segments[1]).toEqual({
      kind: 'conflict',
      ours: ['mine'],
      theirs: ['theirs'],
      oursLabel: '',
      theirsLabel: ''
    })
  })

  it('省略時は 7 文字', () => {
    expect(parseConflictFile(block(7).join('\n'))?.markerSize).toBe(7)
    expect(parseConflictFile(block(10).join('\n'))?.segments).toEqual([
      { kind: 'text', lines: block(10).slice(0, -1) }
    ])
  })

  it('サイズ 10 のとき、7 文字のマーカーの行は本文として扱う', () => {
    const c = [
      '<<<<<<<<<< HEAD',
      '<<<<<<< x',
      '=======',
      '==========',
      '>>>>>>> y',
      '>>>>>>>>>> feature',
      ''
    ].join('\n')
    expect(parseConflictFile(c, 10)?.segments).toEqual([
      {
        kind: 'conflict',
        ours: ['<<<<<<< x', '======='],
        theirs: ['>>>>>>> y'],
        oursLabel: 'HEAD',
        theirsLabel: 'feature'
      }
    ])
  })

  it('サイズ 10 のとき、11 文字の行もマーカーではない', () => {
    const c = ['<<<<<<<<<<<', 'x', ''].join('\n')
    expect(parseConflictFile(c, 10)?.segments).toEqual([
      { kind: 'text', lines: ['<<<<<<<<<<<', 'x'] }
    ])
  })

  it('サイズ 10 の diff3 の基底マーカーを解析する', () => {
    const c = [
      '<<<<<<<<<< HEAD',
      'mine',
      '|||||||||| base',
      'orig',
      '==========',
      'theirs',
      '>>>>>>>>>> feature',
      ''
    ].join('\n')
    expect(parseConflictFile(c, 10)?.segments).toEqual([
      {
        kind: 'conflict',
        ours: ['mine'],
        base: ['orig'],
        baseLabel: 'base',
        theirs: ['theirs'],
        oursLabel: 'HEAD',
        theirsLabel: 'feature'
      }
    ])
  })

  it.each([3, 10])('サイズ %i の未選択のブロックを同じ長さのマーカーで書き戻す', (n) => {
    const c = [
      '<'.repeat(n) + ' HEAD',
      'mine',
      '|'.repeat(n) + ' base',
      'orig',
      '='.repeat(n),
      'theirs',
      '>'.repeat(n) + ' feature',
      '<'.repeat(n),
      'm2',
      '='.repeat(n),
      't2',
      '>'.repeat(n),
      ''
    ].join('\n')
    const r = parseConflictFile(c, n)
    if (!r) throw new Error('解析できませんでした')
    expect(applyConflictChoices(r, {})).toBe(c)
    expect(applyConflictChoices(r, { 0: 'theirs' })).toBe(
      ['theirs', '<'.repeat(n), 'm2', '='.repeat(n), 't2', '>'.repeat(n), ''].join('\n')
    )
  })

  it('hasConflictMarker はサイズごとにマーカーを判定する', () => {
    expect(hasConflictMarker('<<<<<<<<<< HEAD', 10)).toBe(true)
    expect(hasConflictMarker('|||||||||| base', 10)).toBe(true)
    expect(hasConflictMarker('>>>>>>>>>>', 10)).toBe(true)
    expect(hasConflictMarker('<<<<<<< HEAD', 10)).toBe(false)
    expect(hasConflictMarker('<<<<<<<<<< HEAD')).toBe(false)
    expect(hasConflictMarker('<<<<<<< HEAD')).toBe(true)
    expect(hasConflictMarker('<<< HEAD', 3)).toBe(true)
    expect(hasConflictMarker('<<<<<<< HEAD', 3)).toBe(false)
    expect(hasConflictMarker('==========', 10)).toBe(false)
  })
})
