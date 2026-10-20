import { describe, it, expect } from 'vitest'
import { AGENT_STOP_ERROR_PREFIX, formatAgentTabLabel } from '../agentSessionMessages'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_ERROR_NO_SESSION,
  AGENT_INTERRUPT_ERROR_PREFIX,
  AGENT_INTERRUPT_ERROR_WRITE_FAILED,
  AGENT_INTERRUPT_LABEL,
  AGENT_INTERRUPT_NOT_RUNNING,
  agentInterruptAriaLabel,
  agentInterruptError,
  agentInterruptSentNotice,
  agentInterruptUnsupportedReason
} from '../agentInterruptMessages'

describe('中断の文言(設計書 2026-10-19「画面」「エラー処理」)', () => {
  it('ボタンの見える文字と名前(見える文字で始める。パターン 76)', () => {
    expect(AGENT_INTERRUPT_LABEL).toBe('中断')
    expect(agentInterruptAriaLabel('claude')).toBe('中断（作業中の claude に Esc を送る）')
    expect(agentInterruptAriaLabel('copilot')).toBe('中断（作業中の copilot に Esc を送る）')
    expect(agentInterruptAriaLabel('copilot').startsWith(AGENT_INTERRUPT_LABEL)).toBe(true)
  })

  it('押せない理由', () => {
    expect(AGENT_INTERRUPT_NOT_RUNNING).toBe('claude が動いていないため中断できません')
    expect(AGENT_INTERRUPT_DISABLED_STARTING).toBe('起動中は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_CLOSING).toBe('閉じる途中のタブは中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SENDING).toBe('プロンプトを送信している間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SEND_CONFIRM).toBe('送信前の確認を開いている間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_COOLDOWN).toBe(
      '中断を送りました。まだ作業中なら、少し待つと押せます'
    )
    expect(AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY).toEqual({
      permission:
        '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）',
      confirm: '確認待ちのため中断できません（ターミナルで選んでください）',
      idle: '入力待ちのため、中断する作業がありません',
      unknown: '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）'
    })
  })

  it('送れたときの読み上げは、押した時点のタブのラベルで始める', () => {
    expect(agentInterruptSentNotice('claude 1')).toBe('claude 1 に中断（Esc）を送りました')
    expect(agentInterruptSentNotice(formatAgentTabLabel(3, 'claude'))).toBe(
      'claude 3 に中断（Esc）を送りました'
    )
  })

  it('失敗の文言は接頭辞で始める(成功のときに中断の失敗だけを消すため)', () => {
    expect(AGENT_INTERRUPT_ERROR_PREFIX).toBe('中断を送れませんでした: ')
    expect(AGENT_INTERRUPT_ERROR_NO_SESSION).toBe(
      '中断を送れませんでした: claude が終了したか、起動し直しました'
    )
    expect(AGENT_INTERRUPT_ERROR_WRITE_FAILED).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(agentInterruptError('ipc down')).toBe('中断を送れませんでした: ipc down')
    // 終了の失敗の接頭辞とは別(中断が成功しても、終了の失敗の文言は消さない)
    expect(AGENT_STOP_ERROR_PREFIX.startsWith(AGENT_INTERRUPT_ERROR_PREFIX)).toBe(false)
  })
})

describe('中断に対応しない CLI の理由(agentInterruptUnsupportedReason)', () => {
  it('選択中のタブの CLI の名前で作る', () => {
    expect(agentInterruptUnsupportedReason('copilot')).toBe(
      'copilot では中断のボタンを使えません（ターミナルで操作してください）'
    )
  })
})
