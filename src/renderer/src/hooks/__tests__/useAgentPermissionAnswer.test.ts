// src/renderer/src/hooks/__tests__/useAgentPermissionAnswer.test.ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  toAgentPermissionAnswerAvailabilityInput,
  useAgentPermissionAnswer
} from '../useAgentPermissionAnswer'
import type {
  AgentPermissionAnswerPanelState,
  UseAgentPermissionAnswerOptions
} from '../useAgentPermissionAnswer'
import { useAgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerOutcome, AgentSessionTabView } from '../useAgentSessions'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentPermissionChoice } from '../../lib/agentPermissionPrompt'
import { readAgentPermissionPromptOrThrow } from '../../__tests__/readAgentPermissionPromptOrThrow'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen, makeLine } from '../../lib/__tests__/fixtures/agentScreens'
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'
import {
  AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN,
  AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING,
  AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED,
  AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED,
  AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP,
  AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM,
  AGENT_PERMISSION_ANSWER_DISABLED_SENDING,
  AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE,
  AGENT_PERMISSION_ANSWER_PROMPT_CHANGED,
  agentPermissionAnswerNoLongerPermissionReason,
  agentPermissionAnswerNumberKeysRejectedReason,
  agentPermissionAnswerSentNotice
} from '../../lib/agentPermissionAnswerMessages'

type Props = Omit<UseAgentPermissionAnswerOptions, 'cooldown' | 'answerPermission'>
interface Rendered {
  cooldown: AgentPermissionAnswerCooldown
  answer: AgentPermissionAnswerPanelState
}

let answerPermission: ReturnType<typeof vi.fn<UseAgentPermissionAnswerOptions['answerPermission']>>
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

// 実行中で許可待ちのタブ。readScreen は記録した画面を返す
function permissionTab(
  slotId: string,
  number: number,
  cliKind: AgentCliKind = 'claude'
): AgentSessionTabView {
  const controller = makeFakeController()
  controller.screen = (
    cliKind === 'claude' ? agentScreen('permission') : copilotScreen('permission')
  ).lines
  return makeAgentSessionTabView({ slotId, number, cliKind, status: 'running', controller })
}
const screenOf = (tab: AgentSessionTabView): FakeController => tab.controller as FakeController
const permissionOf = (...slotIds: string[]): ReadonlyMap<string, AgentActivity> =>
  new Map(slotIds.map((slotId): [string, AgentActivity] => [slotId, 'permission']))
// 判定用と表示用の読み取りは、指定が無ければ同じ値(useAgentPermissionPrompt が読み直し待ちでないとき)
const propsFor = (tab: AgentSessionTabView, overrides: Partial<Props> = {}): Props => {
  const prompt =
    overrides.prompt !== undefined
      ? overrides.prompt
      : readAgentPermissionPromptOrThrow(tab.cliKind, screenOf(tab).screen)
  return {
    selected: tab,
    activities: permissionOf(tab.slotId),
    prompt,
    displayPrompt: prompt,
    isSending: false,
    isSendConfirmOpen: false,
    isPanelOpen: true,
    isInterruptPending: () => false,
    isInterrupting: () => false,
    appearGrace: { isJustAppeared: false, isJustAppearedNow: () => false },
    ...overrides
  }
}

function render(initial: Props): RenderHookResult<Rendered, Props> {
  return renderHook(
    (p: Props) => {
      const cooldown = useAgentPermissionAnswerCooldown()
      return { cooldown, answer: useAgentPermissionAnswer({ ...p, cooldown, answerPermission }) }
    },
    { initialProps: initial }
  )
}

