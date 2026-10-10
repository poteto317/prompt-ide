import { describe, it, expect } from 'vitest'
import {
  appendAgentReferences,
  buildAgentReferenceList,
  formatAgentReference,
  formatLineSpan,
  toLineSpan,
  toWorkspaceRelativePath
} from '../agentReferences'
import type { AgentReference, AgentReferenceSource, KeyedAgentReference } from '../agentReferences'

const whole = (path: string): AgentReference => ({ path, lineRange: null })
const ranged = (path: string, lineRange: string): AgentReference => ({ path, lineRange })

describe('toWorkspaceRelativePath', () => {
  it.each([
    ['フォルダの直下', '/repo', '/repo/a.ts', 'a.ts'],
    ['深い階層', '/repo', '/repo/src/lib/util.ts', 'src/lib/util.ts'],
    ['フォルダの末尾の区切り', '/repo/', '/repo/src/a.ts', 'src/a.ts'],
    ['Windows の区切りは / にそろえる', 'C:\\Proj', 'C:\\Proj\\src\\a.ts', 'src/a.ts'],
    [
      'Windows の大文字小文字の違いと末尾の区切り(ファイルの表記のまま)',
      'C:\\Proj\\',
      'c:\\proj\\src\\A.ts',
      'src/A.ts'
    ],
    ['POSIX のファイル名の \\ は変えない', '/repo', '/repo/dir\\name.ts', 'dir\\name.ts'],
    // Windows のドライブ・UNC の共有のルートは参照にできる(POSIX のルートは既知の制約で null。下の null の側を参照)。
    // 正規化したフォルダの長さで切り出すため、先頭の 1 文字が欠けないことを固定する
    ['Windows のドライブのルート', 'C:\\', 'C:\\a.ts', 'a.ts'],
    ['Windows のドライブのルートの深い階層', 'C:\\', 'C:\\src\\a.ts', 'src/a.ts'],
    ['UNC の共有のルート', '\\\\server\\share\\', '\\\\server\\share\\a.ts', 'a.ts'],
    [
      'UNC の共有のルートの深い階層',
      '\\\\server\\share\\',
      '\\\\server\\share\\src\\a.ts',
      'src/a.ts'
    ]
  ])('%s', (_label, folderPath, filePath, expected) => {
    expect(toWorkspaceRelativePath(folderPath, filePath)).toBe(expected)
  })

  it.each([
    ['フォルダの外', '/repo', '/other/a.ts'],
    ['名前が前方一致するだけの別のフォルダ', '/repo', '/repository/a.ts'],
    ['フォルダそのもの', '/repo', '/repo'],
    ['POSIX のルートを開いたとき(既知の制約)', '/', '/a.ts']
  ])('%s は null', (_label, folderPath, filePath) => {
    expect(toWorkspaceRelativePath(folderPath, filePath)).toBeNull()
  })
})

describe('toLineSpan と formatLineSpan(選択の行の範囲の表記)', () => {
  it.each([
    ['複数行', { startLineNumber: 10, startColumn: 3, endLineNumber: 20, endColumn: 5 }, '#L10-20'],
    ['1 行の中', { startLineNumber: 10, startColumn: 3, endLineNumber: 10, endColumn: 8 }, '#L10'],
    [
      '終わりが列 1 なら、その行は含めない',
      { startLineNumber: 10, startColumn: 1, endLineNumber: 13, endColumn: 1 },
      '#L10-12'
    ],
    [
      '1 行を丸ごと選んだ(次の行の列 1 まで)',
      { startLineNumber: 10, startColumn: 1, endLineNumber: 11, endColumn: 1 },
      '#L10'
    ]
  ])('%s', (_label, selection, expected) => {
    expect(formatLineSpan(toLineSpan(selection))).toBe(expected)
  })
})

describe('formatAgentReference', () => {
  it('パスの前に @、直後に行の範囲を空白なしで付ける', () => {
    expect(formatAgentReference(whole('src/a.ts'))).toBe('@src/a.ts')
    expect(formatAgentReference(ranged('src/a.ts', '#L1-2'))).toBe('@src/a.ts#L1-2')
  })
})

