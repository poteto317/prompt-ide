import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { toAgentInterruptAvailabilityInput, useAgentInterrupt } from '../useAgentInterrupt'
import type {
  AgentInterruptState,
  AgentInterruptTab,
  UseAgentInterruptOptions
} from '../useAgentInterrupt'
import type {
  AgentInterruptFollowUpOutcome,
  AgentInterruptOutcome,
  AgentSessionTabView
} from '../useAgentSessions'
import type { AgentActivity } from '../../lib/agentActivity'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen, makeLine } from '../../lib/__tests__/fixtures/agentScreens'
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'
import type { CopilotScreenName } from '../../lib/__tests__/fixtures/copilotScreens'
import type { AgentScreenName } from '../../lib/__tests__/fixtures/agentScreens'
import { AGENT_INTERRUPT_COOLDOWN_MS } from '../../lib/agentInterrupt'
import {
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  agentInterruptBlockedByActivityReason,
  agentInterruptNotRunningReason,
  agentInterruptSentNotice
} from '../../lib/agentInterruptMessages'

type Props = Omit<UseAgentInterruptOptions, 'interrupt' | 'interruptFollowUp' | 'isTabOpen'>

let interrupt: ReturnType<typeof vi.fn<UseAgentInterruptOptions['interrupt']>>
let interruptFollowUp: ReturnType<typeof vi.fn<UseAgentInterruptOptions['interruptFollowUp']>>
let isTabOpen: ReturnType<typeof vi.fn<UseAgentInterruptOptions['isTabOpen']>>
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

function render(props: Partial<Props> = {}): RenderHookResult<AgentInterruptState, Props> {
  const initialProps: Props = {
    selected: tab1,
    activities: workingOf(tab1.slotId),
    isSending: false,
    isSendConfirmOpen: false,
    ...props
  }
  return renderHook(
    (p: Props) => useAgentInterrupt({ ...p, interrupt, interruptFollowUp, isTabOpen }),
    {
      initialProps
    }
  )
}

