import { useCallback, useEffect, useRef, useState } from 'react'
import { isEmptySelection } from '../lib/applyToEditor'
import type { ApplySelection, ApplyTargetEditor } from '../lib/applyToEditor'

interface Disposable {
  dispose(): void
}

/** 反映先として追うエディタ。Monaco の IStandaloneCodeEditor はこの形を満たす */
export interface TrackedEditor extends ApplyTargetEditor {
  onDidChangeCursorSelection(listener: (event: { selection: ApplySelection }) => void): Disposable
  onDidDispose(listener: () => void): Disposable
}

export interface TrackedEditorSelection {
  /** 反映先のエディタ。マウントされていない・破棄された後は null */
  target: TrackedEditor | null
  /** 反映先のエディタに空でない選択範囲があるか */
  hasSelection: boolean
  /** エディタがマウントされたときに呼ぶ。前のエディタの購読を外し、このエディタを追う */
  attachEditor: (instance: TrackedEditor) => void
}

const hasNonEmptySelection = (instance: TrackedEditor): boolean => {
  const selection = instance.getSelection()
  return selection !== null && !isEmptySelection(selection)
}

// 反映先のエディタと選択範囲の有無を状態として追う(editorRef は ref のため再描画を起こさない)。購読は
// マウントの通知(attachEditor)で張り、破棄の通知・次のマウント・アンマウントで外す
export function useTrackedEditorSelection(): TrackedEditorSelection {
  const [target, setTarget] = useState<TrackedEditor | null>(null)
  const [hasSelection, setHasSelection] = useState(false)
  const subscriptionsRef = useRef<Disposable[]>([])

  const detach = useCallback((): void => {
    for (const subscription of subscriptionsRef.current) subscription.dispose()
    subscriptionsRef.current = []
  }, [])

  const attachEditor = useCallback(
    (instance: TrackedEditor): void => {
      // 前のエディタの購読を外す。外さないと、前のエディタの破棄の通知が新しい反映先を消す
      detach()
      // 破棄済みのインスタンス(遅れて届いたマウントの通知)は追わない
      if (instance.getModel() === null) {
        setTarget(null)
        setHasSelection(false)
        return
      }
      subscriptionsRef.current = [
        instance.onDidChangeCursorSelection((event) => {
          setHasSelection(!isEmptySelection(event.selection))
        }),
        instance.onDidDispose(() => {
          detach()
          setTarget(null)
          setHasSelection(false)
        })
      ]
      setTarget(instance)
      setHasSelection(hasNonEmptySelection(instance))
    },
    [detach]
  )

  // アンマウント時は、反映先のエディタの購読を外す(エディタより先にフックの持ち主が消える場合に備える)
  useEffect(() => detach, [detach])

  return { target, hasSelection, attachEditor }
}
