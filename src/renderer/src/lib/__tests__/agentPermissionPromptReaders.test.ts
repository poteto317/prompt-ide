import { describe, it, expect } from 'vitest'
import {
  AGENT_PERMISSION_PROMPT_READERS,
  readAgentPermissionPromptFor
} from '../agentPermissionPromptReaders'
import { readClaudePermissionPrompt } from '../claudePermissionPrompt'
import { readCopilotPermissionPrompt } from '../copilotPermissionPrompt'
import { classifyClaudeScreen } from '../claudeScreenActivity'
import { classifyCopilotScreen } from '../copilotScreenActivity'
import { agentScreen } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { CopilotScreenName } from './fixtures/copilotScreens'
import agentData from './fixtures/agentScreens.json'
import copilotData from './fixtures/copilotScreens.json'

// 種類ごとの読み取りの表と、描画に使う読み取り(agentPermissionPromptReaders.ts)。CLI に依らない規則(agentPermissionPrompt.ts)の
// テストは agentPermissionPrompt.test.ts

describe('AGENT_PERMISSION_PROMPT_READERS', () => {
  it('種類ごとの読み取りを引く', () => {
    expect(AGENT_PERMISSION_PROMPT_READERS.claude).toBe(readClaudePermissionPrompt)
    expect(AGENT_PERMISSION_PROMPT_READERS.copilot).toBe(readCopilotPermissionPrompt)
  })

  // 判定と読み取りがずれないこと(L-041)。台帳に画面が増えても、この 2 つは自動で全画面を見る
  it.each(Object.keys(agentData.screens) as AgentScreenName[])(
    'claude の %s: 読み取りが null でないことと、判定が permission であることが一致する',
    (name) => {
      const { lines } = agentScreen(name)
      expect(AGENT_PERMISSION_PROMPT_READERS.claude(lines) !== null).toBe(
        classifyClaudeScreen(lines) === 'permission'
      )
    }
  )

  it.each(Object.keys(copilotData.screens) as CopilotScreenName[])(
    'copilot の %s: 読み取りが null でないことと、判定が permission であることが一致する',
    (name) => {
      const { lines } = copilotScreen(name)
      expect(AGENT_PERMISSION_PROMPT_READERS.copilot(lines) !== null).toBe(
        classifyCopilotScreen(lines) === 'permission'
      )
    }
  )
})

describe('readAgentPermissionPromptFor', () => {
  it('claude の permission の画面は、claude の読み取りと同じ値', () => {
    const { lines } = agentScreen('permission')
    const prompt = readAgentPermissionPromptFor('claude', lines)
    expect(prompt).not.toBeNull()
    expect(prompt).toEqual(readClaudePermissionPrompt(lines))
  })

  it('copilot の permission の画面は、copilot の読み取りと同じ値', () => {
    const { lines } = copilotScreen('permission')
    const prompt = readAgentPermissionPromptFor('copilot', lines)
    expect(prompt).not.toBeNull()
    expect(prompt).toEqual(readCopilotPermissionPrompt(lines))
  })

  it('許可待ちでない画面は null', () => {
    expect(readAgentPermissionPromptFor('claude', agentScreen('empty').lines)).toBeNull()
  })

  it('別の種類の規則では読まない(copilot の許可の画面を claude として読むと null。L-041)', () => {
    expect(readAgentPermissionPromptFor('claude', copilotScreen('permission').lines)).toBeNull()
  })
})
