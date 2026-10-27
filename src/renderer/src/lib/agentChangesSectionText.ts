import type { AgentChangesScope } from '@shared/types'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentChangesView } from '../types'
import {
  AGENT_CHANGES_APP_STORAGE_HINT,
  AGENT_CHANGES_APP_STORAGE_NOTE,
  buildAgentChangesHeading,
  buildAgentChangesRunHeading,
  describeAgentChangesAttribution,
  describeAgentChangesScopeUnavailable,
  formatAgentChangesExcludedNote
} from './agentChangesMessages'
import { findAgentChangesRun, getListedAgentChanges } from './agentChangesScope'

// セクション「エージェントの変更」の、写しと選んでいる範囲(除く旨は除く件数も)から決まる文字(見出し・範囲の一覧が取れない理由・
// 区別の状態の 1 行・すべて戻すから除く旨・記録の置き場の注記)と、押せないボタンが結ぶ理由の要素の導出(agentChangesReasonTargets)。AgentChangesSection から外して、描画なしで検査できるようにする

/**
 * 見出し。範囲が実行で、写しの実行の一覧にあれば実行の番号と期間を、それ以外は累積の始点を添える。
 * 件数は範囲の一覧が取れているときだけ(打ち切る前の全件数)
 */
export function buildAgentChangesSectionHeading(
  view: AgentChangesView,
  scope: AgentChangesScope
): string {
  if (view.kind !== 'recording') return buildAgentChangesHeading(null)
  const totalCount = getListedAgentChanges(view)?.totalCount ?? null
  const selectedRun = scope.kind === 'run' ? findAgentChangesRun(view.runs, scope.runId) : undefined
  return selectedRun !== undefined
    ? buildAgentChangesRunHeading(selectedRun, totalCount)
    : buildAgentChangesHeading({ startedAt: view.startedAt, totalCount })
}

/**
 * 範囲の一覧が取れない(写しが古い)理由。run-missing は useAgentChanges が累積に戻して取り直すため出さない(null)。
 * 一覧が取れない状態でなければ null
 */
export function describeAgentChangesListUnavailable(view: AgentChangesView): string | null {
  if (view.kind !== 'recording' || view.list?.kind !== 'scope-unavailable') return null
  const { reason, scope } = view.list
  if (reason === 'run-missing') return null
  return describeAgentChangesScopeUnavailable(
    reason,
    scope.kind === 'run' ? findAgentChangesRun(view.runs, scope.runId) : undefined
  )
}

/**
 * 区別の状態の 1 行。記録中で、選んでいる範囲が累積で、表示中の一覧が実行の範囲でないときだけ出す(出さないなら null)。
 * 文言は describeAgentChangesAttribution が決める。cliKind は設定の種類(文言の CLI の名前と精度の注記)
 */
export function describeAgentChangesSectionAttribution(
  view: AgentChangesView,
  scope: AgentChangesScope,
  cliKind: AgentCliKind
): string | null {
  if (view.kind !== 'recording' || scope.kind !== 'all') return null
  if (getListedAgentChanges(view)?.scope.kind === 'run') return null
  return describeAgentChangesAttribution(view.attribution, view.startedAt, cliKind)
}

/**
 * すべて戻すから除く行の旨。表示中の一覧に行があり、実行の範囲の一覧でなく、除く件数(useAgentChangesRevert の
 * revertAllExcludedCount)が 1 以上のときだけ出す(出さないなら null)
 */
export function describeAgentChangesSectionExcluded(
  view: AgentChangesView,
  excludedCount: number
): string | null {
  const list = getListedAgentChanges(view)
  if (list === null || list.entries.length === 0 || list.scope.kind === 'run') return null
  return excludedCount > 0 ? formatAgentChangesExcludedNote(excludedCount) : null
}

/**
 * 記録の置き場の注記(出さないなら null)。記録中は記録が隠れた git(storage: 'app')のとき NOTE(記録中に git init してパネルが
 * リポジトリの表示に変わっても、記録が隠れた git のままなら出し続ける)。記録が無い間は Git 管理外のフォルダのとき HINT。
 * 記録できない理由が出ている間は出さない(理由の文と重ねない)
 */
export function describeAgentChangesStorage(
  view: AgentChangesView,
  isNotRepository: boolean
): string | null {
  if (view.kind === 'recording')
    return view.storage === 'app' ? AGENT_CHANGES_APP_STORAGE_NOTE : null
  if (view.kind === 'none') return isNotRepository ? AGENT_CHANGES_APP_STORAGE_HINT : null
  return null
}

/** 押せないボタンが結ぶ理由の要素: 一覧の上の理由(list)・取り消しの帯の理由(undo)・結ばない(null) */
export type AgentChangesReasonTarget = 'list' | 'undo' | null

/**
 * 範囲の選択・確認を終えるが結ぶ理由の要素と、セクションに取り消しの理由を出すか(押せないボタンには必ず理由を結ぶ。パターン 126)。
 * 戻す操作・取り消しの実行中(isWriting)は、一覧の上の理由があればそれ、無ければ帯の理由を結ぶ。帯が先に消えたとき
 * (取り消しの結果で写しの undo が null になった)は、セクションに同じ id の理由を出す。
 * 実行中でなければ、範囲の選択は一覧の上の理由があればそれを結び、確認を終えるは押せるので結ばない
 */
export function agentChangesReasonTargets({
  isWriting,
  hasListReason,
  hasUndoBand
}: {
  isWriting: boolean
  hasListReason: boolean
  hasUndoBand: boolean
}): {
  scopeSelect: AgentChangesReasonTarget
  clear: AgentChangesReasonTarget
  showSectionUndoReason: boolean
} {
  const writing: AgentChangesReasonTarget = hasListReason ? 'list' : 'undo'
  return {
    scopeSelect: isWriting ? writing : hasListReason ? 'list' : null,
    clear: isWriting ? writing : null,
    showSectionUndoReason: isWriting && !hasListReason && !hasUndoBand
  }
}
