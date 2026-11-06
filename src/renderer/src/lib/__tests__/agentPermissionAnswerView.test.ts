import { describe, it, expect } from 'vitest'
import {
  toAgentPermissionAnswerButtonState,
  toAgentPermissionAnswerQuestion
} from '../agentPermissionAnswerView'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'

const PROMPT: AgentPermissionPrompt = {
  body: ['Bash command', 'sleep 3'],
  question: ['Do you want to make this edit to', 'README.md?'],
  options: [
    { number: 1, text: 'Yes' },
    { number: 2, text: "Yes, and don't ask again" },
    { number: 3, text: 'No' }
  ],
  cursorNumber: 1,
  numberKeysAccepted: true,
  bodyStartVisible: true
}

describe('toAgentPermissionAnswerQuestion', () => {
  it('読み取れないなら null', () => {
    expect(toAgentPermissionAnswerQuestion(null)).toBeNull()
  })

  it('1 行目と、行を半角空白でつないだ全文', () => {
    expect(toAgentPermissionAnswerQuestion(PROMPT)).toEqual({
      firstLine: 'Do you want to make this edit to',
      full: 'Do you want to make this edit to README.md?'
    })
  })
})

describe('toAgentPermissionAnswerButtonState', () => {
  it('押せるなら disabledReason は null、名前に問いの全文と選択肢の番号を入れる', () => {
    expect(
      toAgentPermissionAnswerButtonState('allow', 'claude 1', PROMPT, { reason: null })
    ).toEqual({
      disabledReason: null,
      ariaLabel:
        '許可（claude 1 の「Do you want to make this edit to README.md?」に 1 番の Yes で答える）'
    })
    expect(
      toAgentPermissionAnswerButtonState('deny', 'claude 1', PROMPT, { reason: null }).ariaLabel
    ).toBe(
      '拒否（claude 1 の「Do you want to make this edit to README.md?」に 3 番の No で答える）'
    )
  })

  it('押せない理由があっても名前は変えず、理由をそのまま載せる', () => {
    const state = toAgentPermissionAnswerButtonState('allow', 'claude 1', PROMPT, {
      reason: '理由'
    })
    expect(state.disabledReason).toBe('理由')
    expect(state.ariaLabel).toBe(
      '許可（claude 1 の「Do you want to make this edit to README.md?」に 1 番の Yes で答える）'
    )
  })

  it('読み取れないなら、問いと番号の無い名前', () => {
    expect(
      toAgentPermissionAnswerButtonState('deny', 'copilot 2', null, { reason: '理由' })
    ).toEqual({ disabledReason: '理由', ariaLabel: '拒否（copilot 2 の許可の確認に No で答える）' })
  })

  it('その選択肢が無い(Yes が 2 つ)なら、問いと番号の無い名前', () => {
    const prompt: AgentPermissionPrompt = {
      ...PROMPT,
      options: [
        { number: 1, text: 'Yes' },
        { number: 2, text: 'Yes' },
        { number: 3, text: 'No' }
      ]
    }
    expect(
      toAgentPermissionAnswerButtonState('allow', 'claude 1', prompt, { reason: null }).ariaLabel
    ).toBe('許可（claude 1 の許可の確認に Yes で答える）')
  })

  it('名前に入れる問いは全文(折り返した 2 行目のファイル名も入る)', () => {
    const question = toAgentPermissionAnswerQuestion(PROMPT)
    for (const choice of ['allow', 'deny'] as const) {
      const { ariaLabel } = toAgentPermissionAnswerButtonState(choice, 'claude 1', PROMPT, {
        reason: null
      })
      expect(ariaLabel).toContain(`「${question?.full}」`)
      expect(ariaLabel).toContain('README.md?')
    }
  })
})
