import { describe, it, expect, vi } from 'vitest'
import type { OpenFile } from '../../types'
import type { EditorLineSelection } from '../agentReferences'
import { AGENT_REFERENCE_DISABLED_REASONS } from '../agentReferenceMessages'
import {
  buildPreparedAgentReferences,
  resolveAddedReferences,
  resolveOpenFileCandidate,
  resolveSelectionCandidate,
  toAgentAddedReference,
  toAgentReferenceChip
} from '../agentReferenceCandidates'
import type { AgentReferenceCandidate, ResolvedAddedReference } from '../agentReferenceCandidates'

const makeFile = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  content: '本文',
  savedContent: '本文',
  language: 'typescript',
  ...overrides
})
const appTs = makeFile('/repo/src/app.ts')
const dirtyAppTs = makeFile('/repo/src/app.ts', { content: '変更' })
const selectionOf = (filePath: string, start: number, end: number): EditorLineSelection => ({
  filePath,
  startLine: start,
  endLine: end
})
// key は既定で '/repo' の中のそのファイル(toComparablePath の値)
const available = (
  path: string,
  lineRange: string | null,
  unsaved = false,
  key = `posix:/repo/${path}`
): AgentReferenceCandidate => ({
  kind: 'available',
  reference: { path, lineRange },
  unsaved,
  key
})
const unavailable: AgentReferenceCandidate = { kind: 'unavailable', reason: 'noSelection' }

describe('resolveOpenFileCandidate', () => {
  it('差分のタブの表示中は、ファイルがあっても押せない', () => {
    expect(resolveOpenFileCandidate('/repo', appTs, true)).toEqual({
      kind: 'unavailable',
      reason: 'diffTab'
    })
  })

  it('ファイルが無い・フォルダの外なら、それぞれの理由で押せない', () => {
    expect(resolveOpenFileCandidate('/repo', null, false)).toEqual({
      kind: 'unavailable',
      reason: 'noOpenFile'
    })
    expect(resolveOpenFileCandidate('/repo', makeFile('/other/a.ts'), false)).toEqual({
      kind: 'unavailable',
      reason: 'outsideFolder'
    })
  })

  it('フォルダの中なら相対パスのファイル全体の参照で、未保存かを content と savedContent で判定する', () => {
    expect(resolveOpenFileCandidate('/repo', appTs, false)).toEqual(available('src/app.ts', null))
    expect(resolveOpenFileCandidate('/repo', dirtyAppTs, false)).toEqual(
      available('src/app.ts', null, true)
    )
  })
})

describe('resolveSelectionCandidate', () => {
  it('差分のタブなら、選択の有無に関係なく diffTab の理由で押せない(差分の表示では範囲を選んでも添えられない)', () => {
    expect(resolveSelectionCandidate('/repo', null, true, [appTs])).toEqual({
      kind: 'unavailable',
      reason: 'diffTab'
    })
    expect(
      resolveSelectionCandidate('/repo', selectionOf('/repo/src/app.ts', 1, 2), true, [appTs])
    ).toEqual({ kind: 'unavailable', reason: 'diffTab' })
  })

  it('選択が無い・フォルダの外なら、それぞれの理由で押せない', () => {
    expect(resolveSelectionCandidate('/repo', null, false, [appTs])).toEqual({
      kind: 'unavailable',
      reason: 'noSelection'
    })
    expect(resolveSelectionCandidate('/repo', selectionOf('/other/a.ts', 1, 2), false, [])).toEqual(
      {
        kind: 'unavailable',
        reason: 'outsideFolder'
      }
    )
  })

  it('行の範囲付きの参照で、未保存かは選択のパスのタブで判定する(タブが無ければ未保存ではない)', () => {
    const selection = selectionOf('/repo/src/app.ts', 10, 20)
    expect(resolveSelectionCandidate('/repo', selection, false, [dirtyAppTs])).toEqual(
      available('src/app.ts', '#L10-20', true)
    )
    expect(resolveSelectionCandidate('/repo', selection, false, [])).toEqual(
      available('src/app.ts', '#L10-20', false)
    )
  })
})

describe('resolveAddedReferences', () => {
  it('足した順に相対パスの参照へ変え、フォルダの外のものは落とす', () => {
    expect(
      resolveAddedReferences('/repo', ['/repo/docs/b.md', '/other/x.md', '/repo/a.md'], [])
    ).toEqual([
      {
        absolutePath: '/repo/docs/b.md',
        reference: { path: 'docs/b.md', lineRange: null },
        unsaved: false
      },
      { absolutePath: '/repo/a.md', reference: { path: 'a.md', lineRange: null }, unsaved: false }
    ])
  })

  it('未保存かは、そのファイルのタブの内容で判定する(タブが無ければ未保存ではない)', () => {
    const dirtyNotes = makeFile('/repo/docs/notes.md', { content: '変更' })
    expect(
      resolveAddedReferences(
        '/repo',
        ['/repo/docs/notes.md', '/repo/src/app.ts', '/repo/a.md'],
        [dirtyNotes, appTs]
      ).map((item) => item.unsaved)
    ).toEqual([true, false, false])
  })

  it('Windows ではタブのパスと大文字小文字・区切りが違っても同じファイルのタブで判定する', () => {
    const dirty = makeFile('C:\\Proj\\Docs\\Notes.md', { content: '変更' })
    expect(
      resolveAddedReferences('C:\\Proj', ['c:/proj/docs/notes.md'], [dirty]).map(
        (item) => item.unsaved
      )
    ).toEqual([true])
  })
})

