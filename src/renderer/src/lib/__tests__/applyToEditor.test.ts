import { describe, it, expect } from 'vitest'
import { APPLY_EDIT_SOURCE, applyToEditor, isEmptySelection } from '../applyToEditor'
import {
  collapsedRange,
  collapsedSelection,
  makeFakeApplyEditor,
  selectionOf
} from '../../__tests__/makeFakeApplyEditor'

// 偽のエディタは calls に呼び出しの順序を記録し、executeEdits は endCursorState に insertedRange を逆向きの
// 編集の範囲として渡し、返された選択を編集の後の選択にする(Monaco と同じ形。makeFakeApplyEditor)。実物の Monaco での挙動は applyToEditor.monaco.test.ts
describe('applyToEditor', () => {
  it('挿入はカーソルの位置に空の範囲で、forceMoveMarkers を付けて編集する', () => {
    const { editor } = makeFakeApplyEditor({ selection: selectionOf(2, 3, 2, 3, 2, 3) })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('applied')

    expect(editor.executeEdits).toHaveBeenCalledWith(
      APPLY_EDIT_SOURCE,
      [{ range: collapsedRange(2, 3), text: 'XY', forceMoveMarkers: true }],
      expect.any(Function)
    )
  })

  it('選択範囲があるときの挿入は、選択の開始ではなくカーソルの位置に入れる(選択された文字列は残す)', () => {
    // 前向きの選択(1,2)-(1,5)。カーソルは選択の終わり(1,5)
    const { editor } = makeFakeApplyEditor({ selection: selectionOf(1, 2, 1, 5, 1, 5) })

    applyToEditor(editor, 'insert', 'XY')

    expect(editor.executeEdits.mock.calls[0][1]).toEqual([
      { range: collapsedRange(1, 5), text: 'XY', forceMoveMarkers: true }
    ])
  })

  it('置換は選択範囲を編集する(後ろ向きの選択でも範囲は開始から終わり)', () => {
    const { editor } = makeFakeApplyEditor({ selection: selectionOf(1, 2, 3, 4, 1, 2) })

    expect(applyToEditor(editor, 'replace', 'Z')).toBe('applied')

    expect(editor.executeEdits.mock.calls[0][1]).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 4 },
        text: 'Z',
        forceMoveMarkers: true
      }
    ])
  })

  it('置換で選択が空なら何もしない', () => {
    const { editor, calls } = makeFakeApplyEditor({ selection: selectionOf(1, 2, 1, 2, 1, 2) })

    expect(applyToEditor(editor, 'replace', 'Z')).toBe('unavailable')

    expect(calls).toEqual([])
  })

  it('pushUndoStop → executeEdits → pushUndoStop → revealPosition → focus の順に呼ぶ(1 回の undo で戻る 1 つの編集。表示は編集を閉じてから動かす)', () => {
    const { editor, calls } = makeFakeApplyEditor()

    applyToEditor(editor, 'insert', 'XY')

    expect(calls).toEqual([
      'pushUndoStop',
      'executeEdits',
      'pushUndoStop',
      'revealPosition',
      'focus'
    ])
  })

  it('反映の後、挿入したテキストの末尾(逆向きの編集の範囲の末尾)が見えるようにスクロールする(長い出力でカーソルが画面の外に出たままにしない)', () => {
    const { editor } = makeFakeApplyEditor({
      selection: collapsedSelection(1, 1),
      insertedRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 60, endColumn: 7 }
    })

    applyToEditor(editor, 'insert', 'long')

    expect(editor.revealPosition).toHaveBeenCalledOnce()
    expect(editor.revealPosition).toHaveBeenCalledWith({ lineNumber: 60, column: 7 })
  })

  it('カーソルは endCursorState の戻り値で、挿入したテキストの末尾(逆向きの編集の範囲の末尾)の空の選択にする(undo の履歴に残り、redo の後も同じ位置に戻る)', () => {
    const { editor } = makeFakeApplyEditor({
      selection: selectionOf(1, 2, 1, 5, 1, 5),
      insertedRange: { startLineNumber: 3, startColumn: 5, endLineNumber: 4, endColumn: 7 }
    })

    applyToEditor(editor, 'insert', 'XY\nZ')

    const endCursorState = editor.executeEdits.mock.calls[0][2]
    if (typeof endCursorState !== 'function') throw new Error('endCursorState はコールバックで渡す')
    expect(
      endCursorState([
        { range: { startLineNumber: 3, startColumn: 5, endLineNumber: 4, endColumn: 7 } }
      ])
    ).toEqual([
      {
        selectionStartLineNumber: 4,
        selectionStartColumn: 7,
        positionLineNumber: 4,
        positionColumn: 7
      }
    ])
    expect(editor.getSelection()).toEqual(collapsedSelection(4, 7))
  })

  it('モデルが無い(破棄済みのインスタンス)なら何もしない', () => {
    const { editor, calls } = makeFakeApplyEditor({ model: null })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('unavailable')

    expect(calls).toEqual([])
  })

  it('選択範囲が取れないなら何もしない', () => {
    const { editor, calls } = makeFakeApplyEditor({ selection: null })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('unavailable')

    expect(calls).toEqual([])
  })

  it('executeEdits が false(読み取り専用など)なら rejected で、カーソルもフォーカスも表示も動かさない', () => {
    const { editor, calls } = makeFakeApplyEditor({ executeResult: false })

    expect(applyToEditor(editor, 'insert', 'XY')).toBe('rejected')

    expect(calls).toEqual(['pushUndoStop', 'executeEdits'])
    expect(editor.revealPosition).not.toHaveBeenCalled()
  })
})

describe('isEmptySelection', () => {
  it('開始と終わりが同じなら空', () => {
    expect(isEmptySelection(collapsedRange(2, 3))).toBe(true)
  })

  it.each([
    [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }],
    [{ startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 3 }]
  ])('列か行が違えば空でない(%j)', (range) => {
    expect(isEmptySelection(range)).toBe(false)
  })
})
