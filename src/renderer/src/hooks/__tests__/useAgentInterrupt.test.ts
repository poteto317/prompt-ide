import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { toAgentInterruptAvailabilityInput, useAgentInterrupt } from '../useAgentInterrupt'
import type {
  AgentInterruptPanelState,
  AgentInterruptTab,
  UseAgentInterruptOptions
} from '../useAgentInterrupt'
import type { AgentInterruptOutcome, AgentSessionTabView } from '../useAgentSessions'
import type { AgentActivity } from '../../lib/agentActivity'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'
import type { AgentScreenName } from '../../lib/__tests__/fixtures/agentScreens'
import { AGENT_INTERRUPT_COOLDOWN_MS } from '../../lib/agentInterrupt'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_NOT_RUNNING,
  agentInterruptSentNotice,
  agentInterruptUnsupportedReason
} from '../../lib/agentInterruptMessages'

type Props = Omit<UseAgentInterruptOptions, 'interrupt'>

let interrupt: ReturnType<typeof vi.fn<UseAgentInterruptOptions['interrupt']>>
let tab1: AgentSessionTabView
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

// 実行中のタブ。readScreen は記録した画面(既定は作業中の画面)を返す
function runningTab(
  slotId: string,
  number: number,
  screen: AgentScreenName = 'working'
): AgentSessionTabView {
  const controller = makeFakeController()
  controller.screen = agentScreen(screen).lines
  return makeAgentSessionTabView({
    slotId,
    number,
    label: `claude ${number}`,
    status: 'running',
    controller
  })
}

const workingOf = (...slotIds: string[]): ReadonlyMap<string, AgentActivity> =>
  new Map(slotIds.map((slotId): [string, AgentActivity] => [slotId, 'working']))

function render(props: Partial<Props> = {}): RenderHookResult<AgentInterruptPanelState, Props> {
  const initialProps: Props = {
    selected: tab1,
    activities: workingOf(tab1.slotId),
    isSending: false,
    isSendConfirmOpen: false,
    ...props
  }
  return renderHook((p: Props) => useAgentInterrupt({ ...p, interrupt }), { initialProps })
}

const press = async (
  result: RenderHookResult<AgentInterruptPanelState, Props>['result']
): Promise<void> => {
  await act(async () => {
    result.current.onInterrupt()
  })
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

// 結果を後から渡す interrupt の値
function deferredOutcome(): {
  promise: Promise<AgentInterruptOutcome>
  resolve: (value: AgentInterruptOutcome) => void
} {
  let resolve: (value: AgentInterruptOutcome) => void = () => undefined
  const promise = new Promise<AgentInterruptOutcome>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  interrupt = vi.fn<UseAgentInterruptOptions['interrupt']>(async () => ({ kind: 'sent' }))
  tab1 = runningTab('slot-1', 1)
  consoleErrorSpy = null
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  consoleErrorSpy?.mockRestore()
})

