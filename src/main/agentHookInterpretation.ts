import { parseAgentHookRequest } from './agentHookEvents'
import type { AgentHookBody, AgentHookParseResult } from './agentHookEvents'
import { parseCopilotHookRequest, resolveCopilotHookNotice } from './agentCopilotHookEvents'
import type { AgentHookRoute } from './agentHookProtocol'
import type { AgentHookOwner } from './agentHookReceiverRequest'

// 受け付けた要求の本文を、経路(CLI の種類とイベント)ごとに追跡へ渡す知らせにする(設計書「受け口」、段階 3b の設計書「入力の解釈と
// 会話の ID の振り分け」)。claude は agentHookEvents.ts の解釈だけ、copilot は agentCopilotHookEvents.ts の解釈と主の会話の ID の
// 振り分けを通し、トークンの持ち主の状態を書き戻す。受け口(agentHookReceiver.ts)は本文を読み終えた後に await を挟まずに呼ぶ

/**
 * 経路ごとに本文を知らせにする。copilot は持ち主の主の会話の ID の状態を読み、振り分け、書き戻す(await を挟まない)。
 * 経路の種類と持ち主の種類は checkAgentHookRequest が照らし合わせ済み(食い違いは届かない。届いたら例外 → 受け口が 200)
 */
export function interpretAgentHookRequest(
  route: AgentHookRoute,
  owner: AgentHookOwner,
  body: AgentHookBody
): AgentHookParseResult {
  if (route.cliKind === 'claude') return parseAgentHookRequest(route.event, body)
  const cli = owner.cli
  if (cli.kind !== 'copilot') throw new Error('経路と持ち主の CLI の種類が違います')
  const { notice, notes } = parseCopilotHookRequest(route.event, body)
  const resolved = resolveCopilotHookNotice(cli.main, notice)
  cli.main = resolved.main
  return { event: resolved.event, notes }
}
