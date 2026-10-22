// エージェントの完了・許可待ちの通知の IPC の型。main・preload・renderer が共有する
import type { AgentCliKind } from '../agentCliKinds'

/** 知らせる出来事(許可待ち・確認待ち・作業の完了) */
export const AGENT_NOTIFICATION_KINDS = ['permission', 'confirm', 'done'] as const
export type AgentNotificationKind = (typeof AGENT_NOTIFICATION_KINDS)[number]

export function isAgentNotificationKind(value: unknown): value is AgentNotificationKind {
  return (
    typeof value === 'string' && (AGENT_NOTIFICATION_KINDS as readonly string[]).includes(value)
  )
}

/** agentNotification:show の入力。題・本文は main が固定の表から作る(renderer の文字列を通知に出さない) */
export interface AgentNotificationShowRequest {
  slotId: string
  /** タブの番号(題の `claude N`・`copilot N` の番号にだけ使う) */
  tabNumber: number
  kind: AgentNotificationKind
  /** タブの CLI の種類(題の名前にだけ使う。main が isAgentCliKind で検証する。押したときに届く先は slotId で決まる) */
  cliKind: AgentCliKind
}

/** agentNotification:setBadge の入力(利用者の操作を待っているタブの数) */
export interface AgentNotificationBadgeRequest {
  count: number
}

/** agentNotification:dismiss の入力(そのタブの残っている通知を閉じる。送る契機は設計書「main」の Notification インスタンスの保持を参照) */
export interface AgentNotificationDismissRequest {
  slotId: string
}

/** agentNotification:activated(通知を押した)で main から届く */
export interface AgentNotificationActivated {
  slotId: string
}
