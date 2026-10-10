import { StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { RenderHookResult } from '@testing-library/react'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentNotificationKind } from '../../lib/agentNotificationEvents'
import { formatAgentNotificationAnnouncement } from '../../lib/agentNotificationEvents'

vi.mock('../../lib/agentNotificationApi')

import * as agentNotificationApi from '../../lib/agentNotificationApi'
import { useAgentNotifications } from '../useAgentNotifications'
import type { AgentNotificationTab, UseAgentNotificationsOptions } from '../useAgentNotifications'

const mockShow = vi.mocked(agentNotificationApi.showAgentNotification)
const mockSetBadge = vi.mocked(agentNotificationApi.setAgentNotificationBadge)
const mockOnActivated = vi.mocked(agentNotificationApi.onAgentNotificationActivated)
const mockDismiss = vi.mocked(agentNotificationApi.dismissAgentNotification)
const unsubscribe = vi.fn()
let activated: (payload: { slotId: string }) => void = () => undefined
let warnSpy: MockInstance<typeof console.warn>

beforeEach(() => {
  vi.resetAllMocks()
  mockShow.mockResolvedValue(undefined)
  mockSetBadge.mockResolvedValue(undefined)
  mockDismiss.mockResolvedValue(undefined)
  activated = () => undefined
  mockOnActivated.mockImplementation((listener) => {
    activated = listener
    return unsubscribe
  })
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  warnSpy.mockRestore()
})

// 読み上げの期待値。文言とつなぎ方は agentNotificationText・agentNotificationEvents のテストで固定し、ここではどのタブの
// どの出来事を読み上げたかだけを見る(文言の変更を 1 か所に閉じる)
const said = (...events: [kind: AgentNotificationKind, tabNumber: number][]): string =>
  formatAgentNotificationAnnouncement(
    events.map(([kind, tabNumber]) => ({ slotId: `slot-${tabNumber}`, tabNumber, kind }))
  )

const tab = (n: number, overrides: Partial<AgentNotificationTab> = {}): AgentNotificationTab => ({
  slotId: `slot-${n}`,
  number: n,
  status: 'running',
  isClosing: false,
  ...overrides
})
const acts = (...entries: [string, AgentActivity][]): ReadonlyMap<string, AgentActivity> =>
  new Map(entries)

type Setup = RenderHookResult<string, UseAgentNotificationsOptions> & {
  activateTab: Mock<(slotId: string) => void>
  update: (next: Partial<UseAgentNotificationsOptions>) => void
}

/** 初期の props で描画し、update で一部を差し替えて描画し直す */
function setup(initial: Partial<UseAgentNotificationsOptions> = {}): Setup {
  const activateTab = vi.fn<(slotId: string) => void>()
  let props: UseAgentNotificationsOptions = {
    tabs: [tab(1)],
    activities: acts(['slot-1', 'unknown']),
    enabled: true,
    isAgentMode: true,
    activateTab,
    ...initial
  }
  const hook = renderHook((p: UseAgentNotificationsOptions) => useAgentNotifications(p), {
    initialProps: props
  })
  const update = (next: Partial<UseAgentNotificationsOptions>): void => {
    props = { ...props, ...next }
    hook.rerender(props)
  }
  return { ...hook, activateTab, update }
}

