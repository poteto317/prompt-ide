import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { OpenFile } from '../../types'
import type { LineSpan } from '../../lib/agentReferences'
import { AGENT_REFERENCE_DISABLED_REASONS } from '../../lib/agentReferenceMessages'
import { useAgentReferences } from '../useAgentReferences'
import type { AgentReferencesState, UseAgentReferencesOptions } from '../useAgentReferences'

const makeFile = (path: string, overrides: Partial<OpenFile> = {}): OpenFile => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  content: '本文',
  savedContent: '本文',
  language: 'typescript',
  ...overrides
})
const appTs = makeFile('/repo/src/app.ts')
const notesMd = makeFile('/repo/docs/notes.md')
const lines = (start: number, end: number): LineSpan => ({ startLine: start, endLine: end })

const baseOptions: UseAgentReferencesOptions = {
  folderPath: '/repo',
  isAgentMode: true,
  activeFile: appTs,
  isDiffTabActive: false,
  openFiles: [appTs, notesMd],
  selection: null
}

type Rendered = RenderHookResult<AgentReferencesState, UseAgentReferencesOptions>

const renderReferences = (overrides: Partial<UseAgentReferencesOptions> = {}): Rendered =>
  renderHook((props: UseAgentReferencesOptions) => useAgentReferences(props), {
    initialProps: { ...baseOptions, ...overrides }
  })

// panel が null でないことを確かめて返す
const panelOf = (result: Rendered['result']): NonNullable<AgentReferencesState['panel']> => {
  const { panel } = result.current
  if (panel === null) throw new Error('panel is null')
  return panel
}

describe('useAgentReferences: 出す条件', () => {
  it.each([
    ['従来の方式', { isAgentMode: false }],
    ['フォルダを開いていない', { folderPath: null }]
  ])('%s では参照の行を出さず、参照を足さない', (_label, overrides) => {
    const { result } = renderReferences(overrides)
    expect(result.current.panel).toBeNull()
    expect(result.current.prepare()).toEqual({ references: [], unsavedPaths: [], addedPaths: [] })
  })
})

describe('useAgentReferences: 開いているファイル', () => {
  it('アクティブな実ファイルの相対パスを出し、押すとオン・オフし、オンなら参照に入る', () => {
    const { result } = renderReferences()
    expect(panelOf(result).openFile).toMatchObject({
      label: '@src/app.ts',
      disabledReason: null,
      pressed: false,
      unsaved: false
    })
    expect(result.current.prepare().references).toEqual([])
    act(() => panelOf(result).openFile.onToggle())
    expect(panelOf(result).openFile.pressed).toBe(true)
    expect(result.current.prepare().references).toEqual([{ path: 'src/app.ts', lineRange: null }])
    act(() => panelOf(result).openFile.onToggle())
    expect(panelOf(result).openFile.pressed).toBe(false)
  })

  it('アクティブなタブが変わると中身が追従し、オンのまま', () => {
    const { result, rerender } = renderReferences()
    act(() => panelOf(result).openFile.onToggle())
    rerender({ ...baseOptions, activeFile: notesMd })
    expect(panelOf(result).openFile).toMatchObject({ label: '@docs/notes.md', pressed: true })
    expect(result.current.prepare().references).toEqual([
      { path: 'docs/notes.md', lineRange: null }
    ])
  })

  it.each([
    ['タブが無い', { activeFile: null }, AGENT_REFERENCE_DISABLED_REASONS.noOpenFile],
    ['差分のタブ', { isDiffTabActive: true }, AGENT_REFERENCE_DISABLED_REASONS.diffTab],
    [
      'フォルダの外のファイル',
      { activeFile: makeFile('/other/a.ts') },
      AGENT_REFERENCE_DISABLED_REASONS.outsideFolder
    ]
  ])('%s なら押せず理由を出し、オンにしてあっても参照に入れない', (_label, overrides, reason) => {
    const { result, rerender } = renderReferences()
    act(() => panelOf(result).openFile.onToggle())
    rerender({ ...baseOptions, ...overrides })
    expect(panelOf(result).openFile).toMatchObject({
      label: null,
      disabledReason: reason,
      pressed: true,
      unsaved: false
    })
    expect(result.current.prepare().references).toEqual([])
  })
})

