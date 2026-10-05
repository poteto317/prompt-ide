import { describe, it, expect } from 'vitest'
import { buildPromptRunPanelState } from '../promptRunState'
import type { PromptRunStateInput } from '../promptRunState'

const base: PromptRunStateInput = {
  mode: 'legacy',
  isExecuting: false,
  sessionStatus: 'none',
  isSending: false,
  sendError: null,
  sendNotice: null
}

const LOADING = '設定を読み込んでいます'
const NO_SESSION = 'エージェントが起動していません（ターミナルの「起動」を押してください）'
const SENDING = 'エージェントへ送信しています'
const RERUN_AGENT =
  'エージェント CLI 方式では再実行できません（設定で従来の方式に切り替えると使えます）'

describe('buildPromptRunPanelState', () => {
  it('従来の方式で実行していなければ押せ、ツールの選択を出し、送信の結果は null', () => {
    expect(buildPromptRunPanelState(base)).toEqual({
      isRunDisabled: false,
      runDisabledReason: null,
      agentSend: null,
      showToolSelector: true,
      runAriaLabel: 'プロンプトを実行',
      isRerunDisabled: false,
      rerunDisabledReason: null
    })
  })

  it('従来の方式の実行中は、実行も再実行も押せない(理由は出さない)', () => {
    const state = buildPromptRunPanelState({ ...base, isExecuting: true })
    expect(state).toMatchObject({
      isRunDisabled: true,
      runDisabledReason: null,
      isRerunDisabled: true,
      rerunDisabledReason: null
    })
  })

  it('従来の方式では、送信の失敗・通知があっても agentSend は null', () => {
    const state = buildPromptRunPanelState({
      ...base,
      sendError: 'err',
      sendNotice: { id: 1, text: 'n' }
    })
    expect(state.agentSend).toBeNull()
  })

  it('実行方式の読み込み中は、実行も再実行も押せず理由を出す', () => {
    const state = buildPromptRunPanelState({ ...base, mode: null })
    expect(state).toMatchObject({
      isRunDisabled: true,
      runDisabledReason: LOADING,
      isRerunDisabled: true,
      rerunDisabledReason: LOADING,
      showToolSelector: true,
      runAriaLabel: 'プロンプトを実行',
      agentSend: null
    })
  })

  it.each(['none', 'starting', 'exited'] as const)(
    'エージェント CLI 方式でセッションが running でなければ(%s)押せず理由を出す',
    (sessionStatus) => {
      const state = buildPromptRunPanelState({ ...base, mode: 'agent-cli', sessionStatus })
      expect(state.isRunDisabled).toBe(true)
      expect(state.runDisabledReason).toBe(NO_SESSION)
    }
  )

  it('エージェント CLI 方式でセッションが running なら押せ、ツールの選択を隠し、送信の aria-label にする', () => {
    const notice = { id: 2, text: 'エージェントに送信しました' }
    const state = buildPromptRunPanelState({
      ...base,
      mode: 'agent-cli',
      sessionStatus: 'running',
      sendError: 'err',
      sendNotice: notice
    })
    expect(state).toEqual({
      isRunDisabled: false,
      runDisabledReason: null,
      agentSend: { error: 'err', notice },
      showToolSelector: false,
      runAriaLabel: '実行（エージェントに送信）',
      isRerunDisabled: true,
      rerunDisabledReason: RERUN_AGENT
    })
  })

  it('エージェント CLI 方式で送信中は押せず理由を出す', () => {
    const state = buildPromptRunPanelState({
      ...base,
      mode: 'agent-cli',
      sessionStatus: 'running',
      isSending: true
    })
    expect(state.isRunDisabled).toBe(true)
    expect(state.runDisabledReason).toBe(SENDING)
  })

  // 理由があれば必ず無効。従来の方式以外では、無効なら必ず理由がある(パターン 126)
  describe('無効と理由の不変条件', () => {
    const modes = [null, 'legacy', 'agent-cli'] as const
    const statuses = ['none', 'starting', 'running', 'exited'] as const
    const cases = modes.flatMap((mode) =>
      statuses.flatMap((sessionStatus) =>
        [false, true].flatMap((isExecuting) =>
          [false, true].map((isSending) => ({ mode, sessionStatus, isExecuting, isSending }))
        )
      )
    )
    it.each(cases)(
      'mode=$mode status=$sessionStatus isExecuting=$isExecuting isSending=$isSending',
      (input) => {
        const state = buildPromptRunPanelState({ ...base, ...input })
        const pairs: Array<[boolean, string | null]> = [
          [state.isRunDisabled, state.runDisabledReason],
          [state.isRerunDisabled, state.rerunDisabledReason]
        ]
        for (const [disabled, reason] of pairs) {
          if (reason !== null) expect(disabled).toBe(true)
          if (input.mode !== 'legacy') expect(disabled).toBe(reason !== null)
        }
        expect(state.showToolSelector).toBe(input.mode !== 'agent-cli')
      }
    )
  })
})