const press = async (
  result: RenderHookResult<Rendered, Props>['result'],
  choice: AgentPermissionChoice
): Promise<void> => {
  await act(async () => {
    result.current.answer.onAnswer(choice)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  answerPermission = vi.fn<UseAgentPermissionAnswerOptions['answerPermission']>(async () => ({
    kind: 'sent'
  }))
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionAnswer: 描画の状態', () => {
  it('許可待ちで読み取れたら出し、問いの 1 行目と全文・名前を入れる', () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    const { answer } = result.current
    expect(answer.visible).toBe(true)
    expect(answer.question).toEqual({
      firstLine: 'Do you want to proceed?',
      full: 'Do you want to proceed?'
    })
    expect(answer.allow).toEqual({
      disabledReason: null,
      ariaLabel: '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
    })
    expect(answer.deny).toEqual({
      disabledReason: null,
      ariaLabel: '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
    })
  })

  it('読み取りが無い(prompt が null)ときは問いを出さず、名前は「許可の確認に Yes で答える」', () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1), { prompt: null }))
    expect(result.current.answer.question).toBeNull()
    expect(result.current.answer.allow.ariaLabel).toBe(
      '許可（claude 1 の許可の確認に Yes で答える）'
    )
    expect(result.current.answer.deny.ariaLabel).toBe('拒否（claude 1 の許可の確認に No で答える）')
  })

  it('答えた直後でなく(読み直し待ちでない)prompt が null なら、押せない理由は「読み取れない」(isAnswering が先に止める二重の守りの予備)', () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1), { prompt: null }))
    expect(result.current.cooldown.isPending('slot-1')).toBe(false)
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    )
    expect(result.current.answer.deny.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_UNREADABLE
    )
  })

  it('判定用の prompt が null(読み直し待ち)でも、問いと名前は表示用の displayPrompt から作る', () => {
    const tab = permissionTab('slot-1', 1)
    const displayPrompt = readAgentPermissionPromptOrThrow(tab.cliKind, screenOf(tab).screen)
    const { result } = render(propsFor(tab, { prompt: null, displayPrompt }))
    expect(result.current.answer.question?.firstLine).toBe('Do you want to proceed?')
    expect(result.current.answer.allow.ariaLabel).toBe(
      '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
    )
    expect(result.current.answer.deny.ariaLabel).toBe(
      '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
    )
  })

  it('許可待ちでなければ出さない', () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab, { activities: new Map([[tab.slotId, 'working']]) }))
    expect(result.current.answer.visible).toBe(false)
  })

  it('中断の流れの間(描画用の state)は、中断の理由を両方のボタンに出す', () => {
    const { result } = render(
      propsFor(permissionTab('slot-1', 1), { isInterruptPending: () => true })
    )
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING
    )
    expect(result.current.answer.deny.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING
    )
  })

  it('確認が出た直後(描画用の state)は、出た直後の理由を両方のボタンに出す', () => {
    const { result } = render(
      propsFor(permissionTab('slot-1', 1), {
        appearGrace: { isJustAppeared: true, isJustAppearedNow: () => true }
      })
    )
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED
    )
    expect(result.current.answer.deny.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED
    )
  })
})

describe('useAgentPermissionAnswer: パネルを閉じている間', () => {
  it('描画: 許可 にパネルを閉じている理由を出し、拒否 は押せる。帯には出す', () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1), { isPanelOpen: false }))
    expect(result.current.answer.visible).toBe(true)
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED
    )
    expect(result.current.answer.deny.disabledReason).toBeNull()
  })

  it('押した時点: 許可 は IPC を呼ばず、画面を読まず、理由を読み上げる', async () => {
    const tab = permissionTab('slot-1', 1)
    const readSpy = vi.spyOn(screenOf(tab), 'readScreen')
    const { result } = render(propsFor(tab, { isPanelOpen: false }))
    await press(result, 'allow')
    expect(answerPermission).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
    expect(result.current.answer.notice?.text).toBe(AGENT_PERMISSION_ANSWER_DISABLED_PANEL_CLOSED)
  })

  it('押した時点: 拒否 は閉じていても送る(4 番)', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1), { isPanelOpen: false }))
    await press(result, 'deny')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 4)
  })

  it('押した時点は最新の値で見る(開いた描画で作った onAnswer でも、閉じた後に押せば送らない。開き直せば送る)', async () => {
    const tab = permissionTab('slot-1', 1)
    const { result, rerender } = render(propsFor(tab))
    const onAnswerWhileOpen = result.current.answer.onAnswer
    rerender(propsFor(tab, { isPanelOpen: false }))
    await act(async () => {
      onAnswerWhileOpen('allow')
    })
    expect(answerPermission).not.toHaveBeenCalled()
    rerender(propsFor(tab))
    expect(result.current.answer.allow.disabledReason).toBeNull()
    await press(result, 'allow')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 1)
  })
})