describe('useAgentReferences: 選択範囲', () => {
  it('空でない選択を `@パス#L開始-終了` で出し、オンなら参照に入る。選択が変わると追従する', () => {
    const { result, rerender } = renderReferences({
      selection: { filePath: appTs.path, ...lines(10, 20) }
    })
    expect(panelOf(result).selection).toMatchObject({
      label: '@src/app.ts#L10-20',
      disabledReason: null,
      pressed: false
    })
    act(() => panelOf(result).selection.onToggle())
    rerender({ ...baseOptions, selection: { filePath: appTs.path, ...lines(3, 3) } })
    expect(panelOf(result).selection).toMatchObject({ label: '@src/app.ts#L3', pressed: true })
    expect(result.current.prepare().references).toEqual([{ path: 'src/app.ts', lineRange: '#L3' }])
  })

  it('選択が無ければ押せず、理由を出す', () => {
    const { result } = renderReferences()
    expect(panelOf(result).selection).toMatchObject({
      label: null,
      disabledReason: AGENT_REFERENCE_DISABLED_REASONS.noSelection
    })
  })

  it('差分のタブがアクティブなら、選択範囲のチップも差分のタブの理由で押せず、オンでも参照に入れない', () => {
    const { result, rerender } = renderReferences({
      selection: { filePath: appTs.path, ...lines(10, 20) }
    })
    act(() => panelOf(result).selection.onToggle())
    rerender({ ...baseOptions, isDiffTabActive: true, selection: null })
    expect(panelOf(result).selection).toMatchObject({
      label: null,
      disabledReason: AGENT_REFERENCE_DISABLED_REASONS.diffTab,
      pressed: true
    })
    expect(result.current.prepare().references).toEqual([])
  })

  it('フォルダの外のファイルの選択は押せない', () => {
    const { result } = renderReferences({
      selection: { filePath: '/other/a.ts', ...lines(1, 2) }
    })
    expect(panelOf(result).selection.disabledReason).toBe(
      AGENT_REFERENCE_DISABLED_REASONS.outsideFolder
    )
  })

  it('開いているファイルと同じファイルの選択は、ファイル全体の後に別の参照として入る', () => {
    const { result } = renderReferences({
      selection: { filePath: appTs.path, ...lines(10, 20) }
    })
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).selection.onToggle()
    })
    expect(result.current.prepare().references).toEqual([
      { path: 'src/app.ts', lineRange: null },
      { path: 'src/app.ts', lineRange: '#L10-20' }
    ])
  })
})

describe('useAgentReferences: エクスプローラから足したファイル', () => {
  it('足すと末尾に加えて読み上げの文言を出し、同じファイルはもう一度足しても何もしない', () => {
    const { result } = renderReferences()
    act(() => panelOf(result).onAddFromExplorer('/repo/docs/notes.md'))
    expect(panelOf(result).added).toEqual([
      { path: '/repo/docs/notes.md', label: '@docs/notes.md', unsaved: false }
    ])
    expect(result.current.announcement).toEqual({
      id: 1,
      text: '参照に @docs/notes.md を足しました'
    })
    act(() => panelOf(result).onAddFromExplorer('/repo/docs/notes.md'))
    expect(panelOf(result).added).toHaveLength(1)
    expect(result.current.announcement?.id).toBe(1)
    act(() => panelOf(result).onAddFromExplorer('/repo/src/app.ts'))
    expect(panelOf(result).added.map((item) => item.label)).toEqual([
      '@docs/notes.md',
      '@src/app.ts'
    ])
    expect(result.current.announcement).toEqual({ id: 2, text: '参照に @src/app.ts を足しました' })
    expect(result.current.prepare()).toMatchObject({
      references: [
        { path: 'docs/notes.md', lineRange: null },
        { path: 'src/app.ts', lineRange: null }
      ],
      addedPaths: ['/repo/docs/notes.md', '/repo/src/app.ts']
    })
  })

  it('フォルダの外のファイルは足さない', () => {
    const { result } = renderReferences()
    act(() => panelOf(result).onAddFromExplorer('/other/a.ts'))
    expect(panelOf(result).added).toEqual([])
    expect(result.current.announcement).toBeNull()
  })

  it('外すと一覧から消える', () => {
    const { result } = renderReferences()
    act(() => panelOf(result).onAddFromExplorer('/repo/docs/notes.md'))
    act(() => panelOf(result).onRemove('/repo/docs/notes.md'))
    expect(panelOf(result).added).toEqual([])
  })
})

