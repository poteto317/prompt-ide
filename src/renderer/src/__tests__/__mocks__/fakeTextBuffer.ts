// @monaco-editor/react のモックが使う、テキストの編集のエミュレーションと選択範囲の形を作る関数(純粋関数)。改行は \n だけを扱う
// (テストの内容は \n で書く)

export interface MockRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface MockSelection extends MockRange {
  positionLineNumber: number
  positionColumn: number
}

/** Monaco の ISelection の形(選択の起点とカーソルの位置)。executeEdits の endCursorState が返す選択 */
export interface MockCursorState {
  selectionStartLineNumber: number
  selectionStartColumn: number
  positionLineNumber: number
  positionColumn: number
}

export interface MockEdit {
  range: MockRange
  text: string
}

/** [選択の開始の行, 列, 終わりの行, 列, カーソルの行, 列] から選択範囲を作る */
export const selectionOf = (
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
  positionLineNumber: number,
  positionColumn: number
): MockSelection => ({
  startLineNumber,
  startColumn,
  endLineNumber,
  endColumn,
  positionLineNumber,
  positionColumn
})

/** その位置にカーソルがある空の選択 */
export const collapsedSelection = (lineNumber: number, column: number): MockSelection => ({
  startLineNumber: lineNumber,
  startColumn: column,
  endLineNumber: lineNumber,
  endColumn: column,
  positionLineNumber: lineNumber,
  positionColumn: column
})

/**
 * ISelection の形(起点とカーソルの位置)を、範囲の開始・終わりとカーソルの位置の形へ直す。Monaco と同じく、
 * 開始は起点とカーソルの前の方
 */
export const selectionFromCursorState = (selection: MockCursorState): MockSelection => {
  const anchorFirst =
    selection.selectionStartLineNumber < selection.positionLineNumber ||
    (selection.selectionStartLineNumber === selection.positionLineNumber &&
      selection.selectionStartColumn <= selection.positionColumn)
  const anchor = {
    lineNumber: selection.selectionStartLineNumber,
    column: selection.selectionStartColumn
  }
  const position = { lineNumber: selection.positionLineNumber, column: selection.positionColumn }
  const [start, end] = anchorFirst ? [anchor, position] : [position, anchor]
  return selectionOf(
    start.lineNumber,
    start.column,
    end.lineNumber,
    end.column,
    selection.positionLineNumber,
    selection.positionColumn
  )
}

/** 行・列(1 始まり)を文字列の位置へ */
export const offsetAt = (text: string, lineNumber: number, column: number): number => {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < lineNumber - 1; i++) offset += lines[i].length + 1
  return offset + column - 1
}

/** 1 つの編集を当てた後の文字列と、挿入したテキストの範囲(Monaco の逆向きの編集の範囲に当たる) */
export const applyEdit = (
  text: string,
  { range, text: inserted }: MockEdit
): [string, MockRange] => {
  const start = offsetAt(text, range.startLineNumber, range.startColumn)
  const end = offsetAt(text, range.endLineNumber, range.endColumn)
  const lines = inserted.split('\n')
  const endLineNumber = range.startLineNumber + lines.length - 1
  const endColumn =
    lines.length === 1 ? range.startColumn + inserted.length : lines[lines.length - 1].length + 1
  return [
    text.slice(0, start) + inserted + text.slice(end),
    {
      startLineNumber: range.startLineNumber,
      startColumn: range.startColumn,
      endLineNumber,
      endColumn
    }
  ]
}
