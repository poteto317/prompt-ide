import { describe, it, expect, vi } from 'vitest'
import {
  AGENT_INTERRUPT_COOLDOWN_MS,
  checkAgentInterruptAtPress,
  describeAgentInterruptBlockedByActivity,
  getAgentInterruptAvailability
} from '../agentInterrupt'
import type { AgentInterruptAvailabilityInput } from '../agentInterrupt'
import type { AgentActivity } from '../agentActivity'
import { isActiveAgentSessionStatus } from '../agentSessionTabState'
import type { AgentSessionStatus } from '../agentSessionTabState'
import type { ViewportLine } from '../agentViewport'
import { agentScreen } from './fixtures/agentScreens'
import type { AgentScreenName } from './fixtures/agentScreens'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_NOT_RUNNING
} from '../agentInterruptMessages'

const STATUSES: readonly AgentSessionStatus[] = ['none', 'starting', 'running', 'exited']
const ACTIVITIES: readonly AgentActivity[] = ['working', 'idle', 'permission', 'confirm', 'unknown']
// 設計書「押せない理由の文言」の表の順(閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内)
const FLAGS = ['isClosing', 'isSending', 'isSendConfirmOpen', 'isInterrupting'] as const
type Flag = (typeof FLAGS)[number]
const FLAG_REASONS: Record<Flag, string> = {
  isClosing: AGENT_INTERRUPT_DISABLED_CLOSING,
  isSending: AGENT_INTERRUPT_DISABLED_SENDING,
  isSendConfirmOpen: AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  isInterrupting: AGENT_INTERRUPT_DISABLED_COOLDOWN
}

const RUNNING_WORKING: AgentInterruptAvailabilityInput = {
  status: 'running',
  isClosing: false,
  activity: 'working',
  isSending: false,
  isSendConfirmOpen: false,
  isInterrupting: false
}

// 表の期待(状態 → 閉じる途中・送信中・確認の表示中・待ち → 活動の順で最初に当たった理由)
function expectedReason(input: AgentInterruptAvailabilityInput): string | null {
  if (input.status === 'none' || input.status === 'exited') return AGENT_INTERRUPT_NOT_RUNNING
  if (input.status === 'starting') return AGENT_INTERRUPT_DISABLED_STARTING
  for (const flag of FLAGS) if (input[flag]) return FLAG_REASONS[flag]
  return input.activity === 'working' ? null : AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[input.activity]
}

// 状態(4)× 活動(5)× 閉じる途中・送信中・確認の表示中・待ち(16)の組
const COMBINATIONS: [string, AgentInterruptAvailabilityInput][] = STATUSES.flatMap((status) =>
  ACTIVITIES.flatMap((activity) =>
    Array.from(
      { length: 2 ** FLAGS.length },
      (_, bits): [string, AgentInterruptAvailabilityInput] => {
        const input: AgentInterruptAvailabilityInput = { ...RUNNING_WORKING, status, activity }
        FLAGS.forEach((flag, index) => {
          input[flag] = (bits & (1 << index)) !== 0
        })
        const on = FLAGS.filter((flag) => input[flag]).join('+') || 'なし'
        return [`${status}・${activity}・${on}`, input]
      }
    )
  )
)

