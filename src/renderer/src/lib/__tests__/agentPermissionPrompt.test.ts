import { describe, it, expect } from 'vitest'
import {
  AGENT_PERMISSION_OPTION_WORDS,
  findAgentPermissionOption,
  isSameAgentPermissionPrompt,
  isSameAgentPermissionPromptState,
  isWellFormedAgentPermissionOptions
} from '../agentPermissionPrompt'
import type { AgentPermissionPrompt } from '../agentPermissionPrompt'
import { readClaudePermissionPrompt } from '../claudePermissionPrompt'
import { readCopilotPermissionPrompt } from '../copilotPermissionPrompt'
import { agentScreen } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'

const BASE: AgentPermissionPrompt = {
  body: ['Bash command', 'sleep 3'],
  question: ['Do you want to proceed?'],
  options: [
    { number: 1, text: 'Yes' },
    { number: 2, text: 'No' }
  ],
  cursorNumber: 1,
  numberKeysAccepted: true,
  bodyStartVisible: true
}

describe('findAgentPermissionOption', () => {
  it('allow は文言がちょうど Yes の選択肢', () => {
    expect(findAgentPermissionOption(BASE, 'allow')).toEqual({ number: 1, text: 'Yes' })
  })

  it.each(['No', 'No, and tell Copilot what to do differently (Esc to stop)'])(
    'deny は No そのものか No, で始まる選択肢: %s',
    (text) => {
      const prompt = {
        options: [
          { number: 1, text: 'Yes' },
          { number: 2, text }
        ]
      }
      expect(findAgentPermissionOption(prompt, 'deny')).toEqual({ number: 2, text })
    }
  )

  it.each(['Yes, and always allow access', 'Yes, and switch to auto mode', 'yes'])(
    '「今後は確かめない」系・大文字小文字の違う %s は allow にしない',
    (text) => {
      expect(findAgentPermissionOption({ options: [{ number: 1, text }] }, 'allow')).toBeNull()
    }
  )

  it.each(['Not now', 'Nothing', 'Nope', 'no'])('%s は deny にしない', (text) => {
    expect(findAgentPermissionOption({ options: [{ number: 1, text }] }, 'deny')).toBeNull()
  })

  it('選択肢の語は allow が Yes・deny が No(規則と文言が同じ語を使う)', () => {
    expect(AGENT_PERMISSION_OPTION_WORDS).toEqual({ allow: 'Yes', deny: 'No' })
  })

  it.each(['allow', 'deny'] as const)('%s は選択肢の語そのものの選択肢に当たる', (choice) => {
    const text = AGENT_PERMISSION_OPTION_WORDS[choice]
    expect(findAgentPermissionOption({ options: [{ number: 3, text }] }, choice)).toEqual({
      number: 3,
      text
    })
  })

  it('当たる選択肢が 2 つ以上なら null', () => {
    const prompt = {
      options: [
        { number: 1, text: 'No' },
        { number: 2, text: 'No, thanks' }
      ]
    }
    expect(findAgentPermissionOption(prompt, 'deny')).toBeNull()
  })
})

