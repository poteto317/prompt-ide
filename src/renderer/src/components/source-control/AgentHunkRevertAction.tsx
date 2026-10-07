'use client'
import type { AgentDiffActions } from '../../types'

interface NoticesProps {
  agentActions: AgentDiffActions
  /** 戻すボタンの aria-describedby が指す理由の段落の id(DiffView が useId で作り、ボタンと共有する) */
  reasonId: string
}

/** エージェントの変更の diff の上部に出す、直前の失敗(role="alert")と、戻すボタンを押せない理由 */
export function AgentDiffNotices({ agentActions, reasonId }: NoticesProps): React.JSX.Element {
  return (
    <>
      {agentActions.error !== null && (
        <p className="diff-view__error" role="alert">
          {agentActions.error}
        </p>
      )}
      {/* 戻すボタンを押せない理由(1 か所に出してボタンから参照する。パターン 126) */}
      {agentActions.canRevertHunk && agentActions.disabledReason !== null && (
        <p id={reasonId} className="diff-view__notice">
          {agentActions.disabledReason}
        </p>
      )}
    </>
  )
}

interface ActionProps {
  agentActions: AgentDiffActions
  /** AgentDiffNotices の理由の段落の id */
  reasonId: string
  /** 実行中の多重クリック防止 */
  disabled: boolean
  hunkHeader: string
  /** 押したときだけ全量の diff からパッチを組み立てる(描画のたびに作らない) */
  getPatch: () => string
}

/** 1 つのハンクの「このハンクを実行前に戻す」ボタン。戻せないハンク(canRevertHunk=false)では何も出さない */
export default function AgentHunkRevertAction({
  agentActions,
  reasonId,
  disabled,
  hunkHeader,
  getPatch
}: ActionProps): React.JSX.Element | null {
  if (!agentActions.canRevertHunk) return null
  return (
    <span className="diff-view__hunk-actions">
      <button
        type="button"
        className="diff-view__hunk-action-btn diff-view__hunk-action-btn--danger"
        disabled={disabled || agentActions.disabledReason !== null}
        aria-describedby={agentActions.disabledReason !== null ? reasonId : undefined}
        onClick={() => agentActions.onRevertHunk(getPatch(), hunkHeader)}
      >
        このハンクを実行前に戻す
      </button>
    </span>
  )
}
