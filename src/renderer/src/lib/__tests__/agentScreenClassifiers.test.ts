import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { AGENT_SCREEN_CLASSIFIERS, classifyAgentScreenFor } from '../agentScreenClassifiers'
import { classifyClaudeScreen } from '../claudeScreenActivity'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import { agentScreen } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'

describe('AGENT_SCREEN_CLASSIFIERS', () => {
  it('種類の一覧のすべてに判定がある', () => {
    expect(Object.keys(AGENT_SCREEN_CLASSIFIERS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は classifyClaudeScreen、copilot は classifyCopilotScreen を引く(CLI どうしの規則を混ぜない)', () => {
    expect(AGENT_SCREEN_CLASSIFIERS.claude).toBe(classifyClaudeScreen)
    expect(AGENT_SCREEN_CLASSIFIERS.copilot).toBe(classifyCopilotScreen)
  })
})

describe('classifyAgentScreenFor', () => {
  it('copilot の作業中の台帳の画面は、copilot の規則で working、claude の規則では working 以外', () => {
    const { lines } = copilotScreen('working3000')
    expect(classifyAgentScreenFor('copilot', lines)).toBe('working')
    expect(classifyAgentScreenFor('claude', lines)).not.toBe('working')
  })

  it('claude の作業中の台帳の画面は、claude の規則で working、copilot の規則では working 以外', () => {
    const { lines } = agentScreen('working')
    expect(classifyAgentScreenFor('claude', lines)).toBe('working')
    expect(classifyAgentScreenFor('copilot', lines)).not.toBe('working')
  })
})