describe('getAgentInterruptAvailability', () => {
  it('作業中で、どの理由にも当たらなければ押せる(reason が null)', () => {
    expect(getAgentInterruptAvailability(RUNNING_WORKING)).toEqual({ visible: true, reason: null })
  })

  it.each(STATUSES)(
    '%s: 出すかは、帯が 終了 を出すかと同じ判定(isActiveAgentSessionStatus)に従う',
    (status) => {
      expect(getAgentInterruptAvailability({ ...RUNNING_WORKING, status }).visible).toBe(
        isActiveAgentSessionStatus(status)
      )
    }
  )

  it.each(COMBINATIONS)('%s', (_name, input) => {
    expect(getAgentInterruptAvailability(input)).toEqual({
      visible: input.status === 'starting' || input.status === 'running',
      reason: expectedReason(input)
    })
  })

  it.each(['none', 'exited'] as const)(
    '%s は出さず、押した処理の判定のために理由(動いていない)を持つ',
    (status) => {
      expect(getAgentInterruptAvailability({ ...RUNNING_WORKING, status })).toEqual({
        visible: false,
        reason: AGENT_INTERRUPT_NOT_RUNNING
      })
    }
  )

  it('理由の順: 起動中は、閉じる途中・送信中・確認の表示中・待ち・活動より先', () => {
    expect(
      getAgentInterruptAvailability({
        status: 'starting',
        isClosing: true,
        activity: 'permission',
        isSending: true,
        isSendConfirmOpen: true,
        isInterrupting: true
      }).reason
    ).toBe(AGENT_INTERRUPT_DISABLED_STARTING)
  })

  it.each<[string, Partial<AgentInterruptAvailabilityInput>, string]>([
    [
      '閉じる途中は送信中より先',
      { isClosing: true, isSending: true, isSendConfirmOpen: true, isInterrupting: true },
      AGENT_INTERRUPT_DISABLED_CLOSING
    ],
    [
      '送信中は確認の表示中より先',
      { isSending: true, isSendConfirmOpen: true, isInterrupting: true },
      AGENT_INTERRUPT_DISABLED_SENDING
    ],
    [
      '確認の表示中は待ちより先',
      { isSendConfirmOpen: true, isInterrupting: true },
      AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
    ],
    [
      '待ちは活動より先',
      { isInterrupting: true, activity: 'idle' },
      AGENT_INTERRUPT_DISABLED_COOLDOWN
    ]
  ])('理由の順: %s', (_name, overrides, reason) => {
    expect(
      getAgentInterruptAvailability({ ...RUNNING_WORKING, activity: 'permission', ...overrides })
        .reason
    ).toBe(reason)
  })

  it.each(['idle', 'permission', 'confirm', 'unknown'] as const)(
    '活動が %s なら押せない(L-041。許可待ちの Esc は許可の拒否、入力待ちの 2 回目の Esc は書きかけの消去)',
    (activity) => {
      expect(getAgentInterruptAvailability({ ...RUNNING_WORKING, activity }).reason).toBe(
        AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[activity]
      )
    }
  )
})

describe('describeAgentInterruptBlockedByActivity', () => {
  it.each(['idle', 'permission', 'confirm', 'unknown'] as const)('%s の理由', (activity) => {
    expect(describeAgentInterruptBlockedByActivity(activity)).toBe(
      AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[activity]
    )
  })
})

describe('AGENT_INTERRUPT_COOLDOWN_MS', () => {
  it('1,000ms(入力待ちで 2 回目の Esc が書きかけを消さない 0.9 秒より長い。MVP の確認の結果 17)', () => {
    expect(AGENT_INTERRUPT_COOLDOWN_MS).toBe(1_000)
  })
})

describe('checkAgentInterruptAtPress', () => {
  const screenOf =
    (name: AgentScreenName): (() => readonly ViewportLine[]) =>
    () =>
      agentScreen(name).lines

  it('押せる状態で、押した時点の画面が作業中なら send', () => {
    expect(checkAgentInterruptAtPress(RUNNING_WORKING, screenOf('working'))).toEqual({
      kind: 'send'
    })
  })

  it.each<[string, Partial<AgentInterruptAvailabilityInput>, string]>([
    ['終了', { status: 'exited' }, AGENT_INTERRUPT_NOT_RUNNING],
    ['起動中', { status: 'starting' }, AGENT_INTERRUPT_DISABLED_STARTING],
    ['待ち', { isInterrupting: true }, AGENT_INTERRUPT_DISABLED_COOLDOWN],
    ['入力待ち', { activity: 'idle' }, AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.idle]
  ])(
    '押せない状態(%s。手順 2)なら、画面を読まずに blocked と理由を返す',
    (_name, overrides, reason) => {
      const readScreen = vi.fn(screenOf('working'))
      expect(checkAgentInterruptAtPress({ ...RUNNING_WORKING, ...overrides }, readScreen)).toEqual({
        kind: 'blocked',
        reason
      })
      expect(readScreen).not.toHaveBeenCalled()
    }
  )

  it.each<[AgentScreenName, string]>([
    ['permission', AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.permission],
    ['tallTyped', AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.unknown]
  ])(
    '描画の活動は作業中でも、押した時点の画面が %s(手順 3)なら blocked と理由を返す',
    (name, reason) => {
      expect(checkAgentInterruptAtPress(RUNNING_WORKING, screenOf(name))).toEqual({
        kind: 'blocked',
        reason
      })
    }
  )

  it('画面を読めなければ unreadable と例外を返す(投げない)', () => {
    const error = new Error('disposed')
    expect(
      checkAgentInterruptAtPress(RUNNING_WORKING, () => {
        throw error
      })
    ).toEqual({ kind: 'unreadable', error })
  })
})
