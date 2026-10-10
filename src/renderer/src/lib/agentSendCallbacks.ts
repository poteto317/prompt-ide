import type { AgentSendOutcome } from './agentPromptSend'

// 送れた(sent)ときの知らせ(AgentSendOptions.onSent)を呼ぶ。確認から送ったとき(useAgentSendConfirm)とすぐ送ったとき
// (useAgentWorkspace)で共有する。知らせが投げても、呼び出し元の後続(フォーカスの移動・結果の返却)は止めない(L-053)
export function notifyAgentSent(
  outcome: AgentSendOutcome | undefined,
  onSent: (() => void) | undefined
): void {
  if (outcome?.kind !== 'sent' || onSent === undefined) return
  try {
    onSent()
  } catch (err) {
    console.error('[notifyAgentSent] onSent failed:', err)
  }
}
