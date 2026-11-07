import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_PROMPT_SEND_SPECS } from '../agentPromptSendSpecs'
import { sendClaudePrompt } from '../claudePromptSend'
import { sendCopilotPrompt } from '../copilotPromptSend'
import type { AgentActivity } from '../agentActivity'
import { isAgentActivityWaitingForUser } from '../agentActivity'

describe('AGENT_PROMPT_SEND_SPECS(CLI の種類ごとの送信の手順)', () => {
  it('種類の一覧のすべてに手順がある', () => {
    expect(Object.keys(AGENT_PROMPT_SEND_SPECS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は作業中も送り(requiresIdle: false)、今の手順(sendClaudePrompt)。溜めた入力は許可待ち・確認待ちで止めたときだけ捨てる', () => {
    expect(AGENT_PROMPT_SEND_SPECS.claude).toEqual({
      requiresIdle: false,
      send: sendClaudePrompt,
      discardHeldInputOn: new Set(['screen-permission', 'screen-confirm'])
    })
  })

  it('claude の溜めた入力を捨てる失敗は、利用者の操作を待つ活動の screen-* とちょうど一致する(活動を足したときの書き漏れを防ぐ)', () => {
    // Record で全活動を並べ、活動を足したらここが型エラーになるようにする
    const allActivities: Record<AgentActivity, true> = {
      working: true,
      idle: true,
      permission: true,
      confirm: true,
      unknown: true
    }
    const activities = Object.keys(allActivities) as AgentActivity[]
    const expected = activities
      .filter((activity) => isAgentActivityWaitingForUser(activity))
      .map((activity) => `screen-${activity}`)
    const actual = [...AGENT_PROMPT_SEND_SPECS.claude.discardHeldInputOn].filter((reason) =>
      reason.startsWith('screen-')
    )
    expect(actual.sort()).toEqual(expected.sort())
  })

  it('copilot は入力待ちと中断の流れの外だけ(requiresIdle: true)、sendCopilotPrompt。貼り付けの後の 3 つの失敗では溜めた入力を捨てる', () => {
    expect(AGENT_PROMPT_SEND_SPECS.copilot).toEqual({
      requiresIdle: true,
      send: sendCopilotPrompt,
      discardHeldInputOn: new Set(['not-echoed', 'shell-mode-after-paste', 'not-confirmed'])
    })
  })
})
