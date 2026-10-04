import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  APPLY_NOTICE_DURATION_MS,
  APPLY_NOTICES,
  useApplyOutputToEditor
} from '../useApplyOutputToEditor'
import { APPLY_DISABLED_REASONS } from '../../lib/applyDisabledReason'
import type { ApplyOutputToEditor } from '../useApplyOutputToEditor'
import { makeFakeTrackedEditor, selectionOf } from '../../__tests__/makeFakeApplyEditor'

// 反映先のエディタの追跡(購読・破棄・差し替え)そのものは useTrackedEditorSelection.test.ts で確かめる。
// ここでは追跡の結果から決まる可否・反映・通知を確かめる
const nonEmpty = selectionOf(1, 1, 1, 4, 1, 4)

function renderApply(
  isExecuting = false
): RenderHookResult<ApplyOutputToEditor, { isExecuting: boolean }> {
  return renderHook((props: { isExecuting: boolean }) => useApplyOutputToEditor(props), {
    initialProps: { isExecuting }
  })
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useApplyOutputToEditor — 有効になる条件', () => {
  it('エディタがマウントされるまでは挿入も置換もできない(理由はエディタが無いこと)', () => {
    const { result } = renderApply()

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
    expect(result.current.applyOutput.replaceDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
  })

  it('マウントされれば挿入できる。選択が空なら置換はできない', () => {
    const { result } = renderApply()
    const { editor } = makeFakeTrackedEditor()

    act(() => result.current.attachEditor(editor))

    expect(result.current.applyOutput.insertDisabledReason).toBeNull()
    expect(result.current.applyOutput.replaceDisabledReason).toBe(
      APPLY_DISABLED_REASONS.noSelection
    )
  })

  it('マウントの時点で選択範囲があれば置換できる', () => {
    const { result } = renderApply()
    const { editor } = makeFakeTrackedEditor({ selection: nonEmpty })

    act(() => result.current.attachEditor(editor))

    expect(result.current.applyOutput.replaceDisabledReason).toBeNull()
  })

  it('実行中は、選択範囲があっても挿入も置換もできない(理由は実行中)', () => {
    const { result } = renderApply(true)
    act(() => result.current.attachEditor(makeFakeTrackedEditor({ selection: nonEmpty }).editor))

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.executing)
    expect(result.current.applyOutput.replaceDisabledReason).toBe(APPLY_DISABLED_REASONS.executing)
  })

  it('エディタが無いときの理由は、実行中より優先する', () => {
    const { result } = renderApply(true)

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
  })
})

describe('useApplyOutputToEditor — 反映先の差し替え', () => {
  it('エディタが破棄されると、挿入も置換もできなくなる(理由はエディタが無いこと)', () => {
    const { result } = renderApply()
    const fake = makeFakeTrackedEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(fake.editor))

    act(() => fake.dispose())

    expect(result.current.applyOutput.insertDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
    expect(result.current.applyOutput.replaceDisabledReason).toBe(APPLY_DISABLED_REASONS.noEditor)
  })

  it('反映は最新のエディタへ行う', () => {
    const { result } = renderApply()
    const first = makeFakeTrackedEditor()
    const second = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(first.editor))
    act(() => result.current.attachEditor(second.editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(first.editor.executeEdits).not.toHaveBeenCalled()
    expect(second.editor.executeEdits).toHaveBeenCalledOnce()
  })
})

describe('useApplyOutputToEditor — 反映と通知', () => {
  it('挿入すると編集し、「挿入しました」を通知する', () => {
    const { result } = renderApply()
    const { editor } = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(editor))

    act(() => result.current.applyOutput.apply('insert', 'XY'))

    expect(editor.executeEdits).toHaveBeenCalledWith(
      'apply-output',
      [expect.objectContaining({ text: 'XY' })],
      expect.any(Function)
    )
    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.insert)
  })

  it('置換すると編集し、「置換しました」を通知する', () => {
    const { result } = renderApply()
    const { editor } = makeFakeTrackedEditor({ selection: nonEmpty })
    act(() => result.current.attachEditor(editor))

    act(() => result.current.applyOutput.apply('replace', 'Z'))

    expect(editor.executeEdits).toHaveBeenCalledOnce()
    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.replace)
  })

  it('無効な操作は何もしない(選択が空の置換・実行中・エディタなし)', () => {
    const { result, rerender } = renderApply()
    act(() => result.current.applyOutput.apply('insert', 'X'))
    expect(result.current.applyOutput.notice).toBeNull()

    const { editor } = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(editor))
    act(() => result.current.applyOutput.apply('replace', 'X'))
    expect(editor.executeEdits).not.toHaveBeenCalled()

    rerender({ isExecuting: true })
    act(() => result.current.applyOutput.apply('insert', 'X'))
    expect(editor.executeEdits).not.toHaveBeenCalled()
    expect(result.current.applyOutput.notice).toBeNull()
  })

  it('Monaco が編集を拒否したら「反映できませんでした」を通知する', () => {
    const { result } = renderApply()
    const { editor } = makeFakeTrackedEditor()
    editor.executeEdits.mockReturnValueOnce(false)
    act(() => result.current.attachEditor(editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.rejected)
  })

  it('反映先が使えなくなっていたら(モデルが無い)通知しない', () => {
    const { result } = renderApply()
    const fake = makeFakeTrackedEditor()
    act(() => result.current.attachEditor(fake.editor))
    // 破棄の通知が届く前に、モデルだけが無くなった状態
    fake.editor.getModel.mockReturnValue(null)

    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(fake.editor.executeEdits).not.toHaveBeenCalled()
    expect(result.current.applyOutput.notice).toBeNull()
  })

  it('同じ操作を続けても、通知の id が進む(同じ文言でも読み上げ直すため)', () => {
    const { result } = renderApply()
    act(() => result.current.attachEditor(makeFakeTrackedEditor().editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))
    const firstId = result.current.applyOutput.notice?.id
    act(() => result.current.applyOutput.apply('insert', 'X'))

    expect(result.current.applyOutput.notice?.text).toBe(APPLY_NOTICES.insert)
    expect(result.current.applyOutput.notice?.id).not.toBe(firstId)
  })

  it('通知の表示中に実行が始まったら、通知を消す(前の反映の結果を実行中に残さない。完了しても戻らない)', () => {
    const { result, rerender } = renderApply()
    act(() => result.current.attachEditor(makeFakeTrackedEditor().editor))
    act(() => result.current.applyOutput.apply('insert', 'X'))
    expect(result.current.applyOutput.notice).not.toBeNull()

    rerender({ isExecuting: true })
    expect(result.current.applyOutput.notice).toBeNull()

    rerender({ isExecuting: false })
    expect(result.current.applyOutput.notice).toBeNull()
  })

  it('通知は APPLY_NOTICE_DURATION_MS で消える(数え直し・タイマーの解除は useTransientNotice.test.ts)', () => {
    vi.useFakeTimers()
    const { result } = renderApply()
    act(() => result.current.attachEditor(makeFakeTrackedEditor().editor))

    act(() => result.current.applyOutput.apply('insert', 'X'))
    act(() => vi.advanceTimersByTime(APPLY_NOTICE_DURATION_MS - 1))
    expect(result.current.applyOutput.notice).not.toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.applyOutput.notice).toBeNull()
  })
})
