import { describe, it, expect } from 'vitest'
import {
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE,
  PROMPT_RUN_ARIA_LABEL_AGENT,
  PROMPT_RUN_ARIA_LABEL_LEGACY,
  RERUN_DISABLED_AGENT_MODE,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_LOADING_MODE,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING,
  getPromptRunAvailability,
  getRerunAvailability
} from '../agentSendMessages'

describe('getPromptRunAvailability', () => {
  const base = {
    isExecuting: false,
    isSessionRunning: false,
    isSessionClosing: false,
    isSending: false
  }
  it.each([
    ['読み込み中', { ...base, mode: null }, { disabled: true, reason: RUN_DISABLED_LOADING_MODE }],
    ['従来の方式・実行中でない', { ...base, mode: 'legacy' }, { disabled: false, reason: null }],
    [
      '従来の方式・実行中(理由は出さない)',
      { ...base, mode: 'legacy', isExecuting: true },
      { disabled: true, reason: null }
    ],
    [
      'エージェント・セッションなし',
      { ...base, mode: 'agent-cli' },
      { disabled: true, reason: RUN_DISABLED_NO_SESSION }
    ],
    [
      'エージェント・送信中',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isSending: true },
      { disabled: true, reason: RUN_DISABLED_SENDING }
    ],
    [
      'エージェント・送り先のタブが閉じる途中(running でも送らない)',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isSessionClosing: true },
      { disabled: true, reason: RUN_DISABLED_CLOSING }
    ],
    [
      '従来の方式は閉じる途中を見ない',
      { ...base, mode: 'legacy', isSessionClosing: true },
      { disabled: false, reason: null }
    ],
    [
      'エージェント・送れる',
      { ...base, mode: 'agent-cli', isSessionRunning: true },
      { disabled: false, reason: null }
    ],
    [
      'エージェント・従来の実行中フラグは見ない(C13)',
      { ...base, mode: 'agent-cli', isSessionRunning: true, isExecuting: true },
      { disabled: false, reason: null }
    ]
  ] as const)('%s', (_label, params, expected) => {
    expect(getPromptRunAvailability(params)).toEqual(expected)
  })
})

describe('getRerunAvailability', () => {
  it.each([
    [
      { mode: null, isExecuting: false },
      { disabled: true, reason: RUN_DISABLED_LOADING_MODE }
    ],
    [
      { mode: 'agent-cli', isExecuting: false },
      { disabled: true, reason: RERUN_DISABLED_AGENT_MODE }
    ],
    [
      { mode: 'legacy', isExecuting: true },
      { disabled: true, reason: null }
    ],
    [
      { mode: 'legacy', isExecuting: false },
      { disabled: false, reason: null }
    ]
  ] as const)('%o', (params, expected) => {
    expect(getRerunAvailability(params)).toEqual(expected)
  })
})

describe('送信の通知の文言', () => {
  // clearedDraft は「書きかけがあると判定できたか」で、偽陰性・偽陽性がある(設計書の既知の制約)。
  // そのため書きかけを消した旨は参考として添え、送信したことを先に伝える
  it('書きかけを消したときの通知は、送信したことを先に伝え、書きかけについては断定しない', () => {
    expect(AGENT_SENT_AFTER_CLEAR_NOTICE.startsWith(AGENT_SENT_NOTICE)).toBe(true)
    expect(AGENT_SENT_AFTER_CLEAR_NOTICE).toContain('書きかけがあったようなので')
  })
})

describe('実行ボタンの aria-label', () => {
  it('エージェント CLI 方式は可視の文言「実行」で始める', () => {
    expect(PROMPT_RUN_ARIA_LABEL_AGENT).toBe('実行（エージェントに送信）')
  })

  it('従来の方式は「プロンプトを実行」', () => {
    expect(PROMPT_RUN_ARIA_LABEL_LEGACY).toBe('プロンプトを実行')
  })
})
