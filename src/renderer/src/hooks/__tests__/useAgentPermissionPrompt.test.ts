// src/renderer/src/hooks/__tests__/useAgentPermissionPrompt.test.ts
import { act, renderHook } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { useAgentPermissionPrompt } from '../useAgentPermissionPrompt'
import type {
  AgentPermissionPromptState,
  AgentPermissionPromptTab
} from '../useAgentPermissionPrompt'
import { useAgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import { AGENT_ACTIVITY_MAX_WAIT_MS, AGENT_ACTIVITY_SETTLE_MS } from '../useAgentActivity'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../../lib/agentPermissionAnswer'
import type { AgentPermissionPrompt } from '../../lib/agentPermissionPrompt'
import type { AgentActivity } from '../../lib/agentActivity'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { agentScreen } from '../../lib/__tests__/fixtures/agentScreens'
import { copilotScreen } from '../../lib/__tests__/fixtures/copilotScreens'

interface Props {
  selected: AgentPermissionPromptTab
  activity: AgentActivity
}
interface Rendered {
  cooldown: AgentPermissionAnswerCooldown
  state: AgentPermissionPromptState
}
interface RenderLog {
  awaiting: boolean
  prompt: AgentPermissionPrompt | null
  displayPrompt: AgentPermissionPrompt | null
}

let controller1: FakeController
let controller2: FakeController
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

const tabOf = (
  slotId: string,
  controller: FakeController,
  overrides: Partial<AgentPermissionPromptTab> = {}
): AgentPermissionPromptTab => ({
  slotId,
  status: 'running',
  cliKind: 'claude',
  controller,
  ...overrides
})

// 本物の待ち(useAgentPermissionAnswerCooldown)と組にして使う(useAgentWorkspace と同じ渡し方)。描画ごとの値を控える
function render(
  initial: Partial<Props> = {}
): RenderHookResult<Rendered, Props> & { log: RenderLog[] } {
  const log: RenderLog[] = []
  const rendered = renderHook(
    (p: Props) => {
      const cooldown = useAgentPermissionAnswerCooldown()
      const state = useAgentPermissionPrompt({
        ...p,
        isAwaitingReread: cooldown.isAwaitingReread,
        onReread: cooldown.markReread
      })
      log.push({
        awaiting: cooldown.isAwaitingReread(p.selected.slotId),
        prompt: state.prompt,
        displayPrompt: state.displayPrompt
      })
      return { cooldown, state }
    },
    { initialProps: { selected: tabOf('slot-1', controller1), activity: 'permission', ...initial } }
  )
  return { ...rendered, log }
}

const advance = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  controller1 = makeFakeController()
  controller1.screen = agentScreen('permission').lines
  controller2 = makeFakeController()
  controller2.screen = agentScreen('permission').lines
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionPrompt', () => {
  it('許可待ちになった描画で、通知を待たずに画面を読む', () => {
    const { result } = render()
    expect(result.current.state.prompt?.question).toEqual(['Do you want to proceed?'])
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
  })

  // controller1 は beforeEach で作るので、表には値ではなく作り方を置く
  it.each<[string, () => Partial<Props>]>([
    ['許可待ちでない', () => ({ activity: 'working' })],
    ['running でない', () => ({ selected: tabOf('slot-1', controller1, { status: 'starting' }) })]
  ])('%s 間は null で、購読もタイマーも持たない', (_name, propsOf) => {
    const { result } = render(propsOf())
    expect(result.current.state.prompt).toBeNull()
    expect(controller1.outputWrittenListeners.size).toBe(0)
    expect(controller1.resizedListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('出力の通知の 150ms 後に読み直す(149ms では読まない)', () => {
    controller1.screen = copilotScreen('permission').lines
    const { result } = render({ selected: tabOf('slot-1', controller1, { cliKind: 'copilot' }) })
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    controller1.screen = copilotScreen('permissionDown').lines
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS - 1)
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    advance(1)
    expect(result.current.state.prompt?.cursorNumber).toBe(2)
    expect(result.current.state.prompt?.numberKeysAccepted).toBe(false)
  })

  it('出力の通知が 150ms より短い間隔で続いても、最初の未読の通知から 500ms で読み直す', () => {
    controller1.screen = copilotScreen('permission').lines
    const { result } = render({ selected: tabOf('slot-1', controller1, { cliKind: 'copilot' }) })
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    controller1.screen = copilotScreen('permissionDown').lines
    // 100ms おきに通知が続く(settle の 150ms は一度も満たない)
    act(() => controller1.emitOutputWritten())
    for (let elapsed = 100; elapsed < AGENT_ACTIVITY_MAX_WAIT_MS; elapsed += 100) {
      advance(100)
      act(() => controller1.emitOutputWritten())
    }
    advance(99)
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    advance(1)
    expect(result.current.state.prompt?.cursorNumber).toBe(2)
    // 読んだ後の通知からは、また上限を数え直す(最後の通知の 150ms 後に読む)
    controller1.screen = copilotScreen('permission').lines
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS)
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    // 2 回目も、最初の未読の通知から 500ms で読む(上限が一度発火した後も張り直す)
    controller1.screen = copilotScreen('permissionDown').lines
    act(() => controller1.emitOutputWritten())
    for (let elapsed = 100; elapsed < AGENT_ACTIVITY_MAX_WAIT_MS; elapsed += 100) {
      advance(100)
      act(() => controller1.emitOutputWritten())
    }
    advance(99)
    expect(result.current.state.prompt?.cursorNumber).toBe(1)
    advance(1)
    expect(result.current.state.prompt?.cursorNumber).toBe(2)
  })

  // 上限の読み直しは出力が続いている最中に走り、CLI の描き直しの途中(活動の判定が unknown になる画面)を読みうる。
  // useAgentActivity の上限の判定と同じく、その画面は採らずに前の読み取りと読み直し待ちを保ち、出力が途絶えた後の待ちで読む
  it.each<[string, boolean]>([
    ['読み直し待ちでない', false],
    ['読み直し待ち', true]
  ])(
    '%s とき、上限の時点の画面が描き直しの途中(unknown)なら採らず、その後の 150ms の待ちで読み直す',
    (_name, awaiting) => {
      controller1.screen = copilotScreen('permission').lines
      const { result } = render({ selected: tabOf('slot-1', controller1, { cliKind: 'copilot' }) })
      const before = result.current.state.displayPrompt
      expect(before?.cursorNumber).toBe(1)
      if (awaiting) act(() => result.current.cooldown.begin('slot-1'))
      const promptBefore = result.current.state.prompt
      // 100ms おきに通知が続き、上限(500ms)の時点の画面だけ描き直しの途中(空)
      act(() => controller1.emitOutputWritten())
      for (let elapsed = 100; elapsed < AGENT_ACTIVITY_MAX_WAIT_MS; elapsed += 100) {
        advance(100)
        act(() => controller1.emitOutputWritten())
      }
      advance(99)
      controller1.screen = []
      advance(1)
      expect(result.current.state.displayPrompt).toBe(before)
      expect(result.current.state.prompt).toBe(promptBefore)
      expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(awaiting)
      // 描き終えた画面を、最後の通知の 150ms 後の待ちで読む
      controller1.screen = copilotScreen('permissionDown').lines
      advance(AGENT_ACTIVITY_SETTLE_MS - 100 - 1)
      expect(result.current.state.displayPrompt).toBe(before)
      advance(1)
      expect(result.current.state.displayPrompt?.cursorNumber).toBe(2)
      expect(result.current.state.prompt?.cursorNumber).toBe(2)
      expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
    }
  )

  it('上限で unknown を捨てた後も、次の通知から上限を数え直す(通知が途切れずに続いても読み直す)', () => {
    controller1.screen = copilotScreen('permission').lines
    const { result } = render({ selected: tabOf('slot-1', controller1, { cliKind: 'copilot' }) })
    act(() => controller1.emitOutputWritten())
    for (let elapsed = 100; elapsed < AGENT_ACTIVITY_MAX_WAIT_MS; elapsed += 100) {
      advance(100)
      act(() => controller1.emitOutputWritten())
    }
    advance(99)
    controller1.screen = []
    advance(1) // 上限: unknown なので採らない
    controller1.screen = copilotScreen('permissionDown').lines
    for (let elapsed = 0; elapsed < AGENT_ACTIVITY_MAX_WAIT_MS + 100; elapsed += 100) {
      act(() => controller1.emitOutputWritten())
      advance(100)
    }
    expect(result.current.state.prompt?.cursorNumber).toBe(2)
  })

  it('ターミナルの大きさの変化の通知だけでも 150ms 後に読み直す(claude は行を増やしただけでは描き直さず、出力の通知が来ない)', () => {
    // 低いターミナル: 上の罫線(10 行目)より上が画面の上へ流れている
    controller1.screen = agentScreen('permission').lines.slice(11)
    const { result } = render()
    expect(result.current.state.prompt?.bodyStartVisible).toBe(false)
    // 広げると xterm がスクロールバックの行(上の罫線)を画面へ下ろす。出力の通知は無い
    controller1.screen = agentScreen('permission').lines
    act(() => controller1.emitResized())
    advance(AGENT_ACTIVITY_SETTLE_MS - 1)
    expect(result.current.state.prompt?.bodyStartVisible).toBe(false)
    advance(1)
    expect(result.current.state.prompt?.bodyStartVisible).toBe(true)
  })

  it('読み直した値が前と同じなら state を変えない(描画を増やさない)', () => {
    const { log } = render()
    const before = log.length
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS)
    expect(log.length).toBe(before)
  })

  it('許可待ちでなくなると null を返し、購読を外す', () => {
    const { result, rerender } = render()
    expect(controller1.outputWrittenListeners.size).toBe(1)
    expect(controller1.resizedListeners.size).toBe(1)
    rerender({ selected: tabOf('slot-1', controller1), activity: 'working' })
    expect(result.current.state.prompt).toBeNull()
    expect(controller1.outputWrittenListeners.size).toBe(0)
    expect(controller1.resizedListeners.size).toBe(0)
  })

  it('タブを切り替えると、切り替えた先のタブの画面を読む', () => {
    controller2.screen = agentScreen('permissionAfterClear').lines
    const readSpy = vi.spyOn(controller2, 'readScreen')
    const { result, rerender } = render()
    rerender({ selected: tabOf('slot-2', controller2), activity: 'permission' })
    expect(readSpy).toHaveBeenCalled()
    expect(result.current.state.prompt).not.toBeNull()
    expect(controller1.outputWrittenListeners.size).toBe(0)
    expect(controller2.outputWrittenListeners.size).toBe(1)
  })

  it('読み直し待ちになった描画で null を返し、次の出力の通知の 150ms 後に読み直す。読み取りの更新と読み直し待ちの解除は同じ描画に入る', () => {
    const { result, log } = render()
    act(() => result.current.cooldown.begin('slot-1'))
    expect(result.current.state.prompt).toBeNull()
    const startedAt = log.length
    act(() => controller1.emitOutputWritten())
    advance(AGENT_ACTIVITY_SETTLE_MS - 1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(true)
    advance(1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
    expect(result.current.state.prompt).not.toBeNull()
    // 待ちが外れた描画で prompt が null のまま見えない(「画面の選択肢を読み取れませんでした」が一瞬出ない)
    expect(
      log.slice(startedAt).filter((entry) => !entry.awaiting && entry.prompt === null)
    ).toEqual([])
  })

  it('読み直し待ちの間も、表示の値(displayPrompt)は同じタブの直前の読み取りのまま(ボタンの名前と問いを変えない)', () => {
    const { result, rerender } = render()
    const before = result.current.state.prompt
    expect(before).not.toBeNull()
    expect(result.current.state.displayPrompt).toBe(before)
    act(() => result.current.cooldown.begin('slot-1'))
    expect(result.current.state.prompt).toBeNull()
    expect(result.current.state.displayPrompt).toBe(before)
    // 許可待ちでなくなったら表示の値も null
    rerender({ selected: tabOf('slot-1', controller1), activity: 'working' })
    expect(result.current.state.displayPrompt).toBeNull()
  })

  it('タブを切り替えた描画でも、前のタブの読み取りを表示の値に使わない', () => {
    const { result, rerender, log } = render()
    const slot1Prompt = result.current.state.displayPrompt
    expect(slot1Prompt).not.toBeNull()
    const startedAt = log.length
    rerender({ selected: tabOf('slot-2', controller2), activity: 'permission' })
    expect(log.slice(startedAt).map((entry) => entry.displayPrompt === slot1Prompt)).not.toContain(
      true
    )
    expect(result.current.state.displayPrompt).not.toBeNull()
  })

  it('読み直し待ちの間に出力が無くても、AGENT_PERMISSION_ANSWER_COOLDOWN_MS 後に読み直す(999ms は待ち)', () => {
    const { result } = render()
    act(() => result.current.cooldown.begin('slot-1'))
    advance(AGENT_PERMISSION_ANSWER_COOLDOWN_MS - 1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.state.prompt).toBeNull()
    advance(1)
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
    expect(result.current.state.prompt).not.toBeNull()
  })

  it('読み直し待ちで許可待ちでなくなったら(作業中)、すぐ読み直し待ちを外す', () => {
    const { result, rerender } = render()
    act(() => result.current.cooldown.begin('slot-1'))
    rerender({ selected: tabOf('slot-1', controller1), activity: 'working' })
    expect(result.current.cooldown.isAwaitingReread('slot-1')).toBe(false)
  })

  it.each<[string, (r: RenderHookResult<Rendered, Props>) => void]>([
    [
      '作業中にする',
      (r) => r.rerender({ selected: tabOf('slot-1', controller1), activity: 'working' })
    ],
    ['アンマウントする', (r) => r.unmount()]
  ])('読み直し待ちのまま%sと、1,000ms の読み直しのタイマーを残さない', (_name, leave) => {
    const rendered = render()
    act(() => rendered.result.current.cooldown.begin('slot-1'))
    const readSpy = vi.spyOn(controller1, 'readScreen')
    leave(rendered)
    advance(AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
    expect(readSpy).not.toHaveBeenCalled()
  })

  it('選択中でないタブの読み直し待ちは残り、そのタブを選んだ描画で読んで外れる', () => {
    const { result, rerender } = render()
    act(() => result.current.cooldown.begin('slot-2'))
    advance(AGENT_PERMISSION_ANSWER_COOLDOWN_MS * 2)
    expect(result.current.cooldown.isAwaitingReread('slot-2')).toBe(true)
    rerender({ selected: tabOf('slot-2', controller2), activity: 'permission' })
    expect(result.current.cooldown.isAwaitingReread('slot-2')).toBe(false)
    expect(result.current.state.prompt).not.toBeNull()
  })

  it('readScreen が投げたら null を控えて console に記録する', () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(controller1, 'readScreen').mockImplementation(() => {
      throw new Error('disposed')
    })
    const { result } = render()
    expect(result.current.state.prompt).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('アンマウントで購読とタイマーを残さない', () => {
    const { unmount } = render()
    act(() => controller1.emitOutputWritten())
    // 待ち(AGENT_ACTIVITY_SETTLE_MS)と上限(AGENT_ACTIVITY_MAX_WAIT_MS)の 2 つ
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(controller1.outputWrittenListeners.size).toBe(0)
    expect(controller1.resizedListeners.size).toBe(0)
  })
})