describe('isSameAgentPermissionPrompt', () => {
  it('claude の permission と permissionAfterClear は同じ', () => {
    const a = readClaudePermissionPrompt(agentScreen('permission').lines)
    const b = readClaudePermissionPrompt(agentScreen('permissionAfterClear').lines)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(
      isSameAgentPermissionPrompt(a as AgentPermissionPrompt, b as AgentPermissionPrompt)
    ).toBe(true)
  })

  it('カーソルだけが違う copilot の permission と permissionDown は同じ(カーソル・番号キーは比べない)', () => {
    const a = readCopilotPermissionPrompt(copilotScreen('permission').lines)
    const b = readCopilotPermissionPrompt(copilotScreen('permissionDown').lines)
    expect(
      isSameAgentPermissionPrompt(a as AgentPermissionPrompt, b as AgentPermissionPrompt)
    ).toBe(true)
  })

  it.each<[string, Partial<AgentPermissionPrompt>]>([
    ['本文の 1 行(コマンド)', { body: ['Bash command', 'rm -rf build'] }],
    ['本文の行の数', { body: ['Bash command'] }],
    ['問い', { question: ['Do you want to make this edit?'] }],
    // 後ろの引数のほうが長い向き(長さの確かめが無いと a.every は a 側しか走らない)
    ['本文の行が後ろに増えた', { body: [...BASE.body, 'extra'] }],
    [
      '問いの行が後ろに増えた(折り返してファイル名が増えた)',
      { question: [...BASE.question, 'extra.ts'] }
    ],
    [
      '選択肢の文言',
      {
        options: [
          { number: 1, text: 'Yes' },
          { number: 2, text: 'No, wait' }
        ]
      }
    ],
    [
      '選択肢の番号',
      {
        options: [
          { number: 1, text: 'Yes' },
          { number: 3, text: 'No' }
        ]
      }
    ],
    // 件数が同じで文言が入れ替わる(L-036)
    [
      '文言の入れ替わり',
      {
        options: [
          { number: 1, text: 'No' },
          { number: 2, text: 'Yes' }
        ]
      }
    ],
    ['選択肢の数', { options: [{ number: 1, text: 'Yes' }] }]
  ])('%s が違えば違う', (_name, change) => {
    expect(isSameAgentPermissionPrompt(BASE, { ...BASE, ...change })).toBe(false)
  })

  it('cursorNumber・numberKeysAccepted・bodyStartVisible だけが違えば同じ(押した時点の値で別に確かめる)', () => {
    expect(
      isSameAgentPermissionPrompt(BASE, {
        ...BASE,
        cursorNumber: 2,
        numberKeysAccepted: false,
        bodyStartVisible: false
      })
    ).toBe(true)
  })
})

describe('isWellFormedAgentPermissionOptions', () => {
  const options = (...numbers: number[]): { number: number; text: string }[] =>
    numbers.map((number) => ({ number, text: `o${number}` }))

  it('1 から欠けずに並び、9 以下で、カーソルが 1 つなら真', () => {
    expect(isWellFormedAgentPermissionOptions(options(1, 2, 3), [2])).toBe(true)
    expect(isWellFormedAgentPermissionOptions(options(1, 2, 3, 4, 5, 6, 7, 8, 9), [1])).toBe(true)
  })

  it.each<[string, number[], number[]]>([
    ['選択肢が無い', [], []],
    ['1 から始まらない', [2, 3], [2]],
    ['欠ける', [1, 3], [1]],
    ['10 以上', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1]],
    ['カーソルが無い', [1, 2], []],
    ['カーソルが 2 つ', [1, 2], [1, 2]]
  ])('%s → 偽', (_name, numbers, cursors) => {
    expect(isWellFormedAgentPermissionOptions(options(...numbers), cursors)).toBe(false)
  })
})

describe('isSameAgentPermissionPromptState', () => {
  it('どちらも null なら同じ、片方だけ null なら違う', () => {
    expect(isSameAgentPermissionPromptState(null, null)).toBe(true)
    expect(isSameAgentPermissionPromptState(BASE, null)).toBe(false)
    expect(isSameAgentPermissionPromptState(null, BASE)).toBe(false)
  })

  it('中身が同じなら別の物でも同じ', () => {
    expect(isSameAgentPermissionPromptState(BASE, { ...BASE, options: [...BASE.options] })).toBe(
      true
    )
  })

  it.each<[string, Partial<AgentPermissionPrompt>]>([
    ['カーソル', { cursorNumber: 2 }],
    ['番号キー', { numberKeysAccepted: false }],
    ['本文の上の端', { bodyStartVisible: false }],
    ['問い', { question: ['Do you want to make this edit?'] }]
  ])(
    '%s が違えば違う(isSameAgentPermissionPrompt と違い、カーソル・番号キー・本文の上の端も比べる)',
    (_, patch) => {
      expect(isSameAgentPermissionPromptState(BASE, { ...BASE, ...patch })).toBe(false)
    }
  )
})