describe('buildAgentReferenceList', () => {
  // 比べるためのキー(既定は相対パスそのもの。同じファイルの表記違いはキーを揃えて表す)
  const src = (path: string, key = path): AgentReferenceSource => ({ path, key })
  const sel = (path: string, lineRange: string, key = path): KeyedAgentReference => ({
    path,
    lineRange,
    key
  })

  it('開いているファイル → 選択範囲 → エクスプローラから足した順に並べる', () => {
    expect(
      buildAgentReferenceList({
        openFile: src('src/app.ts'),
        selection: sel('src/util.ts', '#L10-20'),
        added: [src('docs/notes.md'), src('docs/b.md')]
      })
    ).toEqual([
      whole('src/app.ts'),
      ranged('src/util.ts', '#L10-20'),
      whole('docs/notes.md'),
      whole('docs/b.md')
    ])
  })

  it('同じ参照は 1 回にまとめる', () => {
    expect(
      buildAgentReferenceList({
        openFile: src('src/app.ts'),
        selection: null,
        added: [src('src/app.ts'), src('docs/a.md'), src('docs/a.md')]
      })
    ).toEqual([whole('src/app.ts'), whole('docs/a.md')])
  })

  it('同じファイルの全体と選択範囲は別の参照として両方出す(ファイル全体を先に)', () => {
    expect(
      buildAgentReferenceList({
        openFile: src('src/app.ts'),
        selection: sel('src/app.ts', '#L10'),
        added: []
      })
    ).toEqual([whole('src/app.ts'), ranged('src/app.ts', '#L10')])
    // 全体の参照がエクスプローラから足されていても、選択範囲より先に出す
    expect(
      buildAgentReferenceList({
        openFile: null,
        selection: sel('src/app.ts', '#L10'),
        added: [src('docs/a.md'), src('src/app.ts')]
      })
    ).toEqual([whole('src/app.ts'), ranged('src/app.ts', '#L10'), whole('docs/a.md')])
  })

  it('同じファイルかは相対パスの文字列ではなくキーで比べる(Windows の大文字小文字違い。先に出た表記を使う)', () => {
    const key = 'windows:c:/proj/src/app.ts'
    expect(
      buildAgentReferenceList({
        openFile: src('src/App.ts', key),
        selection: null,
        added: [src('src/app.ts', key)]
      })
    ).toEqual([whole('src/App.ts')])
    expect(
      buildAgentReferenceList({
        openFile: null,
        selection: sel('src/App.ts', '#L10', key),
        added: [src('docs/a.md'), src('src/app.ts', key)]
      })
    ).toEqual([whole('src/app.ts'), ranged('src/App.ts', '#L10'), whole('docs/a.md')])
  })

  it('キーが違えば、相対パスが同じ文字列でも別の参照として出す', () => {
    expect(
      buildAgentReferenceList({
        openFile: src('src/a.ts', 'posix:/repo/src/a.ts'),
        selection: null,
        added: [src('src/a.ts', 'posix:/repo/src/A.ts')]
      })
    ).toHaveLength(2)
  })

  it('何も無ければ空', () => {
    expect(buildAgentReferenceList({ openFile: null, selection: null, added: [] })).toEqual([])
  })
})

describe('appendAgentReferences', () => {
  it('参照が無ければ本文のまま(末尾の改行も変えない)', () => {
    expect(appendAgentReferences('本文\n', [])).toBe('本文\n')
  })

  it('本文の後に空行を 1 つ挟んで、参照: と - @… の行を足す', () => {
    expect(appendAgentReferences('本文', [whole('src/app.ts')])).toBe(
      '本文\n\n参照:\n- @src/app.ts'
    )
  })

  it('複数の参照を並べ、本文の末尾の改行は落としてから空行を 1 つだけ挟む', () => {
    expect(
      appendAgentReferences('本文\r\n\n', [whole('src/a.ts'), ranged('src/a.ts', '#L1-2')])
    ).toBe('本文\n\n参照:\n- @src/a.ts\n- @src/a.ts#L1-2')
  })

  it('本文が空なら参照の一覧だけ', () => {
    expect(appendAgentReferences('', [whole('a.ts')])).toBe('参照:\n- @a.ts')
  })
})
