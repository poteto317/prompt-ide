import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AGENT_INTERRUPT_COOLDOWN_MS,
  checkAgentInterruptAtPress,
  checkAgentInterruptFollowUp,
  describeAgentInterruptBlockedByActivity,
  getAgentInterruptAvailability
} from '../agentInterrupt'
import type { AgentInterruptAvailabilityInput } from '../agentInterrupt'
import type { AgentActivity } from '../agentActivity'
import { isActiveAgentSessionStatus } from '../agentSessionTabState'
import type { AgentSessionStatus } from '../agentSessionTabState'
import type { ViewportLine } from '../agentViewport'
import { agentScreen, makeLine } from './fixtures/agentScreens'
import { copilotScreen } from './fixtures/copilotScreens'
import type { AgentScreenName } from './fixtures/agentScreens'
import {
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  agentInterruptBlockedByActivityReason,
  agentInterruptNotRunningReason,
  agentInterruptUnsupportedReason
} from '../agentInterruptMessages'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliCapabilityOverrides } from '../../__tests__/agentCliCapabilityOverrides'

// 中断の能力が無い種類の理由(段階 1 の agentInterruptUnsupportedReason)を確かめるため、能力の表を種類ごとに差し替える
const capabilityOverrides = vi.hoisted(
  (): AgentCliCapabilityOverrides => ({
    unsupportedKinds: new Set<AgentCliKind>(),
    promptSendUnsupportedKinds: new Set<AgentCliKind>(),
    sessionResumeUnsupportedKinds: new Set<AgentCliKind>(),
    changeAttributionUnsupportedKinds: new Set<AgentCliKind>()
  })
)
vi.mock('@shared/agentCliKinds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/agentCliKinds')>()
  const { overrideAgentCliCapabilities } =
    await import('../../__tests__/agentCliCapabilityOverrides')
  return {
    ...actual,
    agentCliCapabilities: overrideAgentCliCapabilities(
      actual.agentCliCapabilities,
      capabilityOverrides
    )
  }
})

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
  cliKind: 'claude',
  isClosing: false,
  activity: 'working',
  isSending: false,
  isSendConfirmOpen: false,
  isInterrupting: false
}

// 表の期待(状態 → 閉じる途中・送信中・確認の表示中・待ち → 活動の順で最初に当たった理由)
function expectedReason(input: AgentInterruptAvailabilityInput): string | null {
  if (input.status === 'none' || input.status === 'exited')
    return agentInterruptNotRunningReason('claude')
  if (input.status === 'starting') return AGENT_INTERRUPT_DISABLED_STARTING
  for (const flag of FLAGS) if (input[flag]) return FLAG_REASONS[flag]
  return input.activity === 'working'
    ? null
    : agentInterruptBlockedByActivityReason(input.activity, 'claude')
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
        reason: agentInterruptNotRunningReason('claude')
      })
    }
  )

  it('理由の順: 起動中は、閉じる途中・送信中・確認の表示中・待ち・活動より先', () => {
    expect(
      getAgentInterruptAvailability({
        status: 'starting',
        cliKind: 'claude',
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
        agentInterruptBlockedByActivityReason(activity, 'claude')
      )
    }
  )
})

