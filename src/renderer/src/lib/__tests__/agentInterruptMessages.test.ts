import { describe, it, expect, expectTypeOf } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import type { AgentInterruptFollowUpResult, AgentInterruptResult } from '@shared/types'
import { AGENT_STOP_ERROR_PREFIX, formatAgentTabLabel } from '../agentSessionMessages'
import {
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED,
  AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING,
  AGENT_INTERRUPT_ERROR_PREFIX,
  AGENT_INTERRUPT_ERROR_WRITE_FAILED,
  AGENT_INTERRUPT_KEY_TEXTS,
  AGENT_INTERRUPT_LABEL,
  agentInterruptAriaLabel,
  agentInterruptBlockedByActivityReason,
  agentInterruptError,
  agentInterruptFailureError,
  agentInterruptFollowUpSkippedNotice,
  agentInterruptNoSessionError,
  agentInterruptNotRunningReason,
  agentInterruptSentNotice,
  agentInterruptUnsupportedReason
} from '../agentInterruptMessages'
import type { AgentInterruptFailureKind } from '../agentInterruptMessages'

describe('中断の文言(設計書 2026-10-19「画面」「エラー処理」・2026-10-21「文言」)', () => {
  it('種類の一覧のすべてに押すキーの文言がある', () => {
    expect(Object.keys(AGENT_INTERRUPT_KEY_TEXTS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('ボタンの名前は見える文字「中断」で始め、押すキーは種類で変わる(パターン 76。copilot の回数は main の agentCliInterruptSpecs.ts と合わせる)', () => {
    expect(AGENT_INTERRUPT_LABEL).toBe('中断')
    expect(agentInterruptAriaLabel('claude')).toBe('中断（作業中の claude に Esc を送る）')
    expect(agentInterruptAriaLabel('copilot')).toBe('中断（作業中の copilot に Esc を 2 回送る）')
    for (const kind of AGENT_CLI_KINDS) {
      expect(agentInterruptAriaLabel(kind).startsWith(AGENT_INTERRUPT_LABEL)).toBe(true)
    }
  })

  it('CLI に依らない押せない理由(今のまま)', () => {
    expect(AGENT_INTERRUPT_DISABLED_STARTING).toBe('起動中は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_CLOSING).toBe('閉じる途中のタブは中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SENDING).toBe('プロンプトを送信している間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_SEND_CONFIRM).toBe('送信前の確認を開いている間は中断できません')
    expect(AGENT_INTERRUPT_DISABLED_COOLDOWN).toBe(
      '中断を送りました。まだ作業中なら、少し待つと押せます'
    )
  })

  it('動いていない理由は CLI の名前で作る', () => {
    expect(agentInterruptNotRunningReason('claude')).toBe('claude が動いていないため中断できません')
    expect(agentInterruptNotRunningReason('copilot')).toBe(
      'copilot が動いていないため中断できません'
    )
  })

  it('活動の理由: claude は今と同じ', () => {
    expect(agentInterruptBlockedByActivityReason('permission', 'claude')).toBe(
      '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）'
    )
    expect(agentInterruptBlockedByActivityReason('confirm', 'claude')).toBe(
      '確認待ちのため中断できません（ターミナルで選んでください）'
    )
    expect(agentInterruptBlockedByActivityReason('idle', 'claude')).toBe(
      '入力待ちのため、中断する作業がありません'
    )
    expect(agentInterruptBlockedByActivityReason('unknown', 'claude')).toBe(
      '作業中か判定できないため押せません（ターミナルで Esc を押すと中断できます）'
    )
  })

  it('活動の理由: copilot は許可待ち・判定できないの文言だけが違い、確認待ち・入力待ちは同じ', () => {
    expect(agentInterruptBlockedByActivityReason('permission', 'copilot')).toBe(
      '許可待ちのため中断できません（Esc は操作の取り消しになります。ターミナルで答えてください）'
    )
    expect(agentInterruptBlockedByActivityReason('unknown', 'copilot')).toBe(
      '作業中か判定できないため押せません（ターミナルで Esc を続けて 2 回押すと中断できます）'
    )
    expect(agentInterruptBlockedByActivityReason('confirm', 'copilot')).toBe(
      agentInterruptBlockedByActivityReason('confirm', 'claude')
    )
    expect(agentInterruptBlockedByActivityReason('idle', 'copilot')).toBe(
      agentInterruptBlockedByActivityReason('idle', 'claude')
    )
  })

  it('送れたときの読み上げは、押した時点のタブのラベルと種類の押すキーで作る', () => {
    expect(agentInterruptSentNotice('claude 1', 'claude')).toBe(
      'claude 1 に中断（Esc）を送りました'
    )
    expect(agentInterruptSentNotice(formatAgentTabLabel(3, 'claude'), 'claude')).toBe(
      'claude 3 に中断（Esc）を送りました'
    )
    expect(agentInterruptSentNotice('copilot 1', 'copilot')).toBe(
      'copilot 1 に中断（Esc を 2 回）を送りました'
    )
  })

  it.each(['idle', 'permission', 'confirm'] as const)(
    '2 回目を頼まなかった読み上げ(%s): 作業中でなくなった旨',
    (activity) => {
      expect(agentInterruptFollowUpSkippedNotice('copilot 1', activity)).toBe(
        'copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした'
      )
    }
  )

  it('2 回目を頼まなかった読み上げ(unknown): 判定できなかった旨と、待ってから押し直す案内', () => {
    expect(agentInterruptFollowUpSkippedNotice('copilot 1', 'unknown')).toBe(
      'copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）'
    )
  })

  it('失敗の文言は接頭辞で始める(成功のときに中断の失敗だけを消すため)', () => {
    expect(AGENT_INTERRUPT_ERROR_PREFIX).toBe('中断を送れませんでした: ')
    expect(agentInterruptNoSessionError('claude')).toBe(
      '中断を送れませんでした: claude が終了したか、起動し直しました'
    )
    expect(agentInterruptNoSessionError('copilot')).toBe(
      '中断を送れませんでした: copilot が終了したか、起動し直しました'
    )
    expect(AGENT_INTERRUPT_ERROR_WRITE_FAILED).toBe(
      '中断を送れませんでした: ターミナルへの書き込みに失敗しました'
    )
    expect(AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED).toBe(
      '中断を送れませんでした: 2 回目の Esc が間に合いませんでした（まだ作業中なら、もう一度押してください）'
    )
    expect(AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING).toBe(
      '中断を送れませんでした: 2 回目の Esc を送れる状態ではありませんでした（まだ作業中なら、もう一度押してください）'
    )
    expect(agentInterruptError('ipc down')).toBe('中断を送れませんでした: ipc down')
    // 終了の失敗の接頭辞とは別(中断が成功しても、終了の失敗の文言は消さない)
    expect(AGENT_STOP_ERROR_PREFIX.startsWith(AGENT_INTERRUPT_ERROR_PREFIX)).toBe(false)
  })
})

describe('中断に対応しない CLI の理由(agentInterruptUnsupportedReason)', () => {
  it('選択中のタブの CLI の名前で作る(能力の表で中断が無い種類に使う)', () => {
    expect(agentInterruptUnsupportedReason('copilot')).toBe(
      'copilot では中断のボタンを使えません（ターミナルで操作してください）'
    )
  })
})

describe('main が返した中断の失敗の文言(agentInterruptFailureError)', () => {
  it.each([
    ['write-failed', AGENT_INTERRUPT_ERROR_WRITE_FAILED],
    ['not-pending', AGENT_INTERRUPT_ERROR_FOLLOW_UP_NOT_PENDING],
    ['expired', AGENT_INTERRUPT_ERROR_FOLLOW_UP_EXPIRED]
  ] as const)('%s は CLI に依らない固定の文言', (kind, expected) => {
    expect(agentInterruptFailureError(kind, 'claude')).toBe(expected)
    expect(agentInterruptFailureError(kind, 'copilot')).toBe(expected)
  })

  it('no-session はタブの種類のコマンド名で作る', () => {
    expect(agentInterruptFailureError('no-session', 'copilot')).toBe(
      agentInterruptNoSessionError('copilot')
    )
    expect(agentInterruptFailureError('no-session', 'claude')).toBe(
      agentInterruptNoSessionError('claude')
    )
  })

  it('失敗の種類は IPC の結果(1 回目・2 回目)の sent 以外のすべてと一致する(写し直さない)', () => {
    expectTypeOf<AgentInterruptFailureKind>().toEqualTypeOf<
      'no-session' | 'write-failed' | 'not-pending' | 'expired'
    >()
    expectTypeOf<
      Exclude<AgentInterruptResult['kind'], 'sent'>
    >().toExtend<AgentInterruptFailureKind>()
    expectTypeOf<
      Exclude<AgentInterruptFollowUpResult['kind'], 'sent'>
    >().toExtend<AgentInterruptFailureKind>()
  })

  it('どの失敗も中断の失敗の接頭辞で始まる(送れたときに消す対象になる)', () => {
    for (const kind of ['no-session', 'write-failed', 'not-pending', 'expired'] as const) {
      expect(
        agentInterruptFailureError(kind, 'copilot').startsWith(AGENT_INTERRUPT_ERROR_PREFIX)
      ).toBe(true)
    }
  })
})
