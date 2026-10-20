import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  AGENT_ACTIVITY_MAX_WAIT_MS,
  AGENT_ACTIVITY_SETTLE_MS,
  useAgentActivity
} from '../useAgentActivity'
import type { AgentActivityTab, UseAgentActivityOptions } from '../useAgentActivity'
import type { AgentActivity } from '../../lib/agentActivity'
import type { ViewportLine } from '../../lib/agentViewport'
import { makeFakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import type { AgentSessionStatus } from '../../lib/agentSessionTabState'
import type { AgentCliKind } from '@shared/agentCliKinds'

const tabOf = (
  slotId: string,
  controller: FakeController,
  status: AgentSessionStatus = 'running',
  cliKind: AgentCliKind = 'claude'
): AgentActivityTab => ({ slotId, status, controller, cliKind })

describe('useAgentActivity', () => {
  let activity: AgentActivity
  let classify: ReturnType<typeof vi.fn<(lines: readonly ViewportLine[]) => AgentActivity>>

  beforeEach(() => {
    vi.useFakeTimers()
    activity = 'working'
    classify = vi.fn<(lines: readonly ViewportLine[]) => AgentActivity>(() => activity)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  const render = (
    tabs: AgentActivityTab[]
  ): RenderHookResult<ReadonlyMap<string, AgentActivity>, UseAgentActivityOptions> =>
    renderHook<ReadonlyMap<string, AgentActivity>, UseAgentActivityOptions>(
      (props) => useAgentActivity(props),
      { initialProps: { tabs, classify } }
    )

  it('running のタブで通知が来ると、待ち(AGENT_ACTIVITY_SETTLE_MS)の後に画面を読んで判定する(待ちの途中では判定しない)', () => {
    const controller = makeFakeController()
    const screen: ViewportLine[] = [[{ chars: 'x', width: 1 }] as unknown as ViewportLine]
    controller.screen = screen
    const { result } = render([tabOf('a', controller)])
    expect(result.current.get('a')).toBe('unknown')

    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS - 1))
    expect(classify).not.toHaveBeenCalled()
    expect(result.current.get('a')).toBe('unknown')

    act(() => vi.advanceTimersByTime(1))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(classify).toHaveBeenCalledWith(screen)
    expect(result.current.get('a')).toBe('working')
  })

  it('待ちの間に続いた通知はまとめ、最後の通知から待った後に 1 回だけ判定する(上限より短い範囲)', () => {
    // 最初の通知から判定まで 2 * SETTLE - 1 で、上限(AGENT_ACTIVITY_MAX_WAIT_MS)より短い
    expect(2 * AGENT_ACTIVITY_SETTLE_MS - 1).toBeLessThan(AGENT_ACTIVITY_MAX_WAIT_MS)
    const controller = makeFakeController()
    const { result } = render([tabOf('a', controller)])

    // 最初の通知からは待ちを過ぎても、最後の通知からの待ちが済むまでは判定しない
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS - 1))
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS - 1))
    expect(classify).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('working')
  })

  it('通知が待ちより短い間隔で続いても、最初の未判定の通知から上限(AGENT_ACTIVITY_MAX_WAIT_MS)が経てば判定する', () => {
    // claude は作業中、スピナーなどを描き続けるため、待ちだけでは判定が止まったままになる
    const controller = makeFakeController()
    const { result } = render([tabOf('a', controller)])
    // 最初から running のタブの判定を済ませてから数える
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    classify.mockClear()
    activity = 'idle'

    const step = AGENT_ACTIVITY_SETTLE_MS - 1
    let elapsed = 0
    act(() => controller.emitOutputWritten())
    while (elapsed + step < AGENT_ACTIVITY_MAX_WAIT_MS) {
      act(() => vi.advanceTimersByTime(step))
      elapsed += step
      act(() => controller.emitOutputWritten())
    }
    expect(classify).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS - elapsed - 1))
    expect(classify).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('idle')

    // 判定したら上限の起点を消す: 次の上限は判定の後の最初の通知から数える
    activity = 'working'
    act(() => vi.advanceTimersByTime(step))
    act(() => controller.emitOutputWritten())
    elapsed = 0
    while (elapsed + step < AGENT_ACTIVITY_MAX_WAIT_MS) {
      act(() => vi.advanceTimersByTime(step))
      elapsed += step
      act(() => controller.emitOutputWritten())
    }
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS - elapsed - 1))
    expect(classify).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1))
    expect(classify).toHaveBeenCalledTimes(2)
    expect(result.current.get('a')).toBe('working')
  })

  // 上限の判定は出力が続いている最中に走り、claude の描き直しの途中(入力欄・スピナーを消した後、描く前)を読みうる。
  // その結果が unknown なら採らず前の活動を保ち、出力が途絶えた後の待ちの判定に任せる
  it('上限で判定した結果が unknown なら前の活動を保ち、出力が途絶えた後の待ちの判定なら unknown に変わる', () => {
    const controller = makeFakeController()
    const { result } = render([tabOf('a', controller)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')
    classify.mockClear()
    activity = 'unknown'

    const step = AGENT_ACTIVITY_SETTLE_MS - 1
    let elapsed = 0
    act(() => controller.emitOutputWritten())
    while (elapsed + step < AGENT_ACTIVITY_MAX_WAIT_MS) {
      act(() => vi.advanceTimersByTime(step))
      elapsed += step
      act(() => controller.emitOutputWritten())
    }
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS - elapsed))
    // 上限の判定は走ったが、unknown は採らない
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('working')

    // 出力が途絶えた後の待ちの判定では unknown を採る
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).toHaveBeenCalledTimes(2)
    expect(result.current.get('a')).toBe('unknown')
  })

  it('running から外れたら、上限の待ちも取り消す', () => {
    const controller = makeFakeController()
    const { rerender } = render([tabOf('a', controller)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    classify.mockClear()

    act(() => controller.emitOutputWritten())
    rerender({ tabs: [tabOf('a', controller, 'exited')], classify })
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS))
    expect(classify).not.toHaveBeenCalled()
  })

  it('タブが消えたら、上限の待ちも取り消す', () => {
    const controller = makeFakeController()
    const { rerender } = render([tabOf('a', controller)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    classify.mockClear()

    act(() => controller.emitOutputWritten())
    rerender({ tabs: [], classify })
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS))
    expect(classify).not.toHaveBeenCalled()
  })

  it('タブごとに別々に判定する', () => {
    const first = makeFakeController()
    const second = makeFakeController()
    const { result } = render([tabOf('a', first), tabOf('b', second)])
    // 最初から running のタブは通知が無くても判定される(別のテスト)。それを済ませてから比べる
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('b')).toBe('working')

    activity = 'idle'
    act(() => first.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('idle')
    expect(result.current.get('b')).toBe('working')
  })

  it('running でないタブは通知が来ても unknown のまま', () => {
    const controller = makeFakeController()
    const { result } = render([tabOf('a', controller, 'starting')])

    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).not.toHaveBeenCalled()
    expect(result.current.get('a')).toBe('unknown')
  })

  it('starting の間の通知の後、running になると待ちの後に判定される', () => {
    // 起動の直後は、保留していた出力の書き込みの通知が running になる前に届き、その後 claude が何も描かないことがある
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller, 'starting')])
    act(() => controller.emitOutputWritten())
    rerender({ tabs: [tabOf('a', controller, 'running')], classify })
    expect(result.current.get('a')).toBe('unknown')

    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS - 1))
    expect(classify).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('working')
  })

  it('最初から running のタブは、通知が無くても待ちの後に判定される(リロードで引き継いだセッション)', () => {
    const controller = makeFakeController()
    const { result } = render([tabOf('a', controller)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('working')
  })

  it('running から外れたら unknown に戻り、待っている判定を取り消す', () => {
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller)])
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')

    act(() => controller.emitOutputWritten())
    rerender({ tabs: [tabOf('a', controller, 'exited')], classify })
    expect(result.current.get('a')).toBe('unknown')
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('unknown')
  })

  it('起動し直したら(running に入り直したら)前の活動は使わず unknown から', () => {
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller)])
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')

    rerender({ tabs: [tabOf('a', controller, 'exited')], classify })
    rerender({ tabs: [tabOf('a', controller, 'starting')], classify })
    rerender({ tabs: [tabOf('a', controller, 'running')], classify })
    expect(result.current.get('a')).toBe('unknown')

    activity = 'idle'
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('idle')
  })

  it('タブが消えたら購読を外し、待っているタイマーも取り消す', () => {
    const controller = makeFakeController()
    const other = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller), tabOf('b', other)])
    expect(controller.outputWrittenListeners.size).toBe(1)
    // 最初から running のタブの判定を済ませてから数える
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    classify.mockClear()

    act(() => controller.emitOutputWritten())
    rerender({ tabs: [tabOf('b', other)], classify })
    expect(controller.outputWrittenListeners.size).toBe(0)
    expect(other.outputWrittenListeners.size).toBe(1)
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).not.toHaveBeenCalled()
    expect(result.current.has('a')).toBe(false)
  })

  it('controller が変わったら購読を張り直す', () => {
    const before = makeFakeController()
    const after = makeFakeController()
    const { result, rerender } = render([tabOf('a', before)])
    rerender({ tabs: [tabOf('a', after)], classify })
    expect(before.outputWrittenListeners.size).toBe(0)
    expect(after.outputWrittenListeners.size).toBe(1)

    act(() => after.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')
  })

  it('running のまま controller が変わっても、セッションの区切りとは見なさず活動を保つ', () => {
    // 張り直しは購読だけで、前回 running だったかの控えは引き継ぐ(引き継がないと running に入り直したと見なされ unknown に戻る)
    const before = makeFakeController()
    const after = makeFakeController()
    const { result, rerender } = render([tabOf('a', before)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')
    classify.mockClear()

    rerender({ tabs: [tabOf('a', after)], classify })
    expect(result.current.get('a')).toBe('working')
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).not.toHaveBeenCalled()
  })

  it('タブの配列が作り直されても、slotId と controller が同じなら購読を張り直さない', () => {
    const controller = makeFakeController()
    const onOutputWritten = vi.spyOn(controller, 'onOutputWritten')
    const { rerender } = render([tabOf('a', controller)])
    rerender({ tabs: [tabOf('a', controller)], classify })
    rerender({ tabs: [tabOf('a', controller, 'exited')], classify })
    expect(onOutputWritten).toHaveBeenCalledTimes(1)
  })

  it('アンマウントで購読とタイマーを外す', () => {
    const controller = makeFakeController()
    const { unmount } = render([tabOf('a', controller)])
    act(() => controller.emitOutputWritten())
    unmount()
    expect(controller.outputWrittenListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(classify).not.toHaveBeenCalled()
  })

  it('StrictMode の取り付け直し(アンマウント → 再取り付け)の後も、最初から running のタブを通知なしで判定する', () => {
    // アンマウントの後始末がタブごとの控え(前回 running だったか)まで捨てないと、再取り付けで running に「入った」と見なされず判定が予約されない
    const controller = makeFakeController()
    const { result } = renderHook(
      () => useAgentActivity({ tabs: [tabOf('a', controller)], classify }),
      {
        wrapper: StrictMode
      }
    )
    expect(controller.outputWrittenListeners.size).toBe(1)
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).toHaveBeenCalledTimes(1)
    expect(result.current.get('a')).toBe('working')
  })

  it('判定の結果が前と同じなら、戻り値の Map は同じ参照のまま', () => {
    const controller = makeFakeController()
    let renders = 0
    const { result } = renderHook(
      (props: UseAgentActivityOptions) => {
        renders += 1
        return useAgentActivity(props)
      },
      { initialProps: { tabs: [tabOf('a', controller)], classify } }
    )
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    const first = result.current
    const rendersAfterFirst = renders

    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(classify).toHaveBeenCalledTimes(2)
    expect(result.current).toBe(first)
    expect(renders).toBe(rendersAfterFirst)
  })

  it('タブの配列が作り直されても、内容が同じなら戻り値の Map は同じ参照のまま', () => {
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller)])
    const first = result.current
    rerender({ tabs: [tabOf('a', controller)], classify })
    expect(result.current).toBe(first)
  })

  it('classify を省くと classifyAgentScreen で判定する(空の画面は unknown)', () => {
    const controller = makeFakeController()
    const { result } = renderHook(() => useAgentActivity({ tabs: [tabOf('a', controller)] }))
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('unknown')
  })

  it('画面の判定が無い種類(copilot)のタブは購読せず、出力が来ても判定しない(タイマーも張らない)', () => {
    const controller = makeFakeController()
    const { result } = render([tabOf('a', controller, 'running', 'copilot')])
    expect(controller.outputWrittenListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS))
    expect(classify).not.toHaveBeenCalled()
    expect(result.current.get('a')).toBe('unknown')
  })

  it('claude から copilot に種類が変わったタブ(同じタブで起動し直した)は、購読を外して活動の記録を消す', () => {
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')
    rerender({ tabs: [tabOf('a', controller, 'running', 'copilot')], classify })
    expect(controller.outputWrittenListeners.size).toBe(0)
    expect(result.current.get('a')).toBe('unknown')
    classify.mockClear()
    act(() => controller.emitOutputWritten())
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_MAX_WAIT_MS))
    expect(classify).not.toHaveBeenCalled()
  })

  it('claude から copilot に種類が変わった直後の最初の描画(記録を消す effect の前)でも、古い活動を返さず unknown にする', () => {
    const controller = makeFakeController()
    // 描画ごとの戻り値を記録する(effect が記録を消した後の再描画では、最初の描画の値が見えないため)
    const seen: AgentActivity[] = []
    const { rerender } = renderHook<ReadonlyMap<string, AgentActivity>, UseAgentActivityOptions>(
      (props) => {
        const activities = useAgentActivity(props)
        seen.push(activities.get('a') ?? 'unknown')
        return activities
      },
      { initialProps: { tabs: [tabOf('a', controller)], classify } }
    )
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(seen.at(-1)).toBe('working')
    const before = seen.length
    rerender({ tabs: [tabOf('a', controller, 'running', 'copilot')], classify })
    expect(seen.length).toBeGreaterThan(before)
    expect(seen[before]).toBe('unknown')
    expect(seen.slice(before)).toEqual(seen.slice(before).map(() => 'unknown'))
  })

  it('copilot から claude に戻ったタブは、購読を張り直して判定する', () => {
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller, 'running', 'copilot')])
    rerender({ tabs: [tabOf('a', controller)], classify })
    expect(controller.outputWrittenListeners.size).toBe(1)
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')
  })

  it('claude → copilot → claude と戻ったタブは、戻った後の判定までは copilot の前の活動を返さず unknown にする', () => {
    const controller = makeFakeController()
    const { result, rerender } = render([tabOf('a', controller)])
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS))
    expect(result.current.get('a')).toBe('working')
    rerender({ tabs: [tabOf('a', controller, 'running', 'copilot')], classify })
    rerender({ tabs: [tabOf('a', controller)], classify })
    // copilot にした effect で記録を消しているため、戻った直後(判定の待ちの間)は unknown
    act(() => vi.advanceTimersByTime(AGENT_ACTIVITY_SETTLE_MS - 1))
    expect(result.current.get('a')).toBe('unknown')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.get('a')).toBe('working')
  })
})