describe('describeAgentInterruptBlockedByActivity', () => {
  it.each(['idle', 'permission', 'confirm', 'unknown'] as const)(
    '%s の理由は、タブの種類の文言の表から作る',
    (activity) => {
      for (const kind of ['claude', 'copilot'] as const) {
        expect(describeAgentInterruptBlockedByActivity(activity, kind)).toBe(
          agentInterruptBlockedByActivityReason(activity, kind)
        )
      }
    }
  )
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
    ['終了', { status: 'exited' }, agentInterruptNotRunningReason('claude')],
    ['起動中', { status: 'starting' }, AGENT_INTERRUPT_DISABLED_STARTING],
    ['待ち', { isInterrupting: true }, AGENT_INTERRUPT_DISABLED_COOLDOWN],
    ['入力待ち', { activity: 'idle' }, agentInterruptBlockedByActivityReason('idle', 'claude')]
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
    ['permission', agentInterruptBlockedByActivityReason('permission', 'claude')],
    ['tallTyped', agentInterruptBlockedByActivityReason('unknown', 'claude')]
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

describe('getAgentInterruptAvailability(中断の能力が無い種類。能力の表で copilot を差し替えて作る)', () => {
  const COPILOT = agentInterruptUnsupportedReason('copilot')
  const COPILOT_RUNNING: AgentInterruptAvailabilityInput = {
    ...RUNNING_WORKING,
    cliKind: 'copilot'
  }
  beforeEach(() => {
    capabilityOverrides.unsupportedKinds.add('copilot')
  })
  afterEach(() => {
    capabilityOverrides.unsupportedKinds.clear()
  })

  it('copilot の running は出すが押せず、閉じる途中・送信中・確認の表示中・待ち・活動より先にその理由', () => {
    for (const activity of ACTIVITIES) {
      for (const flag of FLAGS) {
        const input: AgentInterruptAvailabilityInput = { ...COPILOT_RUNNING, activity }
        input[flag] = true
        expect(getAgentInterruptAvailability(input)).toEqual({ visible: true, reason: COPILOT })
      }
      expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, activity })).toEqual({
        visible: true,
        reason: COPILOT
      })
    }
  })

  it('copilot でも starting は起動中の理由が先(判定の順は starting の直後)', () => {
    expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, status: 'starting' })).toEqual({
      visible: true,
      reason: AGENT_INTERRUPT_DISABLED_STARTING
    })
  })

  it.each(['none', 'exited'] as const)('copilot の %s は出さない', (status) => {
    expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, status })).toEqual({
      visible: false,
      reason: agentInterruptNotRunningReason('copilot')
    })
  })

  it('押した時点の判定も、copilot なら画面を読まずに止める(L-058)', () => {
    const readScreen = vi.fn((): readonly ViewportLine[] => agentScreen('working').lines)
    expect(checkAgentInterruptAtPress(COPILOT_RUNNING, readScreen)).toEqual({
      kind: 'blocked',
      reason: COPILOT
    })
    expect(readScreen).not.toHaveBeenCalled()
  })
})

describe('checkAgentInterruptAtPress(タブの種類の規則で読む)', () => {
  const COPILOT_RUNNING: AgentInterruptAvailabilityInput = {
    ...RUNNING_WORKING,
    cliKind: 'copilot'
  }

  it('copilot の作業中の台帳の画面は、copilot のタブとして渡すと send', () => {
    expect(
      checkAgentInterruptAtPress(COPILOT_RUNNING, () => copilotScreen('working3000').lines)
    ).toEqual({ kind: 'send' })
  })

  it('同じ画面を claude のタブとして渡すと blocked(claude の規則では入力待ち)', () => {
    expect(
      checkAgentInterruptAtPress(RUNNING_WORKING, () => copilotScreen('working3000').lines)
    ).toEqual({ kind: 'blocked', reason: agentInterruptBlockedByActivityReason('idle', 'claude') })
  })

  it('copilot の許可の確認の画面は、copilot の許可待ちの理由で blocked', () => {
    expect(
      checkAgentInterruptAtPress(COPILOT_RUNNING, () => copilotScreen('permission').lines)
    ).toEqual({
      kind: 'blocked',
      reason: agentInterruptBlockedByActivityReason('permission', 'copilot')
    })
  })

  it('copilot の動いていないタブの理由は copilot の名前', () => {
    expect(getAgentInterruptAvailability({ ...COPILOT_RUNNING, status: 'exited' })).toEqual({
      visible: false,
      reason: agentInterruptNotRunningReason('copilot')
    })
  })
})

describe('checkAgentInterruptFollowUp(2 回目の前の確かめ)', () => {
  it('画面が作業中なら send', () => {
    expect(
      checkAgentInterruptFollowUp('copilot', () => copilotScreen('working3000').lines)
    ).toEqual({
      kind: 'send'
    })
  })

  it.each<[string, () => readonly ViewportLine[], AgentActivity]>([
    ['入力待ち(台帳の done)', () => copilotScreen('done').lines, 'idle'],
    ['許可待ち(台帳の permission)', () => copilotScreen('permission').lines, 'permission'],
    [
      '判定できない(帯が空の手書きの画面)',
      () => ['─'.repeat(100), '❯', '─'.repeat(100)].map((text) => makeLine(text)),
      'unknown'
    ]
  ])('画面が %s なら skip と活動', (_name, readScreen, activity) => {
    expect(checkAgentInterruptFollowUp('copilot', readScreen)).toEqual({ kind: 'skip', activity })
  })

  it('タブの種類の規則で読む(copilot の作業中の画面も claude の規則では skip)', () => {
    expect(
      checkAgentInterruptFollowUp('claude', () => copilotScreen('working3000').lines).kind
    ).toBe('skip')
  })

  it('画面を読めなければ unreadable と例外を返す(投げない)', () => {
    const error = new Error('disposed')
    expect(
      checkAgentInterruptFollowUp('copilot', () => {
        throw error
      })
    ).toEqual({ kind: 'unreadable', error })
  })
})
