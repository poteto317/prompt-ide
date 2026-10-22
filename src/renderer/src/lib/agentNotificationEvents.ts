import type { AgentNotificationKind } from '@shared/types'
import { agentNotificationText } from '@shared/agentNotificationText'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import { isAgentActivityWaitingForUser } from './agentActivity'
import type { AgentSessionStatus } from './agentSessionTabState'

// タブの活動の変化から、知らせる出来事・読み上げの文言・待っているタブの数を決める純粋な関数(設計書「知らせる出来事」)。
// 判定そのもの(agentActivity)は変えない。読み上げ・IPC の送信は useAgentNotifications が受け持つ

export type { AgentNotificationKind }

export interface AgentNotificationTab {
  slotId: string
  /** タブの番号(題・読み上げの claude N・copilot N の番号) */
  number: number
  status: AgentSessionStatus
  /** 閉じる途中(知らせず、バッジに数えない) */
  isClosing: boolean
  /** タブの CLI の種類(題・読み上げの名前。タブの名前と同じ値〈AgentSessionTabView.cliKind〉で、名前と題が食い違わない) */
  cliKind: AgentCliKind
}

/**
 * 知らせる出来事 1 件。読み上げ(設定に関わらず)と OS の通知の依頼(AgentNotificationShowRequest と同じ形でそのまま送る)の
 * 両方の元になるため、IPC の型とは別に持つ(IPC の入力を変えても、出来事の決定・読み上げの文言は巻き込まない)
 */
export interface AgentNotificationEvent {
  slotId: string
  /** タブの番号(題・読み上げの claude N・copilot N の番号) */
  tabNumber: number
  kind: AgentNotificationKind
  /** タブの CLI の種類(題・読み上げの名前) */
  cliKind: AgentCliKind
}

export interface AgentNotificationDecision {
  /** 知らせる出来事。知らせなければ null */
  kind: AgentNotificationKind | null
  /** 次に覚える最後の確かな活動(next が unknown なら lastSettled のまま) */
  settled: AgentActivity | null
}

/**
 * 最後の確かな活動(unknown を除いた直近の活動。起動の直後は null)と新しい活動から出来事を決める。
 * unknown は判定できなかっただけなので覚え直さない(working → unknown → permission も working → permission と同じ)。
 * 起動の直後の idle は知らせず、confirm(フォルダの信頼の確認など)・permission は利用者の操作が要るので知らせる
 */
export function nextAgentNotification(
  lastSettled: AgentActivity | null,
  next: AgentActivity
): AgentNotificationDecision {
  if (next === 'unknown') return { kind: null, settled: lastSettled }
  if (next === lastSettled) return { kind: null, settled: next }
  if (isAgentActivityWaitingForUser(next)) return { kind: next, settled: next }
  if (next === 'idle' && lastSettled === 'working') return { kind: 'done', settled: next }
  return { kind: null, settled: next }
}

/** タブの一覧全体の出来事の決定の結果 */
export interface AgentNotificationAdvance {
  /** 次に覚える、タブごとの最後の確かな活動 */
  settled: Map<string, AgentActivity>
  /** 知らせる出来事(タブの並び順) */
  events: AgentNotificationEvent[]
  /**
   * 待っている状態が終わったタブ(最後の確かな活動が permission・confirm から working・idle へ変わったタブ、または
   * permission・confirm のまま running でなくなった(終了した)タブ)の slotId。
   * 許可・選択に答えた後に「許可待ち」「確認待ち」の通知を残さないよう、閉じる依頼に使う(タブの並び順。閉じる途中のタブも含む)
   */
  finishedWaiting: string[]
}

/**
 * タブごとの最後の確かな活動と今の活動から、知らせる出来事を決める(渡された記録は書き換えず、新しい記録を返す)。
 * 消えたタブ・running でないタブの記録は消す(消し忘れると、再起動の直後の idle を working → idle の完了と誤って知らせる)。
 * 閉じる途中のタブは記録だけ進めて知らせない(停止に失敗して戻ったときに、古い記録で誤って知らせない)
 */
export function advanceAgentNotifications(
  previous: ReadonlyMap<string, AgentActivity>,
  tabs: readonly AgentNotificationTab[],
  activities: ReadonlyMap<string, AgentActivity>
): AgentNotificationAdvance {
  const settled = new Map<string, AgentActivity>()
  const events: AgentNotificationEvent[] = []
  const finishedWaiting: string[] = []
  for (const tab of tabs) {
    const lastSettled = previous.get(tab.slotId) ?? null
    if (tab.status !== 'running') {
      // 待っている最中にセッションが終わった(終了・異常終了)。バッジは消えるので通知も閉じる。記録は消えるので 1 回だけ頼む
      if (lastSettled !== null && isAgentActivityWaitingForUser(lastSettled)) {
        finishedWaiting.push(tab.slotId)
      }
      continue
    }
    const decision = nextAgentNotification(lastSettled, activities.get(tab.slotId) ?? 'unknown')
    if (decision.settled !== null) settled.set(tab.slotId, decision.settled)
    // 待っている活動から待っていない確かな活動へ移った。この移り変わりは出来事にならない(permission → idle は完了ではない)ので、
    // 同じ回に同じタブの通知を出すことは無い。念のため出来事がある回は閉じない(入れ替わりに任せる)
    if (
      decision.kind === null &&
      lastSettled !== null &&
      isAgentActivityWaitingForUser(lastSettled) &&
      decision.settled !== null &&
      !isAgentActivityWaitingForUser(decision.settled)
    ) {
      finishedWaiting.push(tab.slotId)
    }
    if (decision.kind === null || tab.isClosing) continue
    events.push({
      slotId: tab.slotId,
      tabNumber: tab.number,
      kind: decision.kind,
      cliKind: tab.cliKind
    })
  }
  return { settled, events, finishedWaiting }
}

/**
 * 前のタブの一覧にあって今の一覧に無いタブ(閉じたタブ)の slotId を、前の並び順で返す。そのタブの残っている OS の通知を閉じる
 * ために使う(タブの番号は使い回されるので、残すと同じ題の通知が並ぶ)。running でない・閉じる途中のタブは一覧に残っている間は
 * 消えたとしない。最後の確かな活動の記録(running でないタブは消える)ではなく一覧で比べ、終了してから閉じたタブも拾う
 */
export function findRemovedAgentNotificationTabs(
  previous: readonly AgentNotificationTab[],
  tabs: readonly AgentNotificationTab[]
): string[] {
  const current = new Set(tabs.map((tab) => tab.slotId))
  return previous.filter((tab) => !current.has(tab.slotId)).map((tab) => tab.slotId)
}

/** 同時に決まった出来事の読み上げの文言(1 回の読み上げにまとめる。タブの並び順のまま「。」でつなぐ) */
export function formatAgentNotificationAnnouncement(
  events: readonly AgentNotificationEvent[]
): string {
  return events
    .map(
      ({ kind, tabNumber, cliKind }) => agentNotificationText(kind, tabNumber, cliKind).announcement
    )
    .join('。')
}

/** 利用者の操作を待っているタブの数。今の活動ではなく最後の確かな活動で数える(判定の一時的な unknown で数が揺れないように) */
export function countAgentTabsWaitingForUser(
  tabs: readonly AgentNotificationTab[],
  settled: ReadonlyMap<string, AgentActivity>
): number {
  return tabs.filter(
    (tab) =>
      tab.status === 'running' &&
      !tab.isClosing &&
      isAgentActivityWaitingForUser(settled.get(tab.slotId) ?? 'unknown')
  ).length
}
