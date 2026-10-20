import { AGENT_CLI_PROFILES } from './agentCliKinds'
import type { AgentCliKind } from './agentCliKinds'

// エージェントのタブの名前。renderer のタブの表示と、main の OS の通知の題で同じ文言を使う(文言を二重に持たない)

/** タブのラベル(`claude 1`・`copilot 1`)。番号の振り方は renderer の agentSessionTabs の AgentSessionTab.number。
 *  種類は省略させない(省略で claude の名前に流さない。L-060) */
export function formatAgentTabLabel(number: number, kind: AgentCliKind): string {
  return `${AGENT_CLI_PROFILES[kind].commandName} ${number}`
}