describe('useAgentReferences: 後始末', () => {
  it('送れたら(markSent)、写しを取った時点のエクスプローラのファイルだけ外し、後から足したもの・チップのオンは残す', () => {
    const { result } = renderReferences()
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
    })
    const prepared = result.current.prepare()
    // 確認を開いている間に足したもの
    act(() => panelOf(result).onAddFromExplorer('/repo/src/app.ts'))
    act(() => result.current.markSent(prepared))
    expect(panelOf(result).added.map((item) => item.path)).toEqual(['/repo/src/app.ts'])
    expect(panelOf(result).openFile.pressed).toBe(true)
  })

  it('フォルダを切り替えたら、足したファイルを外し、チップをオフに戻す(L-405)', () => {
    const { result, rerender } = renderReferences({
      selection: { filePath: appTs.path, ...lines(1, 2) }
    })
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).selection.onToggle()
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
    })
    rerender({
      ...baseOptions,
      folderPath: '/next',
      activeFile: makeFile('/next/a.ts'),
      openFiles: []
    })
    expect(panelOf(result).openFile.pressed).toBe(false)
    expect(panelOf(result).selection.pressed).toBe(false)
    expect(panelOf(result).added).toEqual([])
    // 元のフォルダへ戻っても、足したファイルは復活しない(切り替えのときに状態そのものを空にしている)
    rerender({ ...baseOptions, folderPath: '/repo' })
    expect(panelOf(result).added).toEqual([])
  })

  it('従来の方式へ切り替えたら行を隠し、エージェント CLI 方式へ戻してもオフ・足したファイル無しのまま', () => {
    const { result, rerender } = renderReferences()
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
    })
    rerender({ ...baseOptions, isAgentMode: false })
    expect(result.current.panel).toBeNull()
    rerender({ ...baseOptions, isAgentMode: true })
    expect(panelOf(result).openFile.pressed).toBe(false)
    expect(panelOf(result).added).toEqual([])
  })
})

