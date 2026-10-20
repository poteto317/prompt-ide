import type { AgentNotificationKind } from './types/agentNotification'
import { formatAgentTabLabel } from './agentTabLabel'

// 通知の文言の表(設計書「知らせる出来事」)。OS の通知の題・本文は main がここから作り、renderer は読み上げだけを使う

export interface AgentNotificationText {
  /** OS の通知の題 */
  title: string
  /** OS の通知の本文 */
  body: string
  /** アプリ内の aria-live の読み上げ */
  announcement: string
}

/** 出来事ごとの文言。出来事を増やしたときに足し忘れを型エラーにするため Record で持つ */
const TEXTS: Record<AgentNotificationKind, (label: string) => AgentNotificationText> = {
  permission: (label) => ({
    title: `${label}: 許可待ち`,
    body: 'ツールの実行の許可を待っています',
    announcement: `${label} が許可待ちになりました`
  }),
  confirm: (label) => ({
    title: `${label}: 確認待ち`,
    body: '選択を待っています',
    announcement: `${label} が確認待ちになりました`
  }),
  done: (label) => ({
    title: `${label}: 作業が終わりました`,
    body: '次の指示を待っています',
    announcement: `${label} の作業が終わりました`
  })
}

export function agentNotificationText(
  kind: AgentNotificationKind,
  tabNumber: number
): AgentNotificationText {
  // 通知は画面の判定(screenActivity)が true の種類でだけ出るため claude の名前にする(種類を通知の依頼に足すのは段階 2)
  return TEXTS[kind](formatAgentTabLabel(tabNumber, 'claude'))
}
