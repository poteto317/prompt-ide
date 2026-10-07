'use client'
import { toAnnouncementText } from '../../lib/announcementText'
import type { AgentDiffActions, Announcement } from '../../types'

interface NoticesProps {
  agentActions: AgentDiffActions
  /** 戻すボタンの aria-describedby が指す理由の段落の id(DiffView が useId で作り、ボタンと共有する) */
  reasonId: string
}

/**
 * エージェントの変更の diff の上部に出す、このタブのパスの直前の失敗と、戻すボタンを押せない理由。
 * 失敗は見た目だけに出す(role="alert" にしない)。ハンクの失敗は AgentDiffAnnouncer だけが読み上げ(セクションは見た目だけ)、
 * ファイルの失敗はセクションの alert が読み上げる。diff は戻した後に作り直されるため、ここに alert を置くと読み上げが不確か・二重になる
 */
export function AgentDiffNotices({ agentActions, reasonId }: NoticesProps): React.JSX.Element {
  return (
    <>
      {agentActions.error !== null && <p className="diff-view__error">{agentActions.error}</p>}
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

/**
 * ハンクを戻した結果(成功・失敗)の読み上げ(視覚的には隠す)。戻すと diff が作り直されて押したボタンが消え、最後のハンクなら
 * タブも閉じるため、EditorPanel が diff タブの外(タブと本文の外)に常設し、同じ要素に文言を入れる(パターン 87)。
 * role="status" を付けないのは ExternalChangeAnnouncer と同じ理由(出力パネルの常設の status と重ねない)
 */
export function AgentDiffAnnouncer({ notice }: { notice: Announcement | null }): React.JSX.Element {
  return (
    <span className="agent-diff__live" aria-live="polite" aria-atomic="true">
      {toAnnouncementText(notice)}
    </span>
  )
}