describe('useAgentPermissionAnswer: 押したとき', () => {
  it('許可は選択中のタブと 1 番で IPC を呼び、送れたら読み上げ、待ちを始める', async () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    await press(result, 'allow')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 1)
    expect(result.current.answer.notice?.text).toBe(
      agentPermissionAnswerSentNotice('claude 1', 'claude', 'allow', 1)
    )
    expect(result.current.cooldown.isPending('slot-1')).toBe(true)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN
    )
  })

  it('claude の拒否は 4 番', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'deny')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 4)
  })

  it('copilot の拒否は 2 番で、読み上げにターミナルでの入力の案内が付く', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1, 'copilot')))
    await press(result, 'deny')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 2)
    expect(result.current.answer.notice?.text).toBe(
      'copilot 1 で拒否（2 番）を選びました。ターミナルで、代わりにしてほしいことを入力して Enter を押してください'
    )
  })

  it('結果を待つ間の同じタブの 2 回目は IPC を呼ばず、何も読み上げない(同期の再入の防止。L-101・L-653)', async () => {
    answerPermission.mockReturnValue(new Promise<AgentPermissionAnswerOutcome>(() => undefined))
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    act(() => {
      result.current.answer.onAnswer('allow')
      result.current.answer.onAnswer('deny')
    })
    expect(answerPermission).toHaveBeenCalledOnce()
    expect(result.current.answer.notice).toBeNull()
  })

  it('待ちはタブごと(slot-1 の結果を待つ間も、選び直した slot-2 には答えられる)', async () => {
    answerPermission.mockReturnValueOnce(new Promise<AgentPermissionAnswerOutcome>(() => undefined))
    const tab1 = permissionTab('slot-1', 1)
    const tab2 = permissionTab('slot-2', 2)
    const { result, rerender } = render(propsFor(tab1))
    await press(result, 'allow')
    rerender(propsFor(tab2))
    await press(result, 'allow')
    expect(answerPermission.mock.calls).toEqual([
      ['slot-1', 1],
      ['slot-2', 1]
    ])
  })

  it('押した直後(1,000ms 以内)にもう一度押すと、IPC を呼ばず答えた直後の理由を読み上げる', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    await press(result, 'allow')
    expect(answerPermission).toHaveBeenCalledOnce()
    expect(result.current.answer.notice?.text).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
  })

  it.each<[string, Partial<Props>, string]>([
    ['送信中', { isSending: true }, AGENT_PERMISSION_ANSWER_DISABLED_SENDING],
    [
      '送信前の確認の表示中',
      { isSendConfirmOpen: true },
      AGENT_PERMISSION_ANSWER_DISABLED_SEND_CONFIRM
    ],
    // 描画の値(isInterruptPending)は偽でも、押した時点の値(ref)で止める
    [
      '中断の流れの間(押した時点の ref)',
      { isInterrupting: () => true },
      AGENT_PERMISSION_ANSWER_DISABLED_INTERRUPTING
    ],
    // 描画の値(isJustAppeared)は偽でも、押した時点の値(ref)で止める
    [
      '確認が出た直後(押した時点の ref)',
      { appearGrace: { isJustAppeared: false, isJustAppearedNow: () => true } },
      AGENT_PERMISSION_ANSWER_DISABLED_JUST_APPEARED
    ]
  ])(
    '段階 (a) %s: IPC を呼ばず、画面を読まず、理由を読み上げる',
    async (_name, overrides, reason) => {
      const tab = permissionTab('slot-1', 1)
      const readSpy = vi.spyOn(screenOf(tab), 'readScreen')
      const { result } = render(propsFor(tab, overrides))
      await press(result, 'allow')
      expect(answerPermission).not.toHaveBeenCalled()
      expect(readSpy).not.toHaveBeenCalled()
      expect(result.current.answer.notice?.text).toBe(reason)
    }
  )

  it.each<[string, (tab: AgentSessionTabView) => void, AgentCliKind, string]>([
    [
      '押した時点は入力待ちの画面',
      (tab) => {
        screenOf(tab).screen = agentScreen('empty').lines
      },
      'claude',
      agentPermissionAnswerNoLongerPermissionReason('claude')
    ],
    [
      '本文(コマンド)だけを変えた画面',
      (tab) => {
        screenOf(tab).screen = screenOf(tab).screen.map((line, y) =>
          y === 15 ? makeLine(' rm -rf build') : line
        )
      },
      'claude',
      AGENT_PERMISSION_ANSWER_PROMPT_CHANGED
    ],
    [
      'copilot の permissionDown(カーソルが最後の選択肢)',
      (tab) => {
        screenOf(tab).screen = copilotScreen('permissionDown').lines
      },
      'copilot',
      agentPermissionAnswerNumberKeysRejectedReason('copilot')
    ]
  ])(
    '段階 (b)〜(f) %s: 描画は permission でも IPC を呼ばず理由を読み上げる',
    async (_name, change, kind, reason) => {
      const tab = permissionTab('slot-1', 1, kind)
      const { result } = render(propsFor(tab))
      change(tab)
      await press(result, 'allow')
      expect(answerPermission).not.toHaveBeenCalled()
      expect(result.current.answer.notice?.text).toBe(reason)
    }
  )

  it('押した時点の readScreen が投げたら、IPC を呼ばず読み上げず console に記録する', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    vi.spyOn(screenOf(tab), 'readScreen').mockImplementation(() => {
      throw new Error('disposed')
    })
    await press(result, 'allow')
    expect(answerPermission).not.toHaveBeenCalled()
    expect(result.current.answer.notice).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it.each<AgentPermissionAnswerOutcome>([
    { kind: 'no-session' },
    { kind: 'write-failed' },
    { kind: 'stale' },
    { kind: 'skipped' },
    { kind: 'error', message: 'x' }
  ])('結果が %o なら読み上げない(失敗の表示は useAgentSessions の役目)', async (outcome) => {
    answerPermission.mockResolvedValueOnce(outcome)
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    expect(result.current.answer.notice).toBeNull()
  })

  it('IPC の呼び出しが拒否しても、送っている途中を解く(finally。L-053)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    answerPermission.mockRejectedValueOnce(new Error('boom'))
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    expect(result.current.cooldown.isInFlight('slot-1')).toBe(false)
  })

  it('同じ文言の読み上げが続いても id を進める', async () => {
    const { result } = render(propsFor(permissionTab('slot-1', 1)))
    await press(result, 'allow')
    const first = result.current.answer.notice?.id ?? 0
    await press(result, 'allow')
    await press(result, 'allow')
    expect(result.current.answer.notice?.text).toBe(AGENT_PERMISSION_ANSWER_DISABLED_COOLDOWN)
    expect(result.current.answer.notice?.id).toBeGreaterThan(first + 1)
  })
})

