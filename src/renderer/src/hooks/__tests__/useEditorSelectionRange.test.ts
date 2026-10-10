import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEditorSelectionRange } from '../useEditorSelectionRange'
import type { EditorSelectionRangeState } from '../useEditorSelectionRange'
import {
  collapsedSelection,
  makeFakeTrackedEditor,
  selectionOf
} from '../../__tests__/makeFakeApplyEditor'

// 偽のエディタ(makeFakeTrackedEditor)は、選択の変更・破棄の通知をテストから起こせる。購読の数(listenerCount)で解除を確かめる
const APP = '/repo/src/app.ts'
const NOTES = '/repo/docs/notes.md'
const lines10to20 = selectionOf(10, 3, 20, 5, 20, 5)

const renderSelection = (): RenderHookResult<EditorSelectionRangeState, unknown> =>
  renderHook(() => useEditorSelectionRange())

describe('useEditorSelectionRange', () => {
  it('エディタがマウントされるまでは選択が無い', () => {
    const { result } = renderSelection()
    expect(result.current.selection).toBeNull()
  })

  it('マウントの時点の空でない選択の行の範囲を、マウントの時点のファイルのパスと一緒に持つ(列は持たない)', () => {
    const { result } = renderSelection()
    act(() =>
      result.current.attachEditor(makeFakeTrackedEditor({ selection: lines10to20 }).editor, APP)
    )
    expect(result.current.selection).toEqual({ filePath: APP, startLine: 10, endLine: 20 })
  })

  it('マウントの時点の選択が空・取れないなら選択は無い', () => {
    const { result } = renderSelection()
    act(() => result.current.attachEditor(makeFakeTrackedEditor().editor, APP))
    expect(result.current.selection).toBeNull()
    act(() => result.current.attachEditor(makeFakeTrackedEditor({ selection: null }).editor, APP))
    expect(result.current.selection).toBeNull()
  })

  it('選択の変化に追従し、空になったら選択を無しにする', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor, APP))
    act(() => fake.select(lines10to20))
    expect(result.current.selection?.endLine).toBe(20)
    act(() => fake.select(collapsedSelection(3, 1)))
    expect(result.current.selection).toBeNull()
  })

  it('同じ範囲の通知では、選択の値を作り直さない(描画を増やさない)', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(fake.editor, APP))
    const first = result.current.selection
    act(() => fake.select(selectionOf(10, 3, 20, 5, 10, 3)))
    expect(result.current.selection).toBe(first)
  })

  it('同じ行の中で列だけが変わった通知では、選択の値を作り直さず、描画もし直さない', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useEditorSelectionRange()
    })
    const fake = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(fake.editor, APP))
    const first = result.current.selection
    const rendersAfterAttach = renders
    // 開始・終わりの列だけを変える(行の範囲 #L10-20 は変わらない)
    act(() => fake.select(selectionOf(10, 1, 20, 9, 20, 9)))
    act(() => fake.select(selectionOf(10, 7, 20, 2, 20, 2)))
    expect(result.current.selection).toBe(first)
    expect(renders).toBe(rendersAfterAttach)
  })

  it('終わりが列 1 の補正の後の行の範囲が同じなら、選択の値を作り直さない', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor({ selection: selectionOf(10, 1, 13, 1, 13, 1) })
    act(() => result.current.attachEditor(fake.editor, APP))
    const first = result.current.selection
    // 10 行目〜13 行目の列 1(13 行目は含めない)と、10 行目〜12 行目の途中は、どちらも #L10-12
    act(() => fake.select(selectionOf(10, 1, 12, 4, 12, 4)))
    expect(result.current.selection).toBe(first)
    // 行の範囲が変われば作り直す
    act(() => fake.select(selectionOf(10, 1, 13, 2, 13, 2)))
    expect(result.current.selection).toEqual({ filePath: APP, startLine: 10, endLine: 13 })
  })

  it('エディタが外れたら(破棄)選択を無しにし、購読を外す', () => {
    const { result } = renderSelection()
    const fake = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(fake.editor, APP))
    act(() => fake.dispose())
    expect(result.current.selection).toBeNull()
    expect(fake.listenerCount()).toBe(0)
  })

  it('別のファイルのエディタへ付け替えたら、前のエディタの購読を外し、新しいファイルのパスで追う', () => {
    const { result } = renderSelection()
    const first = makeFakeTrackedEditor({ selection: lines10to20 })
    const second = makeFakeTrackedEditor({ selection: selectionOf(2, 1, 4, 1, 4, 1) })
    act(() => result.current.attachEditor(first.editor, APP))
    act(() => result.current.attachEditor(second.editor, NOTES))
    expect(first.listenerCount()).toBe(0)
    expect(result.current.selection?.filePath).toBe(NOTES)
    // 前のエディタの通知(選択の変化・破棄)は、新しいエディタの選択を変えない
    act(() => first.select(collapsedSelection(1, 1)))
    act(() => first.dispose())
    // 2 行目〜4 行目の列 1 は、4 行目を含めない(#L2-3)
    expect(result.current.selection).toEqual({ filePath: NOTES, startLine: 2, endLine: 3 })
  })

  it('破棄を経ずに別のファイルの同じ行の範囲のエディタへ付け替えたら、選択の値を作り直し、新しいファイルのパスにする', () => {
    const { result } = renderSelection()
    const first = makeFakeTrackedEditor({ selection: lines10to20 })
    const second = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(first.editor, APP))
    const before = result.current.selection
    // 前のエディタの破棄の通知(onDidDispose → null)を経ない付け替え。行の範囲(#L10-20)は同じで、パスだけが違う
    act(() => result.current.attachEditor(second.editor, NOTES))
    expect(result.current.selection).toEqual({ filePath: NOTES, startLine: 10, endLine: 20 })
    expect(result.current.selection).not.toBe(before)
  })

  it('破棄済みのインスタンス(遅れて届いたマウントの通知)は追わず、それまでの選択も無しにする', () => {
    const { result } = renderSelection()
    const live = makeFakeTrackedEditor({ selection: lines10to20 })
    act(() => result.current.attachEditor(live.editor, APP))
    const disposed = makeFakeTrackedEditor({ model: null, selection: lines10to20 })
    act(() => result.current.attachEditor(disposed.editor, NOTES))
    expect(result.current.selection).toBeNull()
    expect(disposed.listenerCount()).toBe(0)
    expect(live.listenerCount()).toBe(0)
  })

  it('アンマウントで購読を外す', () => {
    const { result, unmount } = renderSelection()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor, APP))
    unmount()
    expect(fake.listenerCount()).toBe(0)
  })
})
