import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useTrackedEditorSelection } from '../useTrackedEditorSelection'
import type { TrackedEditorSelection } from '../useTrackedEditorSelection'
import {
  collapsedSelection,
  makeFakeTrackedEditor,
  selectionOf
} from '../../__tests__/makeFakeApplyEditor'

// 偽のエディタ(makeFakeTrackedEditor)は、選択の変更・破棄の通知をテストから起こせる。購読の数(listenerCount)で
// 解除を確かめる
const collapsed = collapsedSelection(1, 1)
const nonEmpty = selectionOf(1, 1, 1, 4, 1, 4)

const renderTracked = (): RenderHookResult<TrackedEditorSelection, unknown> =>
  renderHook(() => useTrackedEditorSelection())

describe('useTrackedEditorSelection — 追跡の開始', () => {
  it('エディタがマウントされるまでは反映先が無く、選択範囲も無い', () => {
    const { result } = renderTracked()

    expect(result.current.target).toBeNull()
    expect(result.current.hasSelection).toBe(false)
  })

  it('マウントされたエディタを反映先にする。選択が空なら選択範囲は無い', () => {
    const { result } = renderTracked()
    const { editor } = makeFakeTrackedEditor()

    act(() => result.current.attachEditor(editor))

    expect(result.current.target).toBe(editor)
    expect(result.current.hasSelection).toBe(false)
  })

  it('マウントの時点で選択範囲があれば、選択範囲がある', () => {
    const { result } = renderTracked()

    act(() => result.current.attachEditor(makeFakeTrackedEditor({ selection: nonEmpty }).editor))

    expect(result.current.hasSelection).toBe(true)
  })

  it('マウントの時点で選択範囲が取れなければ(null)、選択範囲は無い', () => {
    const { result } = renderTracked()
    const { editor } = makeFakeTrackedEditor({ selection: null })

    act(() => result.current.attachEditor(editor))

    expect(result.current.target).toBe(editor)
    expect(result.current.hasSelection).toBe(false)
  })

  it('選択範囲の変化に追従する', () => {
    const { result } = renderTracked()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor))

    act(() => fake.select(nonEmpty))
    expect(result.current.hasSelection).toBe(true)

    act(() => fake.select(collapsed))
    expect(result.current.hasSelection).toBe(false)
  })

  it('破棄済みのインスタンス(遅れて届いたマウントの通知)は追わない', () => {
    const { result } = renderTracked()
    const fake = makeFakeTrackedEditor({ model: null, selection: nonEmpty })

    act(() => result.current.attachEditor(fake.editor))

    expect(result.current.target).toBeNull()
    expect(result.current.hasSelection).toBe(false)
    expect(fake.listenerCount()).toBe(0)
  })

  it('破棄済みのインスタンスが届いたら、それまでの反映先からも外れる', () => {
    const { result } = renderTracked()
    const live = makeFakeTrackedEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(live.editor))

    act(() => result.current.attachEditor(makeFakeTrackedEditor({ model: null }).editor))

    expect(result.current.target).toBeNull()
    expect(result.current.hasSelection).toBe(false)
    expect(live.listenerCount()).toBe(0)
  })
})

describe('useTrackedEditorSelection — エディタの差し替え', () => {
  it('エディタが破棄されると反映先から外れ、購読を解除する', () => {
    const { result } = renderTracked()
    const fake = makeFakeTrackedEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(fake.editor))

    act(() => fake.dispose())

    expect(result.current.target).toBeNull()
    expect(result.current.hasSelection).toBe(false)
    expect(fake.listenerCount()).toBe(0)
  })

  it('次のエディタがマウントされたら、前のエディタの購読を解除し、前の通知で状態が変わらない', () => {
    const { result } = renderTracked()
    const first = makeFakeTrackedEditor({ selection: nonEmpty })
    const second = makeFakeTrackedEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(first.editor))

    act(() => result.current.attachEditor(second.editor))
    expect(first.listenerCount()).toBe(0)
    expect(result.current.target).toBe(second.editor)
    expect(result.current.hasSelection).toBe(true)
    // 前のエディタの選択の解除・破棄は、新しい反映先の状態を変えない(新しい反映先には選択があるため、
    // 古い世代の「選択が空」の通知が届くと選択範囲が無いことになる)
    act(() => first.select(collapsed))
    act(() => first.dispose())

    expect(result.current.target).toBe(second.editor)
    expect(result.current.hasSelection).toBe(true)
  })

  it('フックがアンマウントされると、反映先のエディタの購読を解除する', () => {
    const { result, unmount } = renderTracked()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor))
    expect(fake.listenerCount()).toBe(2)

    unmount()

    expect(fake.listenerCount()).toBe(0)
  })

  it('attachEditor は描画をまたいで同じ参照(onMount の依存に入れても作り直さない)', () => {
    const { result } = renderTracked()
    const first = result.current.attachEditor

    act(() => result.current.attachEditor(makeFakeTrackedEditor().editor))

    expect(result.current.attachEditor).toBe(first)
  })
})
