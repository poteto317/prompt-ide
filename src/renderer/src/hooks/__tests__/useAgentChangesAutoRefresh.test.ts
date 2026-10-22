import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentNotificationTab } from '../../lib/agentNotificationEvents'
import {
  AUTO_REFRESH_MAX_WAIT_MS,
  AUTO_REFRESH_WAIT_MS,
  useAgentChangesAutoRefresh
} from '../useAgentChangesAutoRefresh'
import type { AgentChangesAutoRefreshOptions } from '../useAgentChangesAutoRefresh'

const tab: AgentNotificationTab = {
  slotId: 's1',
  number: 1,
  status: 'running',
  isClosing: false,
  cliKind: 'claude'
}
const activitiesOf = (activity: AgentActivity): ReadonlyMap<string, AgentActivity> =>
  new Map([['s1', activity]])

function setup(overrides: Partial<AgentChangesAutoRefreshOptions> = {}): {
  refresh: ReturnType<typeof vi.fn<AgentChangesAutoRefreshOptions['refresh']>>
  update: (next: Partial<AgentChangesAutoRefreshOptions>) => void
  unmount: () => void
} {
  const refresh = vi.fn<AgentChangesAutoRefreshOptions['refresh']>(async () => undefined)
  let props: AgentChangesAutoRefreshOptions = {
    isRecording: true,
    folderPath: '/repo',
    refresh,
    tabs: [tab],
    activities: activitiesOf('working'),
    ...overrides
  }
  const { rerender, unmount } = renderHook(
    (p: AgentChangesAutoRefreshOptions) => useAgentChangesAutoRefresh(p),
    { initialProps: props }
  )
  return {
    refresh,
    update: (next) => {
      props = { ...props, ...next }
      rerender(props)
    },
    unmount
  }
}

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}
const focusWindow = (): void => {
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
}
const changeVisibility = (state: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  // visibilityState の上書きを外し、jsdom の既定(prototype の getter)に戻す
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useAgentChangesAutoRefresh', () => {
  it('活動が working → idle(完了)になると、待ちの時間の後に 1 回だけ、読み上げずに静かに(quiet)取り直す', async () => {
    const { refresh, update } = setup()
    update({ activities: activitiesOf('idle') })
    await advance(AUTO_REFRESH_WAIT_MS - 1)
    expect(refresh).not.toHaveBeenCalled()
    await advance(1)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ announce: false, quiet: true })
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('copilot のタブの完了(working → idle)でも取り直す', async () => {
    const { refresh, update } = setup({ tabs: [{ ...tab, cliKind: 'copilot' }] })
    update({ activities: activitiesOf('idle') })
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledExactlyOnceWith({ announce: false, quiet: true })
  })

  it.each<AgentActivity>(['permission', 'confirm'])(
    '活動が %s(利用者を待つ)になっても取り直す',
    async (activity) => {
      const { refresh, update } = setup()
      update({ activities: activitiesOf(activity) })
      await advance(AUTO_REFRESH_WAIT_MS)
      expect(refresh).toHaveBeenCalledOnce()
    }
  )

  it('出来事にならない変化(working のまま・unknown)では取り直さない', async () => {
    const { refresh, update } = setup()
    update({ activities: activitiesOf('working') })
    update({ activities: activitiesOf('unknown') })
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('閉じる途中のタブの完了では取り直さない', async () => {
    const { refresh, update } = setup()
    update({ tabs: [{ ...tab, isClosing: true }], activities: activitiesOf('idle') })
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ウィンドウの focus で予約し、待ちの時間の後に 1 回だけ取り直す', async () => {
    const { refresh } = setup()
    focusWindow()
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('visibilitychange は visible のときだけ取り直し、hidden では取り直さない', async () => {
    const { refresh } = setup()
    changeVisibility('hidden')
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
    changeVisibility('visible')
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledOnce()
  })

  // L-399: 待ちだけのデバウンスは、契機が待ちより短い間隔で続く間に一度も走らない
  it('待ちより短い間隔で契機が続いても、最初の契機から上限の時間で必ず 1 回走る', async () => {
    const { refresh } = setup()
    const step = AUTO_REFRESH_WAIT_MS - 50
    let elapsed = 0
    while (elapsed + step < AUTO_REFRESH_MAX_WAIT_MS) {
      focusWindow()
      await advance(step)
      elapsed += step
    }
    focusWindow()
    await advance(AUTO_REFRESH_MAX_WAIT_MS - elapsed - 1)
    expect(refresh).not.toHaveBeenCalled()
    await advance(1)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('取り直しの実行中に契機が来たら、終わった後に 1 回だけ走り直す', async () => {
    const { refresh } = setup()
    let resolveFirst: () => void = () => undefined
    refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
    )
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveFirst()
    })
    // 完了の後の走り直しは Promise の解決の連鎖の後に呼ばれる(microtask の段数に頼らずに待つ)
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  // タイマーの数は、描画の後の数との差で比べる(React の内部のタイマーを数えない)
  it('記録中でない間は契機を捨て、タイマーを張らない', async () => {
    const { refresh, update } = setup({ isRecording: false })
    const before = vi.getTimerCount()
    focusWindow()
    update({ activities: activitiesOf('idle') })
    expect(vi.getTimerCount()).toBe(before)
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each<[string, Partial<AgentChangesAutoRefreshOptions>]>([
    ['記録中でなくなった', { isRecording: false }],
    ['フォルダが変わった', { folderPath: '/other' }]
  ])('%sら、予約を取り消す', async (_label, next) => {
    const { refresh, update } = setup()
    const before = vi.getTimerCount()
    focusWindow()
    expect(vi.getTimerCount()).toBe(before + 2)
    update(next)
    expect(vi.getTimerCount()).toBe(before)
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('アンマウントで予約を取り消し、focus の購読を外す', async () => {
    const { refresh, unmount } = setup()
    const before = vi.getTimerCount()
    focusWindow()
    unmount()
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before)
    window.dispatchEvent(new Event('focus'))
    await advance(AUTO_REFRESH_MAX_WAIT_MS)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('取り消した後に届いた古い取り直しの完了', () => {
  it('フォルダの切り替えの後に始まった取り直しの実行中は、古い完了が届いても並べて走らせない', async () => {
    const { refresh, update } = setup()
    let resolveFirst: () => void = () => undefined
    let resolveSecond: () => void = () => undefined
    refresh
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecond = resolve
          })
      )
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(1)
    update({ folderPath: '/other' })
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
    // 1 回目(前のフォルダ)の完了は古いため、2 回目が実行中のままとして扱う
    await act(async () => {
      resolveFirst()
    })
    focusWindow()
    await advance(AUTO_REFRESH_WAIT_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
    // 2 回目が終わったら、実行中に来た契機の分を 1 回だけ走らせ直す
    await act(async () => {
      resolveSecond()
    })
    expect(refresh).toHaveBeenCalledTimes(3)
  })
})
