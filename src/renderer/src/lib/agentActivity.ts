// エージェント CLI の活動の型と、利用者の操作を待っている活動の表(CLI に依らない)。画面からの判定は CLI ごとの関数
// (claudeScreenActivity.ts・copilotScreenActivity.ts)で、種類ごとの表は agentScreenClassifiers.ts(設計書 2026-10-21「判定の表」)

export type AgentActivity = 'working' | 'idle' | 'permission' | 'confirm' | 'unknown'

/**
 * 利用者の操作を待っている活動か。ステータスバーの強調(agentActivitySummary)・通知の出来事とバッジの数
 * (agentNotificationEvents)が同じ集まりを使う(片方だけ足すと、強調されるのに通知されない食い違いが出る)。
 * 活動を増やしたときに決め忘れを型エラーにするため Record で持つ
 */
const WAITING_FOR_USER = {
  working: false,
  idle: false,
  permission: true,
  confirm: true,
  unknown: false
} as const satisfies Record<AgentActivity, boolean>

/** 利用者の操作を待っている活動(通知の出来事の種類にもなる) */
export type AgentActivityWaitingForUser = {
  [K in AgentActivity]: (typeof WAITING_FOR_USER)[K] extends true ? K : never
}[AgentActivity]

export function isAgentActivityWaitingForUser(
  activity: AgentActivity
): activity is AgentActivityWaitingForUser {
  return WAITING_FOR_USER[activity]
}
