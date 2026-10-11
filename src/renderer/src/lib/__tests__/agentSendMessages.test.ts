import { describe, it, expect } from 'vitest'
import type { PromptExecutionMode } from '@shared/types'
import {
  AGENT_SENT_AFTER_CLEAR_NOTICE,
  AGENT_SENT_NOTICE,
  PROMPT_RUN_ARIA_LABEL_AGENT,
  PROMPT_RUN_ARIA_LABEL_LEGACY,
  RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE,
  RERUN_DISABLED_AGENT_MODE,
  RUN_DISABLED_CLOSING,
  RUN_DISABLED_LOADING_MODE,
  RUN_DISABLED_NO_SESSION,
  RUN_DISABLED_SENDING,
  getHistoryRerunAvailability,
  getPromptRunAvailability,
  getRerunAvailability,
  rerunDisabledAgentEntryFolderMismatch
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

describe('getHistoryRerunAvailability(履歴のエントリごとの 再実行)', () => {
  const base = {
    isExecuting: false,
    isSessionRunning: true,
    isSessionClosing: false,
    isSending: false,
    folderPath: '/repo'
  }

  it('従来のエントリは今のまま(エージェント CLI 方式では押せない)', () => {
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: null, mode: 'agent-cli' })
    ).toEqual({
      disabled: true,
      reason: RERUN_DISABLED_AGENT_MODE
    })
    expect(
      getHistoryRerunAvailability({
        ...base,
        recordedFolderPath: null,
        mode: 'legacy',
        isExecuting: true
      })
    ).toEqual({ disabled: true, reason: null })
  })

  it('エージェントのエントリは、従来の方式では押せず、読み込み中は読み込みの理由', () => {
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: '/repo', mode: 'legacy' })
    ).toEqual({
      disabled: true,
      reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE
    })
    expect(RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE).toBe(
      'エージェント CLI 方式で記録した履歴は、エージェント CLI 方式でだけ再実行できます'
    )
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: '/repo', mode: null })
    ).toEqual({
      disabled: true,
      reason: RUN_DISABLED_LOADING_MODE
    })
  })

  it('エージェントのエントリは、未知の方式(方式を足したとき)をエージェント CLI 方式として押せるようにしない', () => {
    // 型の外の値(方式の列挙を足したときに、この関数を直し忘れた場合)
    const unknownMode = 'remote' as unknown as PromptExecutionMode
    expect(
      getHistoryRerunAvailability({ ...base, recordedFolderPath: '/repo', mode: unknownMode })
    ).toEqual({ disabled: true, reason: RERUN_DISABLED_AGENT_ENTRY_LEGACY_MODE })
  })

  it('エージェントのエントリは、エージェント CLI 方式では一覧の 実行 と同じ条件(L-048)', () => {
    const agent = { ...base, recordedFolderPath: '/repo', mode: 'agent-cli' as const }
    expect(getHistoryRerunAvailability(agent)).toEqual({ disabled: false, reason: null })
    expect(getHistoryRerunAvailability({ ...agent, isSessionRunning: false })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_NO_SESSION
    })
    expect(getHistoryRerunAvailability({ ...agent, isSessionClosing: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_CLOSING
    })
    expect(getHistoryRerunAvailability({ ...agent, isSending: true })).toEqual({
      disabled: true,
      reason: RUN_DISABLED_SENDING
    })
  })

  it('エージェントのエントリは、記録したフォルダと違うフォルダ・フォルダを開いていないときは押せない(全文の @相対パス が別のファイルを指すため)', () => {
    const agent = { ...base, recordedFolderPath: '/repo', mode: 'agent-cli' as const }
    const mismatch = { disabled: true, reason: rerunDisabledAgentEntryFolderMismatch('/repo') }
    expect(getHistoryRerunAvailability({ ...agent, folderPath: '/other' })).toEqual(mismatch)
    expect(getHistoryRerunAvailability({ ...agent, folderPath: null })).toEqual(mismatch)
    // セッションが無いときもフォルダ違いを先に出す(フォルダを開き直さないと直らないため。このセッションで再開 と同じ順)
    expect(
      getHistoryRerunAvailability({ ...agent, folderPath: '/other', isSessionRunning: false })
    ).toEqual(mismatch)
    expect(rerunDisabledAgentEntryFolderMismatch('/repo')).toBe(
      '記録したフォルダ（/repo）を開いているときだけ再実行できます'
    )
  })

  it('従来のエントリはフォルダに関係なく今のまま', () => {
    expect(
      getHistoryRerunAvailability({
        ...base,
        recordedFolderPath: null,
        mode: 'legacy',
        folderPath: null
      })
    ).toEqual({ disabled: false, reason: null })
  })
})
