import { useCallback, useEffect, useRef, useState } from 'react'
import { isEmptySelection } from '../lib/applyToEditor'
import { toLineSpan } from '../lib/agentReferences'
import type { EditorLineSelection, LineSelection } from '../lib/agentReferences'

interface Disposable {
  dispose(): void
}

/** 選択の行の範囲を追うエディタ。Monaco の IStandaloneCodeEditor はこの形を満たす */
export interface SelectionRangeEditor {
  getModel(): object | null
  getSelection(): LineSelection | null
  onDidChangeCursorSelection(listener: (event: { selection: LineSelection }) => void): Disposable
  onDidDispose(listener: () => void): Disposable
}

export interface EditorSelectionRangeState {
  /** アクティブなエディタの空でない選択。選択が空・エディタが無い(差分のタブ・ファイルを閉じた)ときは null */
  selection: EditorLineSelection | null
  /** 現在のファイルのエディタがマウントされたときに呼ぶ(EditorPanel の onEditorMount)。前のエディタの購読を外し、このエディタを追う */
  attachEditor: (instance: SelectionRangeEditor, filePath: string) => void
}

// Monaco の Selection はクラスのインスタンスなので、チップの表示を決める行の範囲(列 1 の補正の後)だけを写す
const toLineSelection = (
  filePath: string,
  range: LineSelection | null
): EditorLineSelection | null =>
  range === null || isEmptySelection(range) ? null : { filePath, ...toLineSpan(range) }

const isSameSelection = (a: EditorLineSelection | null, b: EditorLineSelection | null): boolean =>
  a === null || b === null
    ? a === b
    : a.filePath === b.filePath && a.startLine === b.startLine && a.endLine === b.endLine

// アクティブなエディタの選択の行の範囲と、そのエディタのファイルのパスを状態として追う(エージェントへ送るプロンプトの参照の
// 「選択範囲」。設計書「構成」)。購読はマウントの通知(attachEditor)で張り、破棄の通知(onDidDispose)・次のマウント・アンマウントで外す。
// 出力パネルの反映先の追跡(useTrackedEditorSelection)と同じ形だが、持つ値(行の範囲とパス)と使う側が違うため分ける
export function useEditorSelectionRange(): EditorSelectionRangeState {
  const [selection, setSelection] = useState<EditorLineSelection | null>(null)
  // 最後に state へ入れた値。同じ値なら setSelection を呼ばないために比べる(関数の updater で前の値を返すと、
  // React は bail out の前に一度描画し直すことがあるため)
  const selectionRef = useRef<EditorLineSelection | null>(null)
  const subscriptionsRef = useRef<Disposable[]>([])

  // カーソルが動くたびに通知が来るため、行の範囲(とファイル)が変わらなければ同じ値のままにする。行の中で列だけが変わっても
  // 作り直さず、描画もし直さない(この hook は合成の根の useAppState にあり、値が変わると App 全体が描画し直される)
  const update = useCallback((next: EditorLineSelection | null): void => {
    if (isSameSelection(selectionRef.current, next)) return
    selectionRef.current = next
    setSelection(next)
  }, [])

  const detach = useCallback((): void => {
    for (const subscription of subscriptionsRef.current) subscription.dispose()
    subscriptionsRef.current = []
  }, [])

  const attachEditor = useCallback(
    (instance: SelectionRangeEditor, filePath: string): void => {
      // 前のエディタの購読を外す。外さないと、前のエディタの破棄の通知が新しいエディタの選択を消す
      detach()
      // 破棄済みのインスタンス(遅れて届いたマウントの通知)は追わない
      if (instance.getModel() === null) {
        update(null)
        return
      }
      subscriptionsRef.current = [
        instance.onDidChangeCursorSelection((event) => {
          update(toLineSelection(filePath, event.selection))
        }),
        instance.onDidDispose(() => {
          detach()
          update(null)
        })
      ]
      update(toLineSelection(filePath, instance.getSelection()))
    },
    [detach, update]
  )

  // アンマウント時は、エディタの購読を外す(エディタより先にフックの持ち主が消える場合に備える)
  useEffect(() => detach, [detach])

  return { selection, attachEditor }
}
