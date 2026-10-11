import type { AgentHistoryInfo } from '@shared/types'
import type { AgentPromptSendResult } from './agentPromptSend'

// 送れた(sent)ときの知らせ(AgentSendOptions.onSent)を呼ぶ。確認から送ったとき(useAgentSendConfirm)とすぐ送ったとき
// (useAgentWorkspace)で共有する。知らせには送信の手順を始める時点に控えた送り先(sentTo。null を含む)を渡す。
// 知らせが投げても、呼び出し元の後続(フォーカスの移動・結果の返却)は止めない(L-053)
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: ((sentTo: AgentHistoryInfo | null) => void) | undefined
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent(outcome.sentTo)
  } catch (err) {
    console.error('[notifyAgentSent] onSent failed:', err)
  }
}
