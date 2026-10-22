import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import {
  AGENT_CLI_INTERRUPT_SPECS,
  judgeAgentCliInterruptFollowUpTiming
} from '../agentCliInterruptSpecs'

// 中断の送り方の表(設計書 2026-10-21「main の送り方の表」)。押すキーの回数の文言(renderer の agentInterruptMessages.ts)と回数を合わせる
describe('AGENT_CLI_INTERRUPT_SPECS', () => {
  it('種類の一覧のすべてに送り方がある', () => {
    expect(Object.keys(AGENT_CLI_INTERRUPT_SPECS).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('claude は作業中の Esc 1 回で中断する(2 回目なし)', () => {
    expect(AGENT_CLI_INTERRUPT_SPECS.claude).toEqual({ followUp: null })
  })

  it('copilot は renderer に 100ms 待たせ、1 回目から 50ms 以上・400ms 以内に頼まれたときだけ 2 回目を書く', () => {
    expect(AGENT_CLI_INTERRUPT_SPECS.copilot).toEqual({
      followUp: { afterMs: 100, minIntervalMs: 50, deadlineMs: 400 }
    })
  })

  it('copilot の 2 回目の待ちは 80ms 以上、期限は 500ms 未満(段階 0 の実測: 80〜150ms と 450ms で効き 600ms は効かない。copilot の 2 回の窓は 500ms)', () => {
    const { followUp } = AGENT_CLI_INTERRUPT_SPECS.copilot
    expect(followUp?.afterMs).toBeGreaterThanOrEqual(80)
    expect(followUp?.deadlineMs).toBeLessThan(500)
  })

  // 窓の実測の値は CLI ごとに違うので上の種類ごとのテストに置き、ここは種類に依らない値の並びだけを見る。2 回目の無い種類は
  // 確かめることが無いので、2 回目のある種類だけで回す(何も確かめずに通る行を作らない)
  it.each(AGENT_CLI_KINDS.filter((kind) => AGENT_CLI_INTERRUPT_SPECS[kind].followUp !== null))(
    '%s: 0 < 受け付けの下限 < 2 回目の待ち < 期限',
    (kind) => {
      const followUp = AGENT_CLI_INTERRUPT_SPECS[kind].followUp
      if (followUp === null) throw new Error('2 回目のある種類だけで回す')
      // 受け付けの下限は renderer の待ちより小さい(タイマーの早い発火を断らない余裕)が、0 より大きい(2 回を詰めない)
      expect(followUp.minIntervalMs).toBeGreaterThan(0)
      expect(followUp.minIntervalMs).toBeLessThan(followUp.afterMs)
      expect(followUp.deadlineMs).toBeGreaterThan(followUp.afterMs)
    }
  )
})

describe('judgeAgentCliInterruptFollowUpTiming', () => {
  const followUp = { afterMs: 100, minIntervalMs: 50, deadlineMs: 400 }

  it.each([
    [0, 'too-early'],
    [49.9, 'too-early'],
    [50, 'in-window'],
    [100, 'in-window'],
    [400, 'in-window'],
    [400.1, 'expired'],
    [10_000, 'expired']
  ] as const)('1 回目から %sms は %s(下限と期限のちょうどは受け付ける)', (elapsedMs, expected) => {
    expect(judgeAgentCliInterruptFollowUpTiming(followUp, elapsedMs)).toBe(expected)
  })

  it('負の経過(時計の戻り)は too-early で書かない', () => {
    expect(judgeAgentCliInterruptFollowUpTiming(followUp, -1)).toBe('too-early')
  })
})
