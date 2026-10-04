import { describe, it, expect, vi } from 'vitest'
import {
  collapsedRange,
  makeFakeApplyEditor,
  collapsedSelection,
  makeFakeTrackedEditor,
  selectionOf
} from '../makeFakeApplyEditor'

// 反映のテスト(applyToEditor・useApplyOutputToEditor・Monaco のモック)が共有する偽物の、作り方そのものの確認
describe('collapsedRange', () => {
  it('collapsedRange は、その位置の空の範囲(カーソルの位置を持たない)', () => {
    expect(collapsedRange(2, 3)).toEqual({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 3
    })
  })
})

describe('makeFakeApplyEditor', () => {
  it('既定は、モデルがあり、選択は (1,1) の空の選択', () => {
    const { editor } = makeFakeApplyEditor()

    expect(editor.getModel()).not.toBeNull()
    expect(editor.getSelection()).toEqual(collapsedSelection(1, 1))
  })

  it('モデル・選択範囲に null を指定できる', () => {
    const { editor } = makeFakeApplyEditor({ model: null, selection: null })

    expect(editor.getModel()).toBeNull()
    expect(editor.getSelection()).toBeNull()
  })

  it('編集系の呼び出しの順序を calls に記録する', () => {
    const { editor, calls } = makeFakeApplyEditor()

    editor.pushUndoStop()
    editor.executeEdits('s', [])
    editor.revealPosition({ lineNumber: 1, column: 1 })
    editor.focus()

    expect(calls).toEqual(['pushUndoStop', 'executeEdits', 'revealPosition', 'focus'])
  })

  it('executeEdits は endCursorState に、挿入した範囲を逆向きの編集の範囲として渡し、true を返す', () => {
    const insertedRange = { startLineNumber: 3, startColumn: 5, endLineNumber: 4, endColumn: 7 }
    const { editor } = makeFakeApplyEditor({ insertedRange })
    const endCursorState = vi.fn<(inverse: { range: typeof insertedRange }[]) => null>(() => null)

    expect(editor.executeEdits('s', [], endCursorState)).toBe(true)

    expect(endCursorState).toHaveBeenCalledWith([{ range: insertedRange }])
  })

  it('endCursorState に選択の配列を渡したら、その先頭を編集の後の選択にする(Monaco と同じ)', () => {
    const { editor } = makeFakeApplyEditor()

    editor.executeEdits(
      's',
      [],
      [
        {
          selectionStartLineNumber: 2,
          selectionStartColumn: 3,
          positionLineNumber: 2,
          positionColumn: 3
        }
      ]
    )

    expect(editor.getSelection()).toEqual(collapsedSelection(2, 3))
  })

  it('endCursorState が null を返したら、選択は変えない', () => {
    const { editor } = makeFakeApplyEditor({ selection: selectionOf(1, 2, 1, 5, 1, 5) })

    editor.executeEdits('s', [], () => null)

    expect(editor.getSelection()).toEqual(selectionOf(1, 2, 1, 5, 1, 5))
  })

  it.each([
    ['前向き', { anchor: [1, 2], position: [3, 4] }, selectionOf(1, 2, 3, 4, 3, 4)],
    ['後ろ向き', { anchor: [3, 4], position: [1, 2] }, selectionOf(1, 2, 3, 4, 1, 2)],
    ['空', { anchor: [2, 5], position: [2, 5] }, collapsedSelection(2, 5)]
  ])(
    'endCursorState が返した選択(%s)の先頭を、編集の後の選択にする',
    (_label, { anchor, position }, expected) => {
      const { editor } = makeFakeApplyEditor()

      editor.executeEdits('s', [], () => [
        {
          selectionStartLineNumber: anchor[0],
          selectionStartColumn: anchor[1],
          positionLineNumber: position[0],
          positionColumn: position[1]
        },
        {
          selectionStartLineNumber: 9,
          selectionStartColumn: 9,
          positionLineNumber: 9,
          positionColumn: 9
        }
      ])

      expect(editor.getSelection()).toEqual(expected)
    }
  )

  it('executeResult が false なら、endCursorState を呼ばずに false を返す', () => {
    const { editor } = makeFakeApplyEditor({ executeResult: false })
    const endCursorState = vi.fn<() => null>(() => null)

    expect(editor.executeEdits('s', [], endCursorState)).toBe(false)

    expect(endCursorState).not.toHaveBeenCalled()
  })
})

describe('makeFakeTrackedEditor', () => {
  it('select は選択範囲を変え、選択の購読者へ通知する', () => {
    const fake = makeFakeTrackedEditor()
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    fake.editor.onDidChangeCursorSelection(listener)
    const next = selectionOf(1, 1, 1, 4, 1, 4)

    fake.select(next)

    expect(listener).toHaveBeenCalledWith({ selection: next })
    expect(fake.editor.getSelection()).toEqual(next)
  })

  it('dispose はモデルを失わせ、破棄の購読者へ通知する', () => {
    const fake = makeFakeTrackedEditor()
    const listener = vi.fn<() => void>()
    fake.editor.onDidDispose(listener)

    fake.dispose()

    expect(listener).toHaveBeenCalledOnce()
    expect(fake.editor.getModel()).toBeNull()
  })

  it('listenerCount は購読の数で、購読を解除すると減る', () => {
    const fake = makeFakeTrackedEditor()
    const selection = fake.editor.onDidChangeCursorSelection(() => {})
    const disposal = fake.editor.onDidDispose(() => {})
    expect(fake.listenerCount()).toBe(2)

    selection.dispose()
    disposal.dispose()

    expect(fake.listenerCount()).toBe(0)
  })

  it('解除された購読者には通知しない', () => {
    const fake = makeFakeTrackedEditor()
    const listener = vi.fn<(event: { selection: unknown }) => void>()
    fake.editor.onDidChangeCursorSelection(listener).dispose()

    fake.select(selectionOf(1, 1, 1, 2, 1, 2))

    expect(listener).not.toHaveBeenCalled()
  })

  it('選択範囲・モデルの初期値を指定できる', () => {
    const selection = selectionOf(1, 1, 1, 4, 1, 4)
    const fake = makeFakeTrackedEditor({ selection, model: null })

    expect(fake.editor.getSelection()).toEqual(selection)
    expect(fake.editor.getModel()).toBeNull()
  })
})