const press = async (
  result: RenderHookResult<AgentInterruptState, Props>['result']
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
  interrupt = vi.fn<UseAgentInterruptOptions['interrupt']>(async () => ({
    kind: 'sent',
    followUp: null
  }))
  interruptFollowUp = vi.fn<UseAgentInterruptOptions['interruptFollowUp']>(async () => ({
    kind: 'sent'
  }))
  isTabOpen = vi.fn<UseAgentInterruptOptions['isTabOpen']>(() => true)
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
    expect(result.current.notice).toEqual({
      text: agentInterruptSentNotice('claude 1', 'claude'),
      id: 1
    })
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
    expect(result.current.notice?.text).toBe(agentInterruptSentNotice('claude 9', 'claude'))
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
    expect(result.current.notice).toEqual({
      text: agentInterruptSentNotice('claude 1', 'claude'),
      id: 2
    })
  })

  it('待ちはタブごと: タブ A の結果を待つ間もタブ B は押せ、A をもう一度押しても呼ばない', async () => {
    const tab2 = runningTab('slot-2', 2)
    const activities = workingOf('slot-1', 'slot-2')
    interrupt.mockImplementation((slotId) =>
      slotId === 'slot-1'
        ? new Promise<AgentInterruptOutcome>(() => undefined)
        : Promise.resolve({ kind: 'sent', followUp: null })
    )
    const { result, rerender } = render({ activities })
    await press(result)
    rerender({ selected: tab2, activities, isSending: false, isSendConfirmOpen: false })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt.mock.calls).toEqual([['slot-1'], ['slot-2']])
    expect(result.current.notice?.text).toBe(agentInterruptSentNotice('claude 2', 'claude'))
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
      pending.resolve({ kind: 'sent', followUp: null })
    })
    expect(result.current.disabledReason).toBeNull()
  })

  it.each<[string, Partial<Props>, string]>([
    [
      '入力待ち',
      { activities: new Map<string, AgentActivity>([['slot-1', 'idle']]) },
      agentInterruptBlockedByActivityReason('idle', 'claude')
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
    expect(result.current.notice?.text).toBe(agentInterruptNotRunningReason('claude'))
  })

  it('描画の活動は作業中でも、押した時点の画面が許可の確認(手順 3)なら IPC を呼ばず理由を読み上げる', async () => {
    const { result } = render({ selected: runningTab('slot-1', 1, 'permission') })
    expect(result.current.disabledReason).toBeNull()
    await press(result)
    expect(interrupt).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      agentInterruptBlockedByActivityReason('permission', 'claude')
    )
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

// copilot の実行中のタブ。readScreen は copilot の台帳の画面(既定は作業中)を返す
function copilotTab(
  slotId: string,
  number: number,
  screen: CopilotScreenName = 'working3000'
): AgentSessionTabView {
  const controller = makeFakeController()
  controller.screen = copilotScreen(screen).lines
  return makeAgentSessionTabView({
    slotId,
    number,
    status: 'running',
    cliKind: 'copilot',
    controller
  })
}

const FOLLOW_UP = { afterMs: 100, sessionId: 'sid-1' }

// 偽のタイマーを進め、その間に解決した Promise の続きも流す
const advanceAsync = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useAgentInterrupt(2 回目の要る種類: copilot)', () => {
  let copilot1: AgentSessionTabView

  beforeEach(() => {
    copilot1 = copilotTab('slot-1', 1)
    interrupt.mockResolvedValue({ kind: 'sent', followUp: FOLLOW_UP })
  })

  const renderCopilot = (
    props: Partial<Props> = {}
  ): RenderHookResult<AgentInterruptState, Props> =>
    render({ selected: copilot1, activities: workingOf('slot-1'), ...props })

  it('押すと 1 回目を送り、afterMs の後に画面が作業中なら同じ sessionId で 2 回目を頼み、2 回送ったと読み上げる', async () => {
    const { result } = renderCopilot()
    await press(result)
    expect(interrupt).toHaveBeenCalledExactlyOnceWith('slot-1')
    await advanceAsync(FOLLOW_UP.afterMs - 1)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
    await advanceAsync(1)
    expect(interruptFollowUp).toHaveBeenCalledExactlyOnceWith('slot-1', 'sid-1')
    expect(result.current.notice?.text).toBe('copilot 1 に中断（Esc を 2 回）を送りました')
  })

  it('afterMs の間に画面が入力待ち(台帳の done)に変わると 2 回目を頼まず、作業中でなくなった旨を読み上げる', async () => {
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).screen = copilotScreen('done').lines
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      'copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした'
    )
  })

  it('afterMs の間に許可の確認(台帳の permission)に変わっても 2 回目を頼まない', async () => {
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).screen = copilotScreen('permission').lines
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      'copilot 1 が作業中でなくなったため、2 回目の Esc は送りませんでした'
    )
  })

  it('判定できない画面(帯が空の手書きの画面)に変わると 2 回目を頼まず、判定できなかった旨を読み上げる', async () => {
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).screen = ['─'.repeat(100), '❯', '─'.repeat(100)].map(
      (text) => makeLine(text)
    )
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe(
      'copilot 1 が作業中か判定できなかったため、2 回目の Esc は送りませんでした（まだ作業中なら、少し待ってからもう一度押してください）'
    )
  })

  it('2 回目の前に画面を読めなければ 2 回目を頼まず、console に記録する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { result } = renderCopilot()
    await press(result)
    ;(copilot1.controller as FakeController).readScreen = () => {
      throw new Error('disposed')
    }
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
  })

  it('2 回目を待つ間の同じタブの押し直しは何もしない(同期の再入の防止を 2 回目まで続ける)', async () => {
    const { result } = renderCopilot()
    await press(result)
    await press(result)
    expect(interrupt).toHaveBeenCalledTimes(1)
    expect(result.current.notice).toBeNull()
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).toHaveBeenCalledTimes(1)
  })

  it('待つ間に別のタブを選んでも、2 回目は送った先のタブの画面で確かめて送った先に頼む', async () => {
    const copilot2 = copilotTab('slot-2', 2, 'done')
    const activities = workingOf('slot-1', 'slot-2')
    const { result, rerender } = renderCopilot({ activities })
    await press(result)
    rerender({ selected: copilot2, activities, isSending: false, isSendConfirmOpen: false })
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).toHaveBeenCalledExactlyOnceWith('slot-1', 'sid-1')
    expect(result.current.notice?.text).toBe('copilot 1 に中断（Esc を 2 回）を送りました')
  })

  it('待つ間に別のタブを選んでそのタブを押しても、2 回目はそれぞれのタブの sessionId でそれぞれに頼み、待ちの数え直しは送った先のタブに付く', async () => {
    const copilot2 = copilotTab('slot-2', 2)
    const activities = workingOf('slot-1', 'slot-2')
    interrupt
      .mockResolvedValueOnce({ kind: 'sent', followUp: FOLLOW_UP })
      .mockResolvedValueOnce({ kind: 'sent', followUp: { afterMs: 100, sessionId: 'sid-2' } })
    const { result, rerender } = renderCopilot({ activities })
    const select = (selected: AgentSessionTabView): void => {
      rerender({ selected, activities, isSending: false, isSendConfirmOpen: false })
    }
    // 0ms に copilot 1 を押し、50ms に copilot 2 を選んで押す
    await press(result)
    await advanceAsync(50)
    select(copilot2)
    await press(result)
    expect(interrupt.mock.calls).toEqual([['slot-1'], ['slot-2']])
    // 100ms に copilot 1 の 2 回目、150ms に copilot 2 の 2 回目
    await advanceAsync(50)
    expect(interruptFollowUp.mock.calls).toEqual([['slot-1', 'sid-1']])
    await advanceAsync(50)
    expect(interruptFollowUp.mock.calls).toEqual([
      ['slot-1', 'sid-1'],
      ['slot-2', 'sid-2']
    ])
    // copilot 1 の待ちは copilot 1 の流れが終わった 100ms から数え直し、1,100ms で明ける(選択中のタブに付けると、押した 0ms から数えた 1,000ms で明けてしまう)
    select(copilot1)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS - 50 - 1)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await advanceAsync(1)
    expect(result.current.disabledReason).toBeNull()
  })

  it('2 回目の流れが終わった時点から 1,000ms の待ちを数え直す(押した時点から数えると、終わった時点から 999ms の間に押せてしまう)', async () => {
    let resolveFollowUp: (value: AgentInterruptFollowUpOutcome) => void = () => undefined
    interruptFollowUp.mockReturnValueOnce(
      new Promise<AgentInterruptFollowUpOutcome>((resolve) => {
        resolveFollowUp = resolve
      })
    )
    const { result } = renderCopilot()
    await press(result)
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).toHaveBeenCalledTimes(1)
    // 押してから 600ms の時点で 2 回目の結果が届く(流れが終わる)
    await advanceAsync(500)
    await act(async () => {
      resolveFollowUp({ kind: 'sent' })
    })
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
    await advanceAsync(1)
    expect(result.current.disabledReason).toBeNull()
  })

  it.each<AgentInterruptFollowUpOutcome>([
    { kind: 'stale' },
    { kind: 'not-pending' },
    { kind: 'expired' },
    { kind: 'no-session' },
    { kind: 'write-failed' },
    { kind: 'error', message: 'x' }
  ])(
    '2 回目の結果が %o なら読み上げない(失敗は useAgentSessions がタブの error に出す)',
    async (outcome) => {
      interruptFollowUp.mockResolvedValueOnce(outcome)
      const { result } = renderCopilot()
      await press(result)
      await advanceAsync(FOLLOW_UP.afterMs)
      expect(result.current.notice).toBeNull()
    }
  )

  // 失敗・頼まなかった・読めなかった・例外でも、流れが終わった時点(押してから afterMs)から 1,000ms の待ちを数え直し、送っている途中を
  // 解く(設計書「中断の流れ」の手順 8・9)。error(IPC の拒否)・stale は main が 2 回目を書いた後かもしれないので、数え直さないと
  // 次の 1 回目が前の 2 回目と 500ms の窓で組になりうる
  it.each<[string, () => void]>([
    ...(
      [
        { kind: 'stale' },
        { kind: 'not-pending' },
        { kind: 'expired' },
        { kind: 'no-session' },
        { kind: 'write-failed' },
        { kind: 'error', message: 'x' }
      ] satisfies AgentInterruptFollowUpOutcome[]
    ).map((outcome): [string, () => void] => [
      `2 回目の結果が ${outcome.kind} のとき`,
      () => {
        interruptFollowUp.mockResolvedValueOnce(outcome)
      }
    ]),
    [
      '2 回目の窓口が拒否したとき(拒否しない約束の外の例外)',
      () => {
        interruptFollowUp.mockRejectedValueOnce(new Error('unexpected'))
      }
    ],
    [
      '画面が入力待ちに変わり 2 回目を頼まなかったとき',
      () => {
        ;(copilot1.controller as FakeController).screen = copilotScreen('done').lines
      }
    ],
    [
      '2 回目の前に画面を読めなかったとき',
      () => {
        ;(copilot1.controller as FakeController).readScreen = () => {
          throw new Error('disposed')
        }
      }
    ]
  ])(
    '%s も、流れが終わった時点から 1,000ms の待ちを数え直し、その後は押せる',
    async (_title, arrange) => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { result } = renderCopilot()
      await press(result)
      arrange()
      await advanceAsync(FOLLOW_UP.afterMs)
      // 押した時点から数えたままなら、ここから 900ms で押せてしまう
      await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS - 1)
      expect(result.current.disabledReason).toBe(AGENT_INTERRUPT_DISABLED_COOLDOWN)
      await advanceAsync(1)
      expect(result.current.disabledReason).toBeNull()
    }
  )

  it('afterMs の前にアンマウントすると 2 回目を頼まず、タイマーを残さない(L-052)', async () => {
    const { result, unmount } = renderCopilot()
    await press(result)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('2 回目を待つ間に送った先のタブを閉じたら(選択はほかのタブへ移る)、画面を読まず 2 回目を頼まず、何も出さない', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const copilot2 = copilotTab('slot-2', 2)
    const activities = workingOf('slot-1', 'slot-2')
    const { result, rerender } = renderCopilot({ activities })
    await press(result)
    // 選んでいたタブを閉じると選択は残ったタブへ移る。閉じたかは選択中のタブではなく送った先のタブで確かめる
    isTabOpen.mockImplementation((slotId) => slotId !== 'slot-1')
    rerender({ selected: copilot2, activities, isSending: false, isSendConfirmOpen: false })
    const readScreen = vi.fn(() => {
      throw new Error('disposed')
    })
    ;(copilot1.controller as FakeController).readScreen = readScreen
    await advanceAsync(FOLLOW_UP.afterMs)
    expect(isTabOpen).toHaveBeenLastCalledWith('slot-1')
    expect(readScreen).not.toHaveBeenCalled()
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(result.current.notice).toBeNull()
  })

  it('1 回目の結果を待つ間にアンマウントすると、結果が sent でも 2 回目を待たず頼まず、タイマーを残さない(L-052)', async () => {
    const pending = deferredOutcome()
    interrupt.mockReturnValueOnce(pending.promise)
    const { result, unmount } = renderCopilot()
    await press(result)
    unmount()
    await act(async () => {
      pending.resolve({ kind: 'sent', followUp: FOLLOW_UP })
    })
    expect(vi.getTimerCount()).toBe(0)
    await advanceAsync(FOLLOW_UP.afterMs * 2)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('claude のタブ(followUp が null)は今までどおり 1 回だけで、2 回目の窓口を呼ばない', async () => {
    interrupt.mockResolvedValue({ kind: 'sent', followUp: null })
    const { result } = render()
    await press(result)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.notice?.text).toBe('claude 1 に中断（Esc）を送りました')
  })
})