describe('useAgentNotifications', () => {
  describe('出来事', () => {
    // 出来事の決め方(起動の直後の idle・閉じる途中のタブなど)は agentNotificationEvents のテストで固定する。ここでは hook の
    // 受け持ち(最後の確かな活動の持ち越しと置き換え・タブの一覧の変化での見直し・読み上げ・設定による送信)だけを見る
    it('working → idle で作業の完了を読み上げ、通知を送る', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'idle']) })
      expect(result.current).toBe(said(['done', 1]))
      expect(mockShow).toHaveBeenCalledExactlyOnceWith({
        slotId: 'slot-1',
        tabNumber: 1,
        kind: 'done'
      })
    })

    it('unknown を挟んでも許可待ちを 1 回だけ知らせる', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'unknown']) })
      update({ activities: acts(['slot-1', 'permission']) })
      update({ activities: acts(['slot-1', 'unknown']) })
      update({ activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe(said(['permission', 1]))
      expect(mockShow.mock.calls).toEqual([
        [{ slotId: 'slot-1', tabNumber: 1, kind: 'permission' }]
      ])
    })

    it.each([false, null])('設定が %s なら通知を送らないが、読み上げはする', (enabled) => {
      const { result, update } = setup({ enabled, activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe(said(['permission', 1]))
      expect(mockShow).not.toHaveBeenCalled()
    })

    // 規則は lib のテストで固定する。ここではタブの isClosing を lib へ渡す配線を見る(ほかのテストでは守られない)
    it('閉じる途中のタブは読み上げも通知もしない', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ tabs: [tab(1, { isClosing: true })], activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe('')
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('running でないタブは知らせず、記録を忘れる(再起動の直後の idle を完了としない)', () => {
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ tabs: [tab(1, { status: 'exited' })], activities: acts(['slot-1', 'unknown']) })
      update({ tabs: [tab(1)], activities: acts(['slot-1', 'idle']) })
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('unknown のまま終了して再起動しても(活動の Map が同じ参照でも)完了を出さない', () => {
      const unknown = acts(['slot-1', 'unknown'])
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: unknown })
      // 活動の Map は同じ参照のまま、タブの一覧だけが変わる
      update({ tabs: [tab(1, { status: 'exited' })] })
      update({ tabs: [tab(1, { status: 'starting' })] })
      update({ tabs: [tab(1)] })
      update({ activities: acts(['slot-1', 'idle']) })
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('消えたタブの記録を忘れる', () => {
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ tabs: [tab(2)], activities: acts(['slot-2', 'unknown']) })
      update({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'idle'], ['slot-2', 'unknown'])
      })
      expect(mockShow).not.toHaveBeenCalled()
    })

    it('同じ描画で複数のタブに出来事があれば、読み上げをつなぎ、通知をタブごとに送る', () => {
      const { result, update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'])
      })
      update({ activities: acts(['slot-1', 'permission'], ['slot-2', 'idle']) })
      expect(result.current).toBe(said(['permission', 1], ['done', 2]))
      expect(mockShow.mock.calls).toEqual([
        [{ slotId: 'slot-1', tabNumber: 1, kind: 'permission' }],
        [{ slotId: 'slot-2', tabNumber: 2, kind: 'done' }]
      ])
    })
  })

  describe('バッジ', () => {
    it('マウントの直後は 0 でも必ず送る', () => {
      setup()
      expect(mockSetBadge.mock.calls).toEqual([[0]])
    })

    it('最後の確かな活動が許可待ち・確認待ちのタブを数え、一時的な unknown では揺れない', () => {
      const { update } = setup({
        tabs: [tab(1), tab(2), tab(3)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'], ['slot-3', 'working'])
      })
      update({
        activities: acts(['slot-1', 'permission'], ['slot-2', 'confirm'], ['slot-3', 'idle'])
      })
      update({ activities: acts(['slot-1', 'unknown'], ['slot-2', 'confirm'], ['slot-3', 'idle']) })
      // 今の活動ではなく最後の確かな活動で数えるので、unknown の間も 2 のまま送り直さない
      expect(mockSetBadge.mock.calls).toEqual([[0], [2]])
      update({ activities: acts(['slot-1', 'working'], ['slot-2', 'confirm'], ['slot-3', 'idle']) })
      expect(mockSetBadge.mock.calls).toEqual([[0], [2], [1]])
    })

    it('閉じる途中・running でないタブは数えない(L-393)', () => {
      const { update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'permission'], ['slot-2', 'permission'])
      })
      update({ tabs: [tab(1, { isClosing: true }), tab(2, { status: 'exited' })] })
      expect(mockSetBadge.mock.calls).toEqual([[2], [0]])
    })

    it('設定がオフ・読み込み中なら 0 を送る', () => {
      const { update } = setup({ enabled: null, activities: acts(['slot-1', 'permission']) })
      update({ enabled: true })
      update({ enabled: false })
      expect(mockSetBadge.mock.calls).toEqual([[0], [1], [0]])
    })

    it('アンマウントで 0 を送る', () => {
      const { unmount } = setup({ activities: acts(['slot-1', 'permission']) })
      unmount()
      expect(mockSetBadge.mock.calls).toEqual([[1], [0]])
    })
  })

  describe('通知を押したとき', () => {
    it('今あるタブなら、押された通知のタブで activateTab を呼ぶ', () => {
      const { activateTab } = setup({ tabs: [tab(1), tab(2)] })
      act(() => activated({ slotId: 'slot-2' }))
      expect(activateTab).toHaveBeenCalledExactlyOnceWith('slot-2')
    })

    it('閉じたタブなら何もしない', () => {
      const { activateTab, update } = setup({ tabs: [tab(1), tab(2)] })
      update({ tabs: [tab(1)] })
      act(() => activated({ slotId: 'slot-2' }))
      expect(activateTab).not.toHaveBeenCalled()
    })

    it('アンマウントで購読を外す', () => {
      const { unmount } = setup()
      unmount()
      expect(unsubscribe).toHaveBeenCalledOnce()
    })
  })

  describe('タブを閉じたとき', () => {
    it('マウントの直後は何も閉じない', () => {
      setup({ tabs: [tab(1), tab(2)], activities: acts(['slot-1', 'unknown']) })
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it('タブの一覧から消えたタブの通知を閉じるよう main へ頼む(番号が使い回されても、前のタブの通知を残さない)', () => {
      const { update } = setup({ tabs: [tab(1), tab(2)] })
      update({ tabs: [tab(1)] })
      expect(mockDismiss.mock.calls).toEqual([[{ slotId: 'slot-2' }]])
      // 同じ番号の新しいタブ(slotId は別)が開いても、閉じたタブを重ねて頼まない
      update({ tabs: [tab(1), { ...tab(2), slotId: 'slot-2b' }] })
      expect(mockDismiss).toHaveBeenCalledOnce()
    })

    it('running でない・閉じる途中のタブは、一覧に残っている間は閉じない', () => {
      const { update } = setup({ tabs: [tab(1), tab(2)] })
      update({ tabs: [tab(1, { status: 'exited' }), tab(2, { isClosing: true })] })
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it.each([false, null])('設定が %s でも頼む(オンのときに出した通知を閉じるため)', (enabled) => {
      const { update } = setup({ enabled, tabs: [tab(1), tab(2)] })
      update({ tabs: [tab(1)] })
      expect(mockDismiss).toHaveBeenCalledExactlyOnceWith({ slotId: 'slot-2' })
    })

    it('依頼が拒否されても console.warn に出すだけで、ほかのタブの依頼を止めない', async () => {
      mockDismiss.mockRejectedValueOnce(new Error('dismiss failed'))
      const { update } = setup({ tabs: [tab(1), tab(2), tab(3)] })
      update({ tabs: [] })
      await act(async () => {
        await Promise.resolve()
      })
      expect(mockDismiss).toHaveBeenCalledTimes(3)
      expect(warnSpy).toHaveBeenCalledWith(
        '[useAgentNotifications] dismissAgentNotification failed:',
        expect.any(Error)
      )
    })
  })

  describe('許可・選択に答えたとき', () => {
    it('最後の確かな活動が許可待ち・確認待ちから working・idle へ変わると、そのタブの通知を閉じるよう頼む', () => {
      const { update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'permission'], ['slot-2', 'confirm'])
      })
      update({ activities: acts(['slot-1', 'unknown'], ['slot-2', 'confirm']) })
      expect(mockDismiss).not.toHaveBeenCalled()
      update({ activities: acts(['slot-1', 'working'], ['slot-2', 'confirm']) })
      expect(mockDismiss.mock.calls).toEqual([[{ slotId: 'slot-1' }]])
      update({ activities: acts(['slot-1', 'working'], ['slot-2', 'idle']) })
      expect(mockDismiss.mock.calls).toEqual([[{ slotId: 'slot-1' }], [{ slotId: 'slot-2' }]])
    })

    it('許可待ちのまま終了すると、そのタブの通知を閉じるよう 1 回だけ頼む', () => {
      const { update } = setup({ activities: acts(['slot-1', 'permission']) })
      update({ tabs: [tab(1, { status: 'exited' })], activities: acts(['slot-1', 'unknown']) })
      expect(mockDismiss.mock.calls).toEqual([[{ slotId: 'slot-1' }]])
      update({ tabs: [tab(1, { status: 'exited' })], activities: acts(['slot-1', 'unknown']) })
      expect(mockDismiss).toHaveBeenCalledOnce()
    })

    it('作業の完了(done)の通知は閉じない', () => {
      const { update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'idle']) })
      expect(mockShow).toHaveBeenCalledOnce()
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it('許可待ちから確認待ちへ移ったときは閉じず、新しい通知で入れ替える', () => {
      const { update } = setup({ activities: acts(['slot-1', 'permission']) })
      update({ activities: acts(['slot-1', 'confirm']) })
      expect(mockShow).toHaveBeenLastCalledWith({
        slotId: 'slot-1',
        tabNumber: 1,
        kind: 'confirm'
      })
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it.each([false, null])('設定が %s でも頼む(オンのときに出した通知を閉じるため)', (enabled) => {
      const { update } = setup({ enabled, activities: acts(['slot-1', 'permission']) })
      // マウントの許可待ちの出来事でも(設定がオフなので)閉じるよう頼む。ここでは答えたときの依頼だけを見る
      mockDismiss.mockClear()
      update({ activities: acts(['slot-1', 'working']) })
      expect(mockDismiss).toHaveBeenCalledExactlyOnceWith({ slotId: 'slot-1' })
    })
  })

  describe('設定がオフのときの出来事', () => {
    // 新しい出来事が起きた時点で、そのタブの前の通知(オンのときに出したもの)は古い。通知は出さず、前の通知を閉じるよう頼む
    it.each([false, null])(
      '設定が %s なら、出来事のタブの通知を閉じるよう頼み、新しい通知は送らない',
      (enabled) => {
        const { update } = setup({ enabled, activities: acts(['slot-1', 'permission']) })
        mockDismiss.mockClear()
        update({ activities: acts(['slot-1', 'confirm']) })
        expect(mockShow).not.toHaveBeenCalled()
        expect(mockDismiss).toHaveBeenCalledExactlyOnceWith({ slotId: 'slot-1' })
      }
    )

    it('作業の完了の出来事でも、そのタブの前の通知を閉じるよう頼む', () => {
      const { update } = setup({
        enabled: false,
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'])
      })
      update({ activities: acts(['slot-1', 'idle'], ['slot-2', 'working']) })
      expect(mockShow).not.toHaveBeenCalled()
      expect(mockDismiss).toHaveBeenCalledExactlyOnceWith({ slotId: 'slot-1' })
    })
  })

  describe('エージェント CLI 方式でないとき', () => {
    // 従来の方式ではターミナルのパネルが出ないため、知らせず、残っている通知を閉じ、押してもタブへ移らない
    it('出来事を読み上げず、通知も送らない', () => {
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ isAgentMode: false })
      mockDismiss.mockClear()
      update({ activities: acts(['slot-1', 'permission']) })
      expect(result.current).toBe('')
      expect(mockShow).not.toHaveBeenCalled()
      expect(mockDismiss).toHaveBeenCalledWith({ slotId: 'slot-1' })
    })

    it('バッジは 0 を送り、エージェント CLI 方式へ戻ると数え直す', () => {
      const { update } = setup({ activities: acts(['slot-1', 'permission']) })
      update({ isAgentMode: false })
      update({ isAgentMode: true })
      expect(mockSetBadge.mock.calls).toEqual([[1], [0], [1]])
    })

    it('方式が変わった回に 1 度だけ、一覧のタブすべての通知を閉じるよう頼む', () => {
      const { update } = setup({ tabs: [tab(1), tab(2)] })
      update({ isAgentMode: false })
      expect(mockDismiss.mock.calls).toEqual([[{ slotId: 'slot-1' }], [{ slotId: 'slot-2' }]])
      mockDismiss.mockClear()
      update({ tabs: [tab(1, { status: 'exited' }), tab(2, { status: 'exited' })] })
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it('マウントの時点で従来の方式なら何も閉じない', () => {
      setup({ isAgentMode: false, tabs: [tab(1), tab(2)] })
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it('通知を押しても activateTab を呼ばず、エージェント CLI 方式へ戻ると呼ぶ', () => {
      const { activateTab, update } = setup({ tabs: [tab(1)] })
      update({ isAgentMode: false })
      act(() => activated({ slotId: 'slot-1' }))
      expect(activateTab).not.toHaveBeenCalled()
      update({ isAgentMode: true })
      act(() => activated({ slotId: 'slot-1' }))
      expect(activateTab).toHaveBeenCalledExactlyOnceWith('slot-1')
    })
  })

  describe('StrictMode の取り付け直し', () => {
    it('最後の確かな活動を持ち越して二重に知らせず、バッジは 0 の後に送り直し、購読は 1 つだけ残す', () => {
      const activateTab = vi.fn<(slotId: string) => void>()
      const { result } = renderHook(
        () =>
          useAgentNotifications({
            tabs: [tab(1)],
            activities: acts(['slot-1', 'permission']),
            enabled: true,
            isAgentMode: true,
            activateTab
          }),
        { wrapper: StrictMode }
      )
      expect(result.current).toBe(said(['permission', 1]))
      expect(mockShow).toHaveBeenCalledOnce()
      // アンマウントの後始末で 0 を送り、再取り付けで未送信として今の数を送り直す
      expect(mockSetBadge.mock.calls).toEqual([[1], [0], [1]])
      expect(mockOnActivated).toHaveBeenCalledTimes(2)
      expect(unsubscribe).toHaveBeenCalledOnce()
      // 取り付け直しではタブは消えていないので、通知を閉じない
      expect(mockDismiss).not.toHaveBeenCalled()
    })
  })

  describe('IPC の失敗', () => {
    it('通知・バッジの送信が拒否されても、読み上げは続け、console.warn に出す', async () => {
      mockShow.mockRejectedValue(new Error('show failed'))
      mockSetBadge.mockRejectedValue(new Error('badge failed'))
      const { result, update } = setup({ activities: acts(['slot-1', 'working']) })
      update({ activities: acts(['slot-1', 'permission']) })
      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current).toBe(said(['permission', 1]))
      expect(warnSpy).toHaveBeenCalledWith(
        '[useAgentNotifications] showAgentNotification failed:',
        expect.any(Error)
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[useAgentNotifications] setAgentNotificationBadge failed:',
        expect.any(Error)
      )
    })

    it('送信が同期で投げても、ほかのタブの出来事を止めない(L-053)', () => {
      mockShow.mockImplementation(() => {
        throw new Error('sync')
      })
      const { result, update } = setup({
        tabs: [tab(1), tab(2)],
        activities: acts(['slot-1', 'working'], ['slot-2', 'working'])
      })
      update({ activities: acts(['slot-1', 'permission'], ['slot-2', 'permission']) })
      expect(mockShow).toHaveBeenCalledTimes(2)
      expect(result.current).toBe(said(['permission', 1], ['permission', 2]))
    })
  })
})