describe('useAgentReferences: 未保存の判定', () => {
  const dirtyApp = makeFile('/repo/src/app.ts', { content: '編集中' })

  it('オンにした開いているファイルに未保存の変更があれば、印を付けて未保存の一覧に入れる(オフなら入れない)', () => {
    const { result } = renderReferences({ activeFile: dirtyApp, openFiles: [dirtyApp] })
    expect(panelOf(result).openFile.unsaved).toBe(false)
    expect(result.current.prepare().unsavedPaths).toEqual([])
    act(() => panelOf(result).openFile.onToggle())
    expect(panelOf(result).openFile.unsaved).toBe(true)
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
  })

  it('選択範囲のファイルは、選択のパスのタブの内容で判定し、開いているファイルと同じなら 1 回だけ入れる', () => {
    const { result } = renderReferences({
      activeFile: dirtyApp,
      openFiles: [dirtyApp, notesMd],
      selection: { filePath: dirtyApp.path, ...lines(1, 2) }
    })
    act(() => panelOf(result).selection.onToggle())
    expect(panelOf(result).selection.unsaved).toBe(true)
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
    act(() => panelOf(result).openFile.onToggle())
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
  })

  it('エクスプローラから足したファイルも、タブの内容が未保存なら印を付けて未保存の一覧に入れる', () => {
    const dirtyNotes = makeFile('/repo/docs/notes.md', { content: '編集中' })
    // 足したファイルはアクティブでないタブ(開いているファイルのチップでは添えていない)
    const { result } = renderReferences({ activeFile: appTs, openFiles: [appTs, dirtyNotes] })
    act(() => {
      panelOf(result).onAddFromExplorer('/repo/docs/notes.md')
      panelOf(result).onAddFromExplorer('/repo/src/app.ts')
    })
    expect(panelOf(result).added).toEqual([
      { path: '/repo/docs/notes.md', label: '@docs/notes.md', unsaved: true },
      { path: '/repo/src/app.ts', label: '@src/app.ts', unsaved: false }
    ])
    expect(result.current.prepare().unsavedPaths).toEqual(['docs/notes.md'])
  })

  it('足したファイルが開いているファイル・選択範囲と同じなら、未保存の一覧には 1 回だけ入れる', () => {
    const { result } = renderReferences({
      activeFile: dirtyApp,
      openFiles: [dirtyApp],
      selection: { filePath: dirtyApp.path, ...lines(1, 2) }
    })
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).selection.onToggle()
      panelOf(result).onAddFromExplorer('/repo/src/app.ts')
    })
    expect(result.current.prepare().unsavedPaths).toEqual(['src/app.ts'])
  })

  it('保存すれば(content と savedContent が同じ)印を外す', () => {
    const { result, rerender } = renderReferences({ activeFile: dirtyApp, openFiles: [dirtyApp] })
    act(() => panelOf(result).openFile.onToggle())
    rerender({ ...baseOptions, activeFile: appTs, openFiles: [appTs] })
    expect(panelOf(result).openFile.unsaved).toBe(false)
  })
})

describe('useAgentReferences: Windows のパスの表記の違い', () => {
  // 大文字小文字だけの改名の後に古い表記のタブが残っている、など(同じファイルを指す)
  const appUpper = makeFile('C:\\proj\\src\\App.ts', { content: '編集中' })
  const windowsOptions: Partial<UseAgentReferencesOptions> = {
    folderPath: 'C:\\proj',
    activeFile: appUpper,
    openFiles: [appUpper]
  }

  it('開いているファイルとエクスプローラから足したファイルが大文字小文字だけ違っても、参照と未保存の一覧は 1 回にまとめる', () => {
    const { result } = renderReferences(windowsOptions)
    act(() => {
      panelOf(result).openFile.onToggle()
      panelOf(result).onAddFromExplorer('C:\\proj\\src\\app.ts')
    })
    expect(result.current.prepare()).toMatchObject({
      references: [{ path: 'src/App.ts', lineRange: null }],
      unsavedPaths: ['src/App.ts']
    })
    // 足したファイルのチップにも、同じタブの未保存の印が付く
    expect(panelOf(result).added).toEqual([
      { path: 'C:\\proj\\src\\app.ts', label: '@src/app.ts', unsaved: true }
    ])
  })

  it('選択範囲と足したファイルが大文字小文字だけ違っても、ファイル全体を選択範囲より先に出す', () => {
    const { result } = renderReferences({
      ...windowsOptions,
      selection: { filePath: appUpper.path, ...lines(10, 20) }
    })
    act(() => {
      panelOf(result).selection.onToggle()
      panelOf(result).onAddFromExplorer('C:\\proj\\docs\\a.md')
      panelOf(result).onAddFromExplorer('C:\\proj\\src\\app.ts')
    })
    expect(result.current.prepare().references).toEqual([
      { path: 'src/app.ts', lineRange: null },
      { path: 'src/App.ts', lineRange: '#L10-20' },
      { path: 'docs/a.md', lineRange: null }
    ])
  })
})

describe('useAgentReferences: prepare の参照', () => {
  // usePromptRunner の useCallback の依存に入るため
  it('prepare・markSent は描画をまたいで同じ参照で、prepare は最新の状態を返す', () => {
    const { result } = renderReferences()
    const { prepare, markSent } = result.current
    act(() => panelOf(result).openFile.onToggle())
    expect(result.current.prepare).toBe(prepare)
    expect(result.current.markSent).toBe(markSent)
    expect(prepare().references).toEqual([{ path: 'src/app.ts', lineRange: null }])
  })
})