describe('useAgentPermissionAnswer: ターミナルを上へスクロールしている間', () => {
  it('描画: 許可 にスクロールしている理由を出し、拒否 は押せる。帯には出す', () => {
    const tab = permissionTab('slot-1', 1)
    screenOf(tab).scrolledToBottom = false
    const { result } = render(propsFor(tab))
    expect(result.current.answer.visible).toBe(true)
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    )
    expect(result.current.answer.deny.disabledReason).toBeNull()
  })

  it('描画: xterm のスクロールをきっかけに理由が変わる(上へ戻すと出て、末尾へ戻すと消える)', () => {
    const tab = permissionTab('slot-1', 1)
    const { result } = render(propsFor(tab))
    expect(result.current.answer.allow.disabledReason).toBeNull()
    act(() => screenOf(tab).scrollTo(false))
    expect(result.current.answer.allow.disabledReason).toBe(
      AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP
    )
    act(() => screenOf(tab).scrollTo(true))
    expect(result.current.answer.allow.disabledReason).toBeNull()
  })

  it('押した時点: 描画の後にスクロールした(再描画の前)なら、許可 は IPC を呼ばず、画面を読まず、理由を読み上げる', async () => {
    const tab = permissionTab('slot-1', 1)
    const readSpy = vi.spyOn(screenOf(tab), 'readScreen')
    const { result } = render(propsFor(tab))
    // 通知を起こさずに値だけ変える(押した時点で controller から直接読むこと)
    screenOf(tab).scrolledToBottom = false
    await press(result, 'allow')
    expect(answerPermission).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()
    expect(result.current.answer.notice?.text).toBe(AGENT_PERMISSION_ANSWER_DISABLED_SCROLLED_UP)
  })

  it('押した時点: 描画ではスクロールしていても、押した時点で末尾なら 許可 を送る(1 番)', async () => {
    const tab = permissionTab('slot-1', 1)
    screenOf(tab).scrolledToBottom = false
    const { result } = render(propsFor(tab))
    screenOf(tab).scrolledToBottom = true
    await press(result, 'allow')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 1)
  })

  it('押した時点: 拒否 はスクロールしていても送る(4 番)', async () => {
    const tab = permissionTab('slot-1', 1)
    screenOf(tab).scrolledToBottom = false
    const { result } = render(propsFor(tab))
    await press(result, 'deny')
    expect(answerPermission).toHaveBeenCalledExactlyOnceWith('slot-1', 4)
  })
})

