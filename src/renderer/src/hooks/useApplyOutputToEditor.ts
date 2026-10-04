import { useEffect } from 'react'
import { getApplyDisabledReasons } from '../lib/applyDisabledReason'
import { applyToEditor } from '../lib/applyToEditor'
import type { ApplyMode, ApplyOutputState } from '../types'
import { useTrackedEditorSelection } from './useTrackedEditorSelection'
import type { TrackedEditor } from './useTrackedEditorSelection'
import { useTransientNotice } from './useTransientNotice'

// 反映の結果の通知を出しておく時間
export const APPLY_NOTICE_DURATION_MS = 3000

export const APPLY_NOTICES = {
  insert: '挿入しました',
  replace: '置換しました',
  rejected: '反映できませんでした'
} as const

export interface UseApplyOutputToEditorOptions {
  isExecuting: boolean
}

export interface ApplyOutputToEditor {
  applyOutput: ApplyOutputState
  /**
   * 現在のファイルのエディタがマウントされたときに呼ぶ(EditorPanel の onMount。useEditorFocusManager の
   * handleEditorMount が true を返したときだけ)。エディタが破棄されると(ファイルの切り替え・diff タブ・
   * ファイルを閉じる)、反映先から外れる
   */
  attachEditor: (instance: TrackedEditor) => void
}

// 出力パネルからエディタへの反映。反映先のエディタと選択範囲の追跡(useTrackedEditorSelection)と、結果の
// 通知(useTransientNotice)を組み合わせ、反映の可否・反映の実行を決める
export function useApplyOutputToEditor({
  isExecuting
}: UseApplyOutputToEditorOptions): ApplyOutputToEditor {
  const { target, hasSelection, attachEditor } = useTrackedEditorSelection()
  // 通知は数秒後に消す(次の通知が来たら数え直す)
  const { notice, announce, clear } = useTransientNotice(APPLY_NOTICE_DURATION_MS)

  // 通知は直前の反映の結果。実行が始まったら消す(クリアの直後に再実行すると、出力パネルが作り直されて実行中の
  // ヘッダーに前の結果が残る。パターン 87-1)。描画で隠すだけだと、3 秒以内に完了したとき前の通知が戻るため、
  // 状態を消す
  useEffect(() => {
    if (isExecuting) clear()
  }, [isExecuting, clear])

  const { insert: insertDisabledReason, replace: replaceDisabledReason } = getApplyDisabledReasons({
    hasTarget: target !== null,
    isExecuting,
    hasSelection
  })

  const apply = (mode: ApplyMode, text: string): void => {
    const reason = mode === 'insert' ? insertDisabledReason : replaceDisabledReason
    if (reason !== null || target === null) return
    const result = applyToEditor(target, mode, text)
    if (result === 'unavailable') return
    announce(result === 'applied' ? APPLY_NOTICES[mode] : APPLY_NOTICES.rejected)
  }

  return {
    applyOutput: { insertDisabledReason, replaceDisabledReason, apply, notice },
    attachEditor
  }
}