describe('useAgentInterrupt', () => {
  it('作業中なら押せ、押すと選択中のタブの slotId で interrupt を呼び、送れたら読み上げる', async () => {
    const { result } = render()
    expect(result.current.visible).toBe(true)
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('slot-1')
    expect(result.current.notice).toEqual({ text: agentInterruptSentNotice('claude 1'), id: 1 })
  })

  it('選択中のタブは AgentInterruptTab の値(slotId・label・status・cliKind・isClosing・controller の readScreen)だけで押せる', async () => {
    const selected: AgentInterruptTab = {
      slotId: 'slot-9',
      label: 'claude 9',
      status: 'running',
      cliKind: 'claude',
      isClosing: false,
      controller: { readScreen: () => agentScreen('working').lines }
    }
    const { result } = render({ selected, activities: workingOf('slot-9') })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('slot-9')
    expect(result.current.notice?.text).toBe(agentInterruptSentNotice('claude 9'))
  })

  // 待ちの長さの値(1,000ms)は agentInterrupt.test.ts で固定し、ここでは定数を基準に境界を確かめる
  it('押してから AGENT_INTERRUPT_COOLDOWN_MS の 1ms 前までは押せず(押すと理由を読み上げる)、ちょうどで押せる', async () => {
    const { result } = render()
    await press(result)
    advance(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    advance(1)
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(2)
  })

  it('送れたときの読み上げは、同じ文言でも id が進む(パターン 87)', async () => {
    const { result } = render()
    await press(result)
    advance(AGENT_INTERRUPT_COOLDOWN_MS)
    await press(result)
    expect(result.current.notice).toEqual({ text: agentInterruptSentNotice('claude 1'), id: 2 })
  })

  it('待ちはタブごと: タブ A の結果を待つ間もタブ B は押せ、A をもう一度押しても呼ばない', async () => {
    const tab2 = runningTab('slot-2', 2)
    const activities = workingOf('slot-1', 'slot-2')
    interrupt.mockImplementation((slotId) =>
      slotId === 'slot-1'
        ? new Promise<AgentInterruptOutcome>(() => undefined)
        : Promise.resolve({ kind: 'sent' })
    )
    const { result, rerender } = render({ activities })
    await press(result)
    rerender({ selected: tab2, activities, isSending: false, isSendConfirmOpen: false })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt.mock.calls).toEqual([['slot-1'], ['slot-2']])
    expect(result.current.notice?.text).toBe(agentInterruptSentNotice('claude 2'))
    rerender({ selected: tab1, activities, isSending: false, isSendConfirmOpen: false })
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(2)
  })

  it('結果を待つ間の同じタブの 2 回目は、IPC を呼ばず、読み上げもしない(同期の再入の防止)', async () => {
    interrupt.mockReturnValue(new Promise<AgentInterruptOutcome>(() => undefined))
    const { result } = render()
    act(() => {
      result.current.onInterrupt()
      result.current.onInterrupt()
    })
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBeNull()
  })

  it('結果が AGENT_INTERRUPT_COOLDOWN_MS より遅く届く間は押せず、届いた後に押せる', async () => {
    const pending = deferredOutcome()
    interrupt.mockReturnValueOnce(pending.promise)
    const { result } = render()
    await press(result)
    advance(AGENT_INTERRUPT_COOLDOWN_MS + 500)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.resolve({ kind: 'sent' })
    })
    expect(result.current.disabledReason).toBeNull()
  })

  it.each<[string, Partial<Props>, string]>([
    [
      '入力待ち',
      { activities: new Map<string, AgentActivity>([['slot-1', 'idle']]) },
      AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.idle
    ],
    ['送信中', { isSending: true }, AGENT_INTERRUPT_DISABLED_SENDING],
    ['送信前の確認の表示中', { isSendConfirmOpen: true }, AGENT_INTERRUPT_DISABLED_SEND_CONFIRM]
  ])(
    '押せない状態(%s。手順 2)で押すと、IPC を呼ばず理由を読み上げる(L-058・L-057)',
    async (_name, props, reason) => {
      const { result } = render(props)
      expect(result.current.disabledReason).toBe(reason)
      await press(result)
      expect(interrupt).not.toHaveBeenCalled()
      expect(result.current.notice?.text).toBe(reason)
    }
  )

  it.each<[string, Partial<AgentSessionTabView>, string]>([
    ['起動中', { status: 'starting' }, AGENT_INTERRUPT_DISABLED_STARTING],
    ['閉じている途中', { isClosing: true }, AGENT_INTERRUPT_DISABLED_CLOSING]
  ])(
    '選択中のタブが%s(手順 2)なら、描画の理由と同じ理由を読み上げ、押しても IPC を呼ばない',
    async (_name, patch, reason) => {
      const { result } = render({ selected: { ...tab1, ...patch } })
      expect(result.current.disabledReason).toBe(reason)
      await press(result)
      expect(interrupt).not.toHaveBeenCalled()
      expect(result.current.notice?.text).toBe(reason)
    }
  )

  it('終了したタブ(手順 2)では出さず、押しても IPC を呼ばず理由を読み上げる', async () => {
    const { result } = render({ selected: { ...tab1, status: 'exited' } })
    expect(result.current.visible).toBe(false)
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_NOT_RUNNING)
  })

  it('描画の活動は作業中でも、押した時点の画面が許可の確認(手順 3)なら IPC を呼ばず理由を読み上げる', async () => {
    const { result } = render({ selected: runningTab('slot-1', 1, 'permission') })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY.permission)
  })

  it('押した時点の画面を読めなければ、送らずに console に記録する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = tab1.controller as FakeController
    controller.readScreen = () => {
      throw new Error('disposed')
    }
    const { result } = render()
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
  })

  it.each<AgentInterruptOutcome>([
    { kind: 'stale' },
    { kind: 'skipped' },
    { kind: 'no-session' },
    { kind: 'write-failed' },
    { kind: 'error', message: 'x' }
  ])(
    '結果が %o なら読み上げない(失敗は useAgentSessions がタブの error に出す)',
    async (outcome) => {
      interrupt.mockResolvedValueOnce(outcome)
      const { result } = render()
      await press(result)
      expect(result.current.notice).toBeNull()
    }
  )

  it('interrupt が拒否しても、送っている途中を解く(L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    interrupt.mockRejectedValueOnce(new Error('unexpected'))
    const { result } = render()
    await press(result)
    advance(AGENT_INTERRUPT_COOLDOWN_MS)
    expect(result.current.disabledReason).toBeNull()
  })

  it('選択中のタブが copilot なら押せず理由を出し、押しても interrupt を呼ばずに理由を読み上げる', async () => {
    const { result } = render({ selected: { ...tab1, cliKind: 'copilot' } })
    const reason = agentInterruptUnsupportedReason('copilot')
    expect(result.current).toMatchObject({ visible: true, disabledReason: reason })
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(reason)
  })

  // タブごとの待ちのタイマーの後始末は useAgentInterruptCooldown のテストで確かめる。ここでは組み合わせた hook 全体で残らないことだけ
  it('アンマウントで、待ちのタイマーと読み上げのタイマーを残さない(L-052)', async () => {
    const { result, unmount } = render()
    await press(result)
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('toAgentInterruptAvailabilityInput', () => {
  it('選択中のタブの状態・活動と、送信中・確認の表示中・待ちの値をそのまま写す', () => {
    const tab = { ...runningTab('slot-1', 1), isClosing: true }
    expect(
      toAgentInterruptAvailabilityInput(
        {
          selected: tab,
          activities: new Map<string, AgentActivity>([['slot-1', 'permission']]),
          isSending: true,
          isSendConfirmOpen: true
        },
        true
      )
    ).toEqual({
      status: 'running',
      cliKind: 'claude',
      isClosing: true,
      activity: 'permission',
      isSending: true,
      isSendConfirmOpen: true,
      isInterrupting: true
    })
  })

  it('選択中のタブの種類を写す', () => {
    const input = toAgentInterruptAvailabilityInput(
      {
        selected: { ...runningTab('slot-1', 1), cliKind: 'copilot' },
        activities: workingOf('slot-1'),
        isSending: false,
        isSendConfirmOpen: false
      },
      false
    )
    expect(input.cliKind).toBe('copilot')
  })

  it('活動が未記録のタブは unknown として扱う(ほかのタブの活動は使わない)', () => {
    const input = toAgentInterruptAvailabilityInput(
      {
        selected: runningTab('slot-1', 1),
        activities: workingOf('slot-2'),
        isSending: false,
        isSendConfirmOpen: false
      },
      false
    )
    expect(input.activity).toBe('unknown')
    expect(input.isInterrupting).toBe(false)
  })
})
