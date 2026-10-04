import { vi } from 'vitest'
import type { Mock } from 'vitest'
import { applyEdit, collapsedSelection, selectionFromCursorState } from './fakeTextBuffer'
import type { MockCursorState, MockEdit, MockRange, MockSelection } from './fakeTextBuffer'

type ExecuteEdits = (
  source: string,
  edits: MockEdit[],
  endCursorState?:
    | ((inverse: { range: MockRange }[]) => readonly MockCursorState[] | null)
    | readonly MockCursorState[]
) => boolean

type RevealPosition = (position: { lineNumber: number; column: number }) => void

interface Disposable {
  dispose: () => void
}

/** 最後にマウントされた偽のエディタ。テストから選択範囲を変え、編集の呼び出しを確かめる */
export interface MockEditorHandle {
  /** 利用者がエディタで範囲を選んだ代わり。選択範囲を変え、onDidChangeCursorSelection の購読者へ通知する */
  select: (selection: MockSelection) => void
  getSelection: () => MockSelection
  executeEdits: Mock<ExecuteEdits>
  pushUndoStop: Mock<() => boolean>
  revealPosition: Mock<RevealPosition>
}

export interface MockEditorInstanceOptions {
  /** 編集を当てる前の、最新の内容 */
  readValue: () => string
  /** 編集した後の内容を書き戻す(モックの Editor は onChange へ渡す) */
  commitValue: (next: string) => void
  /** 破棄されていない間の getModel の戻り値 */
  getModel: () => object | null
}

export interface MockEditorInstance {
  /** onMount へ渡す偽のエディタのうち、選択・編集・購読の部分(addCommand・focus は呼び出し側が足す) */
  instance: {
    getModel: () => object | null
    getSelection: () => MockSelection | null
    executeEdits: Mock<ExecuteEdits>
    pushUndoStop: Mock<() => boolean>
    revealPosition: Mock<RevealPosition>
    onDidChangeCursorSelection: (
      listener: (event: { selection: MockSelection }) => void
    ) => Disposable
    onDidDispose: (listener: () => void) => Disposable
  }
  /** テストから操作する口(mockEditor.current) */
  handle: MockEditorHandle
  /** エディタを破棄する(アンマウントの代わり)。破棄の購読者へ通知し、以降はモデル・選択範囲を返さない */
  dispose: () => void
}

// 偽のエディタの、選択範囲・編集・破棄の購読。React の描画からは独立している
export function createMockEditorInstance({
  readValue,
  commitValue,
  getModel
}: MockEditorInstanceOptions): MockEditorInstance {
  let disposed = false
  let selection: MockSelection = collapsedSelection(1, 1)
  const selectionListeners = new Set<(event: { selection: MockSelection }) => void>()
  const disposeListeners = new Set<() => void>()
  const setSelection = (next: MockSelection): void => {
    selection = next
    for (const listener of selectionListeners) listener({ selection })
  }
  const executeEdits = vi.fn<ExecuteEdits>((_source, edits, endCursorState) => {
    if (disposed) return false
    const [next, insertedRange] = applyEdit(readValue(), edits[0])
    commitValue(next)
    // 実物の Monaco と同じく、endCursorState(コールバックなら戻り値、配列ならそのもの)の先頭を編集の後の選択にする。
    // 無い・null のときは選択を変えない(実物はマーカーで選択を動かすが、モックはまねしない)。カーソルの置き方は
    // 呼び出し側(applyToEditor)が endCursorState で決めるため、モックが肩代わりすると結合テストで壊れても気づけない
    const endSelections =
      typeof endCursorState === 'function'
        ? endCursorState([{ range: insertedRange }])
        : endCursorState
    const endSelection = endSelections?.[0]
    if (endSelection !== undefined) setSelection(selectionFromCursorState(endSelection))
    return true
  })
  const pushUndoStop = vi.fn<() => boolean>(() => true)
  // 偽のエディタは表示範囲を持たないため、スクロールは呼び出しの記録だけ
  const revealPosition = vi.fn<RevealPosition>()
  return {
    instance: {
      getModel: () => (disposed ? null : getModel()),
      getSelection: () => (disposed ? null : selection),
      executeEdits,
      pushUndoStop,
      revealPosition,
      onDidChangeCursorSelection: (listener) => {
        selectionListeners.add(listener)
        return { dispose: () => selectionListeners.delete(listener) }
      },
      onDidDispose: (listener) => {
        disposeListeners.add(listener)
        return { dispose: () => disposeListeners.delete(listener) }
      }
    },
    handle: {
      select: setSelection,
      getSelection: () => selection,
      executeEdits,
      pushUndoStop,
      revealPosition
    },
    dispose: () => {
      disposed = true
      for (const listener of disposeListeners) listener()
      disposeListeners.clear()
      selectionListeners.clear()
    }
  }
}