describe('toAgentAddedReference', () => {
  it('絶対パスを外すときの識別子に、参照を出す名前にし、未保存かを引き継ぐ', () => {
    expect(
      toAgentAddedReference({
        absolutePath: '/repo/docs/notes.md',
        reference: { path: 'docs/notes.md', lineRange: null },
        unsaved: true
      })
    ).toEqual({ path: '/repo/docs/notes.md', label: '@docs/notes.md', unsaved: true })
  })

  it('Windows の絶対パスも、表記を変えずに識別子として保つ', () => {
    expect(
      toAgentAddedReference({
        absolutePath: 'C:\\repo\\docs\\notes.md',
        reference: { path: 'docs/notes.md', lineRange: null },
        unsaved: false
      })
    ).toEqual({ path: 'C:\\repo\\docs\\notes.md', label: '@docs/notes.md', unsaved: false })
  })
})

describe('toAgentReferenceChip', () => {
  it('押せる候補は参照を名前にし、未保存の印はオンのときだけ付ける', () => {
    const onToggle = vi.fn()
    const candidate = available('src/app.ts', '#L3', true)
    expect(toAgentReferenceChip(candidate, false, onToggle)).toEqual({
      label: '@src/app.ts#L3',
      disabledReason: null,
      pressed: false,
      unsaved: false,
      onToggle
    })
    expect(toAgentReferenceChip(candidate, true, onToggle).unsaved).toBe(true)
  })

  it('押せない候補は名前を null にし、理由を出す(オンの状態は保つ)', () => {
    const onToggle = vi.fn()
    expect(toAgentReferenceChip(unavailable, true, onToggle)).toEqual({
      label: null,
      disabledReason: AGENT_REFERENCE_DISABLED_REASONS.noSelection,
      pressed: true,
      unsaved: false,
      onToggle
    })
  })

  it.each(['noOpenFile', 'diffTab', 'outsideFolder', 'noSelection'] as const)(
    '理由の種類 %s は、その文言を押せない理由として出す',
    (reason) => {
      const chip = toAgentReferenceChip({ kind: 'unavailable', reason }, false, vi.fn())
      expect(chip.disabledReason).toBe(AGENT_REFERENCE_DISABLED_REASONS[reason])
    }
  )
})

describe('buildPreparedAgentReferences', () => {
  const addedOf = (
    absolutePath: string,
    path: string,
    unsaved = false
  ): ResolvedAddedReference => ({
    absolutePath,
    reference: { path, lineRange: null },
    unsaved
  })
  const added = [addedOf('/repo/docs/n.md', 'docs/n.md')]

  it('オフのチップ・押せないチップは参照に入れず、足したファイルは常に入れる', () => {
    expect(
      buildPreparedAgentReferences({
        openFile: available('src/app.ts', null),
        includeOpenFile: false,
        selection: unavailable,
        includeSelection: true,
        added
      })
    ).toEqual({
      references: [{ path: 'docs/n.md', lineRange: null }],
      unsavedPaths: [],
      addedPaths: ['/repo/docs/n.md']
    })
  })

  it('オンのチップを開いているファイル → 選択範囲 → 足したファイルの順に入れ、未保存のパスは 1 回だけ入れる', () => {
    expect(
      buildPreparedAgentReferences({
        openFile: available('src/app.ts', null, true),
        includeOpenFile: true,
        selection: available('src/app.ts', '#L1-2', true),
        includeSelection: true,
        added
      })
    ).toEqual({
      references: [
        { path: 'src/app.ts', lineRange: null },
        { path: 'src/app.ts', lineRange: '#L1-2' },
        { path: 'docs/n.md', lineRange: null }
      ],
      unsavedPaths: ['src/app.ts'],
      addedPaths: ['/repo/docs/n.md']
    })
  })

  it('足したファイルの未保存も一覧に入れ、開いているファイル・選択範囲と同じファイルは 1 回にまとめる', () => {
    expect(
      buildPreparedAgentReferences({
        openFile: available('src/app.ts', null, true),
        includeOpenFile: true,
        selection: unavailable,
        includeSelection: false,
        added: [
          addedOf('/repo/docs/n.md', 'docs/n.md', true),
          addedOf('/repo/src/app.ts', 'src/app.ts', true),
          addedOf('/repo/docs/saved.md', 'docs/saved.md')
        ]
      }).unsavedPaths
    ).toEqual(['src/app.ts', 'docs/n.md'])
  })

  it('Windows で大文字小文字だけ違う同じファイルは、参照も未保存の一覧も 1 回にまとめ、ファイル全体を先に出す', () => {
    const key = 'windows:c:/proj/src/app.ts'
    expect(
      buildPreparedAgentReferences({
        openFile: available('src/App.ts', null, true, key),
        includeOpenFile: true,
        selection: unavailable,
        includeSelection: false,
        added: [addedOf('C:\\proj\\src\\app.ts', 'src/app.ts', true)]
      })
    ).toEqual({
      references: [{ path: 'src/App.ts', lineRange: null }],
      unsavedPaths: ['src/App.ts'],
      addedPaths: ['C:\\proj\\src\\app.ts']
    })
    expect(
      buildPreparedAgentReferences({
        openFile: unavailable,
        includeOpenFile: false,
        selection: available('src/App.ts', '#L3', false, key),
        includeSelection: true,
        added: [addedOf('C:\\proj\\src\\app.ts', 'src/app.ts')]
      }).references
    ).toEqual([
      { path: 'src/app.ts', lineRange: null },
      { path: 'src/App.ts', lineRange: '#L3' }
    ])
  })
})
