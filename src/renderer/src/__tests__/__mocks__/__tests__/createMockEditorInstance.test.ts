import { describe, it, expect, vi } from 'vitest'
import { createMockEditorInstance } from '../createMockEditorInstance'
import type { MockEditorInstance } from '../createMockEditorInstance'
import { collapsedSelection, selectionOf } from '../fakeTextBuffer'

// @monaco-editor/react のモックが onMount へ渡す偽のエディタの、編集・選択・破棄の振る舞い
function setup(initial = 'abc'): {
  mock: MockEditorInstance
  commitValue: ReturnType<typeof vi.fn<(next: string) => void>>
  value: () => string
} {
  let value = initial
  const commitValue = vi.fn<(next: string) => void>((next) => {
    value = next
  })
  const mock = createMockEditorInstance({
    readValue: () => value,
    commitValue,
    getModel: () => ({ id: 'model' })
  })
  return { mock, commitValue, value: () => value }
}

describe('createMockEditorInstance — 選択範囲', () => {
  it('最初の選択は (1,1) の空の選択で、モデルは getModel の値', () => {
    const { mock } = setup()

    expect(mock.instance.getSelection()).toEqual(collapsedSelection(1, 1))
    expect(mock.handle.getSelection()).toEqual(collapsedSelection(1, 1))
    expect(mock.instance.getModel()).toEqual({ id: 'model' })
  })

  it('handle.select は選択範囲を変え、選択の購読者へ通知する', () => {
    const { mock } = setup()
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    mock.instance.onDidChangeCursorSelection(listener)
    const next = selectionOf(1, 1, 1, 3, 1, 3)

    mock.handle.select(next)

    expect(listener).toHaveBeenCalledWith({ selection: next })
    expect(mock.instance.getSelection()).toEqual(next)
  })

  it('購読を解除すると通知しない', () => {
    const { mock } = setup()
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    mock.instance.onDidChangeCursorSelection(listener).dispose()

    mock.handle.select(selectionOf(1, 1, 1, 2, 1, 2))

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('createMockEditorInstance — 編集', () => {
  it('executeEdits は、現在の値に編集を当てて commitValue へ渡し、true を返す', () => {
    const { mock, commitValue, value } = setup('abc')

    const applied = mock.instance.executeEdits('src', [
      { range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 }, text: 'XY' }
    ])

    expect(applied).toBe(true)
    expect(commitValue).toHaveBeenCalledWith('aXYbc')
    expect(value()).toBe('aXYbc')
  })

  it('endCursorState のコールバックが返した選択の先頭を編集の後の選択にし、選択の購読者へ通知する(実物の Monaco と同じ)', () => {
    const { mock } = setup('abc')
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    mock.instance.onDidChangeCursorSelection(listener)

    mock.instance.executeEdits(
      'src',
      [
        {
          range: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 2 },
          text: 'X\nY'
        }
      ],
      () => [
        // 後ろ向きの選択(起点 (2,2)・カーソル (1,1))。先頭が主カーソル
        {
          selectionStartLineNumber: 2,
          selectionStartColumn: 2,
          positionLineNumber: 1,
          positionColumn: 1
        },
        {
          selectionStartLineNumber: 1,
          selectionStartColumn: 3,
          positionLineNumber: 1,
          positionColumn: 3
        }
      ]
    )

    expect(mock.instance.getSelection()).toEqual(selectionOf(1, 1, 2, 2, 1, 1))
    expect(listener).toHaveBeenCalledWith({ selection: selectionOf(1, 1, 2, 2, 1, 1) })
  })

  it('endCursorState に選択の配列を渡したら、その先頭を編集の後の選択にする', () => {
    const { mock } = setup('abc')

    mock.instance.executeEdits(
      'src',
      [
        { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'Z' }
      ],
      [
        {
          selectionStartLineNumber: 1,
          selectionStartColumn: 2,
          positionLineNumber: 1,
          positionColumn: 2
        }
      ]
    )

    expect(mock.instance.getSelection()).toEqual(collapsedSelection(1, 2))
  })

  it('endCursorState が無い・null を返すときは、選択を変えず通知もしない(マーカーによる移動はまねしない)', () => {
    const { mock } = setup('abc')
    const before = selectionOf(1, 1, 1, 3, 1, 3)
    mock.handle.select(before)
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    mock.instance.onDidChangeCursorSelection(listener)
    const edit = {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      text: 'Z'
    }

    mock.instance.executeEdits('src', [edit])
    mock.instance.executeEdits('src', [edit], () => null)

    expect(mock.instance.getSelection()).toEqual(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('endCursorState に、挿入したテキストの範囲を逆向きの編集の範囲として渡す', () => {
    const { mock } = setup('abc')
    const endCursorState = vi.fn<(inverse: { range: unknown }[]) => null>(() => null)

    mock.instance.executeEdits(
      'src',
      [
        { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'Z' }
      ],
      endCursorState
    )

    expect(endCursorState).toHaveBeenCalledWith([
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } }
    ])
  })

  it('executeEdits・pushUndoStop・revealPosition は handle と同じモック(テストから呼び出しを確かめる)', () => {
    const { mock } = setup()

    mock.instance.pushUndoStop()
    mock.instance.revealPosition({ lineNumber: 1, column: 1 })

    expect(mock.handle.pushUndoStop).toHaveBeenCalledOnce()
    expect(mock.handle.revealPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 })
    expect(mock.handle.executeEdits).toBe(mock.instance.executeEdits)
  })

  it('setSelection は持たない(反映は endCursorState で選択を決めるため、使われない口を残さない)', () => {
    const { mock } = setup()

    expect('setSelection' in mock.instance).toBe(false)
  })
})

describe('createMockEditorInstance — 破棄', () => {
  it('dispose は破棄の購読者へ通知し、モデルと選択範囲を失う', () => {
    const { mock } = setup()
    const listener = vi.fn<() => void>()
    mock.instance.onDidDispose(listener)

    mock.dispose()

    expect(listener).toHaveBeenCalledOnce()
    expect(mock.instance.getModel()).toBeNull()
    expect(mock.instance.getSelection()).toBeNull()
  })

  it('破棄の後の executeEdits は何もせず false を返す', () => {
    const { mock, commitValue } = setup()
    mock.dispose()

    const applied = mock.instance.executeEdits('src', [
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'Z' }
    ])

    expect(applied).toBe(false)
    expect(commitValue).not.toHaveBeenCalled()
  })

  it('破棄の後は、選択の購読者へも通知しない(購読をすべて外す)', () => {
    const { mock } = setup()
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    mock.instance.onDidChangeCursorSelection(listener)
    mock.dispose()

    mock.handle.select(selectionOf(1, 1, 1, 2, 1, 2))

    expect(listener).not.toHaveBeenCalled()
  })
})
