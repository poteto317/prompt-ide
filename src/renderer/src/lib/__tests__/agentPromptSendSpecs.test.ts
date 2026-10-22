import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_PROMPT_SEND_SPECS } from '../agentPromptSendSpecs'
import { sendClaudePrompt } from '../claudePromptSend'
import { sendCopilotPrompt } from '../copilotPromptSend'

describe('AGENT_PROMPT_SEND_SPECS(CLI の種類ごとの送信の手順)', () => {
  it('種類の一覧のすべてに手順がある', () => {
    expect(Object.keys(AGENT_PROMPT_SEND_SPECS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は活動を見ず(requiresIdle: false)、今の手順(sendClaudePrompt)。溜めた入力はどの失敗でも流す', () => {
    expect(AGENT_PROMPT_SEND_SPECS.claude).toEqual({
      requiresIdle: false,
      send: sendClaudePrompt,
      discardHeldInputOn: new Set()
    })
  })

  it('copilot は入力待ちと中断の流れの外だけ(requiresIdle: true)、sendCopilotPrompt。貼り付けの後の 3 つの失敗では溜めた入力を捨てる', () => {
    expect(AGENT_PROMPT_SEND_SPECS.copilot).toEqual({
      requiresIdle: true,
      send: sendCopilotPrompt,
      discardHeldInputOn: new Set(['not-echoed', 'shell-mode-after-paste', 'not-confirmed'])
    })
  })
})
