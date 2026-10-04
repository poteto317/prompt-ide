import type { IRange, ISelection } from 'monaco-editor'
import type { ApplyMode } from '../types'

// executeEdits の第 1 引数(編集の出どころ)。Monaco はこの値を undo の履歴・イベントの source に残すだけで、
// 挙動は変えない
export const APPLY_EDIT_SOURCE = 'apply-output'

/** Monaco の Selection のうち、反映に使う部分(範囲とカーソルの位置) */
export type ApplySelection = IRange & { positionLineNumber: number; positionColumn: number }

/**
 * executeEdits の第 3 引数のコールバック。逆向きの編集(挿入したテキストの範囲)を受け取り、編集の後の選択を返す。
 * Monaco の型(ICursorStateComputer)は Selection のクラスを返す形だが、実行時に読むのは ISelection の 4 つの値
 * だけで、素のオブジェクトで undo・redo とも正しく動く(実物の Monaco で確認。applyToEditor.monaco.test.ts)。
 * Monaco の IStandaloneCodeEditor をこのインターフェースへ渡せるよう、引数はメソッドの形で宣言して双変にし
 * (Monaco の IValidEditOperation を受け取るコールバックと比べられる)、Monaco が受け付ける選択の配列も型に含める
 */
type EndCursorStateComputer = {
  compute(inverseEditOperations: { range: IRange }[]): ISelection[] | null
}['compute']

/**
 * 反映先のエディタの最小のインターフェース。Monaco の IStandaloneCodeEditor はこの形を満たす
 * (テストは偽のエディタと実物の Monaco の両方で確かめる)
 */
export interface ApplyTargetEditor {
  getModel(): object | null
  getSelection(): ApplySelection | null
  pushUndoStop(): unknown
  executeEdits(
    source: string,
    edits: { range: IRange; text: string; forceMoveMarkers?: boolean }[],
    endCursorState?: EndCursorStateComputer | readonly ISelection[]
  ): boolean
  /** その位置が表示範囲の外なら、見える位置まで最小限スクロールする(表示範囲の中なら動かさない) */
  revealPosition(position: { lineNumber: number; column: number }): void
  focus(): void
}

/**
 * 反映の結果。
 * - applied: 反映した
 * - unavailable: 反映先が無い(モデルが破棄済み・選択範囲が無い・置換で選択が空)。何もしていない
 * - rejected: Monaco が編集を拒否した(読み取り専用など。executeEdits が false)。何も変わっていない
 */
export type ApplyResult = 'applied' | 'unavailable' | 'rejected'

export const isEmptySelection = (selection: IRange): boolean =>
  selection.startLineNumber === selection.endLineNumber &&
  selection.startColumn === selection.endColumn

/**
 * AI の出力をエディタへ反映する。挿入はカーソルの位置(選択範囲があっても、その位置に挿入し、選択された
 * 文字列は残す)、置換は主カーソルの選択範囲(空なら何もしない)。前後に pushUndoStop を置き、1 回の undo で
 * 戻せる 1 つの編集にする。改行コードは Monaco がモデルの改行コードへ変換する。反映後はカーソルを挿入した
 * テキストの末尾に置き(選択は解除)、そこが見えるようにスクロールし、エディタへフォーカスを戻す
 */
export function applyToEditor(
  editor: ApplyTargetEditor,
  mode: ApplyMode,
  text: string
): ApplyResult {
  // 破棄済みのインスタンス(遅れて届いた呼び出し)は何もしない
  if (editor.getModel() === null) return 'unavailable'
  const selection = editor.getSelection()
  if (selection === null) return 'unavailable'
  if (mode === 'replace' && isEmptySelection(selection)) return 'unavailable'
  const range: IRange =
    mode === 'insert'
      ? {
          startLineNumber: selection.positionLineNumber,
          startColumn: selection.positionColumn,
          endLineNumber: selection.positionLineNumber,
          endColumn: selection.positionColumn
        }
      : {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn
        }
  // 反映後のカーソル(挿入したテキストの末尾の空の選択)は、endCursorState のコールバックの戻り値で Monaco に
  // 渡す。末尾の位置は逆向きの編集の範囲(挿入したテキストの範囲。改行コードの変換後)から求める。戻り値は undo の
  // 履歴の「編集の後のカーソル」に残るため、redo の後も同じ位置に戻る(null を返して編集の後に setSelection で
  // 置くと、履歴に残らず、redo の後は挿入したテキスト全体が選択された状態になる)。Monaco の Selection のクラスは
  // 要らず、素の ISelection で足りる(実物の Monaco で確認。applyToEditor.monaco.test.ts)
  // 末尾の位置は、編集の後のスクロールにも使うので残しておく
  let insertedEnd: { lineNumber: number; column: number } | null = null
  editor.pushUndoStop()
  const applied = editor.executeEdits(
    APPLY_EDIT_SOURCE,
    [{ range, text, forceMoveMarkers: true }],
    (inverseEditOperations) => {
      const insertedRange = inverseEditOperations[0]?.range
      if (insertedRange === undefined) return null
      insertedEnd = { lineNumber: insertedRange.endLineNumber, column: insertedRange.endColumn }
      return [
        {
          selectionStartLineNumber: insertedRange.endLineNumber,
          selectionStartColumn: insertedRange.endColumn,
          positionLineNumber: insertedRange.endLineNumber,
          positionColumn: insertedRange.endColumn
        }
      ]
    }
  )
  if (!applied) return 'rejected'
  editor.pushUndoStop()
  // executeEdits は、入力・貼り付けと違ってカーソルの位置までスクロールしない。長い出力を入れると、末尾(カーソル)が
  // 画面の外に出たままになるため、見える位置まで最小限スクロールする(貼り付けと同じ動き。表示範囲の中なら動かさない)。
  // revealPositionInCenterIfOutsideViewport は外のとき末尾を画面の中央へ寄せ、貼り付けより大きく動くため使わない
  // (実物の Monaco で確認。applyToEditor.monaco.test.ts)
  if (insertedEnd !== null) editor.revealPosition(insertedEnd)
  editor.focus()
  return 'applied'
}
