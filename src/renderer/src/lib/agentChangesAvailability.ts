import type { AgentChangesUnavailableReason } from '@shared/types'
import type { AgentChangesRunningOperation, AgentChangesView } from '../types'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_BUSY_LOADING,
  AGENT_CHANGES_BUSY_REVERTING,
  AGENT_CHANGES_BUSY_UNDOING,
  AGENT_CHANGES_LIST_FAILED,
  AGENT_CHANGES_NOT_RECORDED_REASON,
  AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
  AGENT_CHANGES_TRUNCATED_REASON
} from './agentChangesMessages'

// エージェントの変更のセクションで、ボタンを押せる条件(設計書「A の詳細」)。文言は agentChangesMessages.ts に置き、
// ここは「押せない理由」を選ぶ優先順位の規則と、セクションを出すかの判定(isAgentChangesSectionVisible)を持つ。押せないボタンには必ず理由を返す(パターン 126)。
// セクションの表示は評価の順序に依存する(すべて戻すの理由がファイル単位の理由を先に評価するため、同じ文言になる)

/** セクション「エージェントの変更」を出すか。エージェント CLI 方式では常に、従来の方式では記録がある間だけ。
 *  セクションの描画(AgentChangesSection)と、消えたときのフォーカスの移動(useAgentChangesClearFocus)が同じ規則を使う */
export function isAgentChangesSectionVisible(
  isAgentMode: boolean,
  viewKind: AgentChangesView['kind']
): boolean {
  return isAgentMode || viewKind === 'recording'
}

/** 「もう一度試す」を出す理由(記録の失敗。フォルダの種類による理由は出さない) */
export function canRetryAgentChanges(reason: AgentChangesUnavailableReason): boolean {
  return reason === 'timeout' || reason === 'git-failed'
}

export interface AgentRevertAvailability {
  /** 一覧の取得中 */
  isLoading: boolean
  /** 他の Git 操作の実行中。useAgentChangesRevert は FileOperationLock の isAnyLocked() だけを渡す
   *  (作業ツリーや index を書き換える操作のロック。push・fetch など isAnyGitOperationRunning だけが見る操作は含まない) */
  isGitBusy: boolean
  /** 戻す操作・取り消しの実行中(実行の共有の実行中の印) */
  runningOperation: AgentChangesRunningOperation | null
  /** 直前の一覧の取得が失敗した(古い一覧で戻さない) */
  hasListError: boolean
  /** 選んでいる範囲か、表示中の一覧の範囲が実行(実行ごとの表示は見るだけ) */
  isRunScope: boolean
}

/** 戻す操作・取り消しの実行中の理由(実行中でなければ null)。戻す・取り消しのどちらのボタンも最初に見る */
export function agentChangesRunningReason(
  runningOperation: AgentChangesRunningOperation | null
): string | null {
  if (runningOperation === 'revert') return AGENT_CHANGES_BUSY_REVERTING
  if (runningOperation === 'undo') return AGENT_CHANGES_BUSY_UNDOING
  return null
}

/** ファイル・ハンクを戻すボタンを押せない理由(押せるなら null)。セクションの上に 1 か所で出す */
export function agentRevertDisabledReason(availability: AgentRevertAvailability): string | null {
  const running = agentChangesRunningReason(availability.runningOperation)
  if (running !== null) return running
  if (availability.hasListError) return AGENT_CHANGES_LIST_FAILED
  if (availability.isLoading) return AGENT_CHANGES_BUSY_LOADING
  if (availability.isGitBusy) return AGENT_CHANGES_BUSY_GIT
  if (availability.isRunScope) return AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE
  return null
}

/** 「すべて戻す」を押せない理由。打ち切った一覧では使えない(確認で見せていない行を照合に含められない)。
 *  記録していない行(notRecorded)を含む一覧でも使えない(main が全件を先に調べ、戻せない行があれば必ず全体を中止するため) */
export function agentRevertAllDisabledReason(
  availability: AgentRevertAvailability & { truncated: boolean; hasNotRecorded: boolean }
): string | null {
  return (
    agentRevertDisabledReason(availability) ??
    (availability.truncated ? AGENT_CHANGES_TRUNCATED_REASON : null) ??
    (availability.hasNotRecorded ? AGENT_CHANGES_NOT_RECORDED_REASON : null)
  )
}

/**
 * 「戻した操作を取り消す」を押せない理由(押せるなら null)。戻す操作・取り消しの実行中と、他の Git 操作の実行中の 2 つだけ
 * (取り消しは一覧を使わないため、一覧の取得中・失敗では押せる)
 */
export function agentUndoDisabledReason(
  availability: Pick<AgentRevertAvailability, 'runningOperation' | 'isGitBusy'>
): string | null {
  const running = agentChangesRunningReason(availability.runningOperation)
  if (running !== null) return running
  if (availability.isGitBusy) return AGENT_CHANGES_BUSY_GIT
  return null
}
