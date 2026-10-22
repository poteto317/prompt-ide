import type { AgentPromptSendResult } from './agentPromptSend'
import type { AgentSentHandler } from './agentPromptRequest'

// 送れた(sent)ときの知らせ(AgentSendOptions.onSent)を呼ぶ。確認から送ったとき(useAgentSendConfirm)とすぐ送ったとき
// (useAgentWorkspace)で共有する。知らせには送信の手順を始める時点に控えた送り先(sentTo。null を含む)と、送り先の CLI の種類を渡す。
// 知らせが投げても、呼び出し元の後続(フォーカスの移動・結果の返却)は止めない(L-053)
export function notifyAgentSent(
  outcome: AgentPromptSendResult | undefined,
  onSent: AgentSentHandler | undefined
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent(outcome.sentTo, outcome.cliKind)
  } catch (err) {
    console.error('[notifyAgentSent] onSent failed:', err)
  }
}
