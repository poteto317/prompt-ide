// エージェントのタブの名前。renderer のタブの表示と、main の OS の通知の題で同じ文言を使う(文言を二重に持たない)

/** タブのラベル(番号の振り方は renderer の agentSessionTabs の AgentSessionTab.number) */
export function formatAgentTabLabel(number: number): string {
  return `claude ${number}`
}