describe('useAgentInterrupt: 送信の判定に使う中断の流れ(isInterrupting・isInterruptPending)', () => {
  it('claude: 押す前は偽、押してから 1,000ms の待ちの間だけ真で、isInterrupting の参照は描画をまたいで同じ', async () => {
    const { result, rerender } = render()
    const first = result.current.isInterrupting
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
    await press(result)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    // 待ちはタブごと
    expect(result.current.isInterrupting('slot-2')).toBe(false)
    advance(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    advance(1)
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
    rerender({
      selected: tab1,
      activities: workingOf('slot-1'),
      isSending: false,
      isSendConfirmOpen: false
    })
    expect(result.current.isInterrupting).toBe(first)
  })

  it('1 回目の結果が 1,000ms を超えて届かない間も真(isInFlight を合わせている)', async () => {
    const deferred = deferredOutcome()
    interrupt.mockReturnValueOnce(deferred.promise)
    const { result } = render()
    await press(result)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS + 500)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    await act(async () => {
      deferred.resolve({ kind: 'sent', followUp: null })
    })
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
  })

  it('copilot: 2 回目の流れが 1,000ms を超えて続く間も真で、流れが終わってから 1,000ms の待ちを数え直す', async () => {
    const copilot1 = copilotTab('slot-1', 1)
    interrupt.mockResolvedValue({ kind: 'sent', followUp: { afterMs: 1_200, sessionId: 'sid-1' } })
    const { result } = render({ selected: copilot1, activities: workingOf('slot-1') })
    await press(result)
    // 2 回目を頼む前(押してから 1,100ms。押した時点からの 1,000ms の待ちは明けている)
    await advanceAsync(1_100)
    expect(interruptFollowUp).not.toHaveBeenCalled()
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    // 2 回目を頼み、流れが終わる(ここから 1,000ms の待ちを数え直す)
    await advanceAsync(100)
    expect(interruptFollowUp).toHaveBeenCalledTimes(1)
    await advanceAsync(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    expect(result.current.isInterrupting('slot-1')).toBe(true)
    expect(result.current.isInterruptPending('slot-1')).toBe(true)
    await advanceAsync(1)
    expect(result.current.isInterrupting('slot-1')).toBe(false)
    expect(result.current.isInterruptPending('slot-1')).toBe(false)
  })
})