describe('toAgentPermissionAnswerAvailabilityInput', () => {
  it('選択中のタブの状態・活動・読み取りと、送信中・確認の表示中・パネルの開閉・中断の流れ・答えた直後・確認が出た直後・スクロールの値をそのまま写す', () => {
    const tab = { ...permissionTab('slot-1', 1), isClosing: true }
    const prompt = readAgentPermissionPromptOrThrow('claude', agentScreen('permission').lines)
    expect(
      toAgentPermissionAnswerAvailabilityInput(
        {
          selected: tab,
          activities: permissionOf('slot-1'),
          prompt,
          isSending: true,
          isSendConfirmOpen: true,
          isPanelOpen: false
        },
        {
          isInterrupting: true,
          isAnswering: false,
          isJustAppeared: true,
          isScrolledToBottom: false
        }
      )
    ).toEqual({
      status: 'running',
      cliKind: 'claude',
      isClosing: true,
      activity: 'permission',
      isSending: true,
      isSendConfirmOpen: true,
      isPanelOpen: false,
      isInterrupting: true,
      isAnswering: false,
      isJustAppeared: true,
      isScrolledToBottom: false,
      prompt
    })
  })

  it('活動が未記録のタブは unknown', () => {
    const input = toAgentPermissionAnswerAvailabilityInput(
      {
        selected: permissionTab('slot-1', 1),
        activities: permissionOf('slot-2'),
        prompt: null,
        isSending: false,
        isSendConfirmOpen: false,
        isPanelOpen: true
      },
      { isInterrupting: false, isAnswering: false, isJustAppeared: false, isScrolledToBottom: true }
    )
    expect(input.activity).toBe('unknown')
  })
})
