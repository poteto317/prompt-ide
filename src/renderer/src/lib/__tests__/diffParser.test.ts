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
  ''
].join('\n')

describe('parseDiff', () => {
  it('ヘッダー行群とハンク群を正しく分割する', () => {
    const result = parseDiff(SAMPLE_DIFF)
    expect(result.headerLines).toEqual([
      'diff --git a/src/index.ts b/src/index.ts',
      'index abc123..def456 100644',
      '--- a/src/index.ts',
      '+++ b/src/index.ts'
    ])
    expect(result.hunks).toHaveLength(2)
    expect(result.hunks[0].header).toBe('@@ -1,3 +1,4 @@')
    expect(result.hunks[0].lines).toEqual([
      ' line1',
      '-line2',
      '+line2modified',
      '+line3new',
      ' line4'
    ])
    expect(result.hunks[1].header).toBe('@@ -10,2 +11,3 @@')
    expect(result.hunks[1].lines).toEqual([' line10', '+line11new', ' line12'])
  })

  it('コンフリクト中の combined diff(diff --cc / @@@)を検出する', () => {
    // 未解決コンフリクト(UU)のファイルは git diff が combined diff を返す。
    // これをハンクとして扱うと「このハンクをステージ」ボタンが出るが、
    // git apply --cached は必ず "No valid patches in input" で失敗する
    // (実機で再現確認済み)。ステータス列も 2 桁になるため行の色分けも逆転する
    const combined =
      'diff --cc f.txt\n' +
      'index db3c03a,797be14..0000000\n' +
      '--- a/f.txt\n' +
      '+++ b/f.txt\n' +
      '@@@ -1,3 -1,3 +1,7 @@@\n' +
      '  a\n' +
      '++<<<<<<< HEAD\n' +
      ' +Z\n'
    expect(parseDiff(combined).isCombined).toBe(true)
  })

  it('通常の diff では isCombined が false になる', () => {
    const normal = 'diff --git a/f.txt b/f.txt\n@@ -1 +1 @@\n-a\n+b\n'
    expect(parseDiff(normal).isCombined).toBe(false)
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
        ''
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

  it('リネームを伴う diff で複数ハンクのうち1つだけを取り出す場合、rename ヘッダーを含めず新パスに対する自己diffとして組み立てる', () => {
    // rename from/rename to ヘッダーを含めたまま1ハンクだけのパッチを
    // git apply --cached --reverse に渡すと、そのハンクの内容変更だけでなく
    // リネーム自体まで取り消されてしまう(実機で再現確認済み: RM old.txt ->
    // new.txt であるべきところが MD old.txt / ?? new.txt という壊れた状態になる)。
    // 新パス(new.txt)に対する自己diff(a/new.txt b/new.txt、rename ヘッダー無し)
    // に書き換えることで、リネーム自体は維持したまま該当ハンクだけを取り消せる
    const renameDiff = [
      'diff --git a/old.txt b/new.txt',
      'similarity index 84%',
      'rename from old.txt',
      'rename to new.txt',
      'index 4083766..2f86025 100644',
      '--- a/old.txt',
      '+++ b/new.txt',
      '@@ -1,4 +1,4 @@',
      '-line1',
      '+CHANGED1',
      ' line2',
      ' line3',
      ' line4',
      '@@ -7,4 +7,4 @@ line6',
      ' line7',
      ' line8',
      ' line9',
      '-line10',
      '+CHANGED10',
      ''
    ].join('\n')
    const parsed = parseDiff(renameDiff)
    const patch = buildHunkPatch(parsed, 0)
    expect(patch).toBe(
      [
        'diff --git a/new.txt b/new.txt',
        'index 4083766..2f86025 100644',
        '--- a/new.txt',
        '+++ b/new.txt',
        '@@ -1,4 +1,4 @@',
        '-line1',
        '+CHANGED1',
        ' line2',
        ' line3',
        ' line4',
        ''
      ].join('\n')
    )
    expect(patch).not.toContain('rename from')
    expect(patch).not.toContain('rename to')
    expect(patch).not.toContain('similarity index')
  })

  it('リネーム後の新パスがダブルクォートを含む場合、"+++ " 行の固定長 slice に頼らず自己diffを組み立てる', () => {
    // core.quotePath=false(gitService.ts)は非ASCII文字によるクォートは
    // 抑止するが、パスが literal な " や \ を含む場合、git は常にそのパスを
    // ダブルクォートで囲み C 形式でエスケープする(実機で再現確認済み:
    // `diff --git "a/file\"quote.txt" "b/file\"quote.txt"`)。
    // "+++ b/".length の固定長 slice でパスを取り出すと、実際には
    // `+++ "b/file\"quote.txt"` のようにクォートされた行から誤った文字列を
    // 切り出してしまう。中身をデコードせず、"+++ " 行に現れた b/ 側の表記
    // (クォート・エスケープを含む)をそのまま使い、"b/" → "a/" の置換だけで
    // diff --git / --- 行を組み立てる必要がある
    const renameDiff = [
      'diff --git "a/old.txt" "b/file\\"quote.txt"',
      'similarity index 84%',
      'rename from old.txt',
      'rename to "file\\"quote.txt"',
      'index 4083766..2f86025 100644',
      '--- "a/old.txt"',
      '+++ "b/file\\"quote.txt"',
      '@@ -1,1 +1,1 @@',
      '-line1',
      '+CHANGED1',
      ''
    ].join('\n')
    const parsed = parseDiff(renameDiff)
    const patch = buildHunkPatch(parsed, 0)
    expect(patch).toBe(
      [
        'diff --git "a/file\\"quote.txt" "b/file\\"quote.txt"',
        'index 4083766..2f86025 100644',
        '--- "a/file\\"quote.txt"',
        '+++ "b/file\\"quote.txt"',
        '@@ -1,1 +1,1 @@',
        '-line1',
        '+CHANGED1',
        ''
      ].join('\n')
    )
  })

  it('リネームを伴わない diff は、従来通りヘッダーをそのまま使う(自己diff書き換えの対象外)', () => {
    const parsed = parseDiff(SAMPLE_DIFF)
    const patch = buildHunkPatch(parsed, 0)
    expect(patch).toContain('diff --git a/src/index.ts b/src/index.ts')
  })
})
