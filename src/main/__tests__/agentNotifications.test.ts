import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { agentNotificationText } from '@shared/agentNotificationText'
import { createAgentNotificationCenter } from '../agentNotifications'
import type {
  AgentNotificationCenter,
  AgentNotificationHandle,
  AgentNotificationWindow
} from '../agentNotifications'

// Electron の Notification・app.dock・BrowserWindow は偽物(実物の表示は実機テスト仕様書で確かめる。L-059)

interface FakeNotification extends AgentNotificationHandle {
  options: { title: string; body: string }
  show: Mock<() => void>
  close: Mock<() => void>
  /** 利用者が押した */
  click: () => void
  /**
   * close の知らせを購読する(center のインターフェースには無い。center が購読し直したら、下の close の知らせのテストで分かる
   * ように、偽物だけが受け付ける)
   */
  onClose: (listener: () => void) => void
  /** close の知らせが届いた(実物では close の呼び出しの後に遅れて届く・届かない、Windows はタイムアウトでも届く) */
  emitClose: () => void
}

type FakeWindow = { [K in keyof Omit<AgentNotificationWindow, 'webContents'>]: Mock } & {
  webContents: { isDestroyed: Mock<() => boolean>; send: Mock }
}

function makeWindow(
  state: { focused?: boolean; minimized?: boolean; destroyed?: boolean } = {}
): FakeWindow {
  return {
    isDestroyed: vi.fn(() => state.destroyed ?? false),
    isFocused: vi.fn(() => state.focused ?? false),
    isMinimized: vi.fn(() => state.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
    webContents: { isDestroyed: vi.fn(() => false), send: vi.fn() }
  }
}

function setup(options: { platform?: NodeJS.Platform; supported?: boolean } = {}): {
  center: AgentNotificationCenter
  created: FakeNotification[]
  setDockBadge: Mock<(text: string) => void>
} {
  const created: FakeNotification[] = []
  const setDockBadge = vi.fn<(text: string) => void>()
  const center = createAgentNotificationCenter({
    platform: options.platform ?? 'darwin',
    isSupported: () => options.supported ?? true,
    createNotification: (notificationOptions) => {
      const clickListeners: (() => void)[] = []
      const closeListeners: (() => void)[] = []
      const notification: FakeNotification = {
        options: notificationOptions,
        show: vi.fn(),
        // 実物と同じく、閉じると close が届く
        close: vi.fn(() => notification.emitClose()),
        onClick: (listener) => clickListeners.push(listener),
        onClose: (listener) => closeListeners.push(listener),
        click: () => clickListeners.forEach((listener) => listener()),
        emitClose: () => closeListeners.forEach((listener) => listener())
      }
      created.push(notification)
      return notification
    },
    setDockBadge
  })
  return { center, created, setDockBadge }
}

const request = { slotId: 'slot-1', tabNumber: 2, kind: 'permission', cliKind: 'claude' } as const

describe('createAgentNotificationCenter', () => {
  describe('show', () => {
    it('フォーカスが無ければ、固定の表から作った題・本文で通知を出す', () => {
      const { center, created } = setup()
      center.show(makeWindow(), request)
      expect(created).toHaveLength(1)
      // 文言そのものは agentNotificationText のテストで固定し、ここでは表から作ることだけを見る(文言の変更を 1 か所に閉じる)
      const { title, body } = agentNotificationText('permission', 2, 'claude')
      expect(created[0].options).toEqual({ title, body })
      expect(created[0].show).toHaveBeenCalledOnce()
    })

    it('題は依頼の種類の名前で作る(copilot の依頼は copilot 2: 許可待ち。本文は同じ)', () => {
      const { center, created } = setup()
      center.show(makeWindow(), { ...request, cliKind: 'copilot' })
      expect(created[0].options).toEqual({
        title: 'copilot 2: 許可待ち',
        body: 'ツールの実行の許可を待っています'
      })
    })

    it.each([
      ['ウィンドウにフォーカスがある', { focused: true }, true],
      ['ウィンドウが破棄済み', { destroyed: true }, true],
      ['通知に対応していない', {}, false]
    ])('%s なら出さない', (_label, state, supported) => {
      const { center, created } = setup({ supported })
      center.show(makeWindow(state), request)
      expect(created).toHaveLength(0)
    })

    it('フォーカスがあるときの show は新しい通知を出さず、同じタブの前の通知を閉じる(前の通知は古い)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      window.isFocused.mockReturnValue(true)
      center.show(window, { ...request, kind: 'confirm' })
      expect(created).toHaveLength(2)
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].close).not.toHaveBeenCalled()
      // 閉じた通知は記録から外す(後始末で閉じ直さない)
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
    })

    it('通知に対応していないときの show も、同じタブの前の通知を閉じる', () => {
      const created: AgentNotificationHandle[] = []
      let supported = true
      const close = vi.fn()
      const center = createAgentNotificationCenter({
        platform: 'darwin',
        isSupported: () => supported,
        createNotification: () => {
          const handle: AgentNotificationHandle = { show: vi.fn(), close, onClick: vi.fn() }
          created.push(handle)
          return handle
        },
        setDockBadge: vi.fn()
      })
      const window = makeWindow()
      center.show(window, request)
      supported = false
      center.show(window, request)
      expect(created).toHaveLength(1)
      expect(close).toHaveBeenCalledOnce()
    })

    it('同じウィンドウ・同じタブの前の通知を閉じてから出す(タブごとに最新の 1 件)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, kind: 'done' })
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].show).toHaveBeenCalledOnce()
      expect(created[1].close).not.toHaveBeenCalled()
    })

    it('システムが前の通知の close を知らせた後でも、同じタブの次の通知で前の通知を閉じる(アクションセンターに積み上げない)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      // close() を呼ばずに close の知らせだけが届く(Windows はトーストのタイムアウトでも close を知らせる)
      created[0].emitClose()
      center.show(window, { ...request, kind: 'done' })
      expect(created[0].close).toHaveBeenCalledOnce()
    })

    it('別のタブ・別のウィンドウの通知は閉じない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      center.show(makeWindow(), request)
      expect(created[0].close).not.toHaveBeenCalled()
      expect(created[1].close).not.toHaveBeenCalled()
    })

    it('前の通知の close が投げても、新しい通知を出す(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].close.mockImplementation(() => {
        throw new Error('already closed')
      })
      expect(() => center.show(window, request)).not.toThrow()
      expect(created[1].show).toHaveBeenCalledOnce()
    })

    it.each(['win32', 'linux'] as const)(
      '%s では通知と同時にタスクバーのボタンを点滅させる',
      (platform) => {
        const { center } = setup({ platform })
        const window = makeWindow()
        center.show(window, request)
        expect(window.flashFrame).toHaveBeenCalledWith(true)
      }
    )

    it('macOS では点滅させない(Dock のバッジで知らせる)', () => {
      const { center } = setup({ platform: 'darwin' })
      const window = makeWindow()
      center.show(window, request)
      expect(window.flashFrame).not.toHaveBeenCalled()
    })
  })

  describe('通知を押したとき', () => {
    it('最小化を戻して前面にし、そのウィンドウへ activated を送る', () => {
      const { center, created } = setup()
      const window = makeWindow({ minimized: true })
      center.show(window, request)
      created[0].click()
      expect(window.restore).toHaveBeenCalledOnce()
      expect(window.show).toHaveBeenCalledOnce()
      expect(window.focus).toHaveBeenCalledOnce()
      expect(window.webContents.send).toHaveBeenCalledWith('agentNotification:activated', {
        slotId: 'slot-1'
      })
    })

    it('最小化していなければ restore しない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].click()
      expect(window.restore).not.toHaveBeenCalled()
      expect(window.focus).toHaveBeenCalledOnce()
    })

    it('ウィンドウが破棄済みなら前面にも送りもしない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      window.isDestroyed.mockReturnValue(true)
      created[0].click()
      expect(window.focus).not.toHaveBeenCalled()
      expect(window.webContents.send).not.toHaveBeenCalled()
    })

    it('前面化が投げても、例外を外へ出さずに activated を送る(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      window.focus.mockImplementation(() => {
        throw new Error('focus failed')
      })
      center.show(window, request)
      expect(() => created[0].click()).not.toThrow()
      expect(window.webContents.send).toHaveBeenCalledWith('agentNotification:activated', {
        slotId: 'slot-1'
      })
    })

    it('押した通知は記録から消え、ウィンドウの後始末で閉じ直さない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].click()
      center.clearWindow(window)
      expect(created[0].close).not.toHaveBeenCalled()
    })
  })

  describe('handleWindowFocus', () => {
    it.each(['win32', 'linux'] as const)('%s ではフォーカスで点滅を止める', (platform) => {
      const { center } = setup({ platform })
      const window = makeWindow()
      center.handleWindowFocus(window)
      expect(window.flashFrame).toHaveBeenCalledWith(false)
    })

    it('macOS では何もしない', () => {
      const { center } = setup({ platform: 'darwin' })
      const window = makeWindow()
      center.handleWindowFocus(window)
      expect(window.flashFrame).not.toHaveBeenCalled()
    })

    it('点滅を止めるのが投げても、例外を外へ出さない(L-053)', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      window.flashFrame.mockImplementation(() => {
        throw new Error('x')
      })
      expect(() => center.handleWindowFocus(window)).not.toThrow()
    })
  })

  describe('clearWindow', () => {
    it('そのウィンドウの残っている通知だけを閉じる', () => {
      const { center, created } = setup()
      const window = makeWindow()
      const other = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      center.show(other, request)
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].close).toHaveBeenCalledOnce()
      expect(created[2].close).not.toHaveBeenCalled()
    })

    it('システムが close を知らせた通知(Windows のタイムアウトでアクションセンターへ移った)も記録に残し、後始末で閉じる', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      // close() を呼ばずに close の知らせだけが届く(Windows はトーストのタイムアウトでも close を知らせる)
      created[0].emitClose()
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
    })

    it('入れ替えた後の新しい通知も閉じる(前の通知の close が届いても、新しい通知の記録を失わない)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, kind: 'done' })
      center.clearWindow(window)
      expect(created[1].close).toHaveBeenCalledOnce()
    })

    it('前の通知の close の知らせが入れ替えの後に遅れて届いても、新しい通知を閉じる', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      // close の知らせは同期で届くとは限らない(Electron の close イベントは届くことも保証されない)
      created[0].close.mockImplementation(() => undefined)
      center.show(window, { ...request, kind: 'done' })
      created[0].emitClose()
      center.clearWindow(window)
      expect(created[1].close).toHaveBeenCalledOnce()
    })

    it('後始末は記録を消す(close の知らせを待たず、閉じたウィンドウを持ち続けず、後始末を繰り返さない)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].close.mockImplementation(() => undefined)
      center.clearWindow(window)
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
    })

    it('close が投げても残りの通知を閉じる(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      created[0].close.mockImplementation(() => {
        throw new Error('x')
      })
      expect(() => center.clearWindow(window)).not.toThrow()
      expect(created[1].close).toHaveBeenCalledOnce()
    })
  })

  describe('dismiss', () => {
    it('そのウィンドウ・そのタブの通知だけを閉じる(閉じたタブの通知を残さない)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      const other = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2' })
      center.show(other, request)
      center.dismiss(window, 'slot-1')
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].close).not.toHaveBeenCalled()
      expect(created[2].close).not.toHaveBeenCalled()
    })

    it('閉じた通知は記録から外し、ウィンドウの後始末・同じ slotId の次の通知で閉じ直さない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      center.dismiss(window, 'slot-1')
      center.show(window, request)
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
      expect(created[1].close).toHaveBeenCalledOnce()
    })

    it('通知の無いタブ・押した後のタブでは何もしない', () => {
      const { center, created } = setup()
      const window = makeWindow()
      expect(() => center.dismiss(window, 'slot-1')).not.toThrow()
      center.show(window, request)
      created[0].click()
      center.dismiss(window, 'slot-1')
      expect(created[0].close).not.toHaveBeenCalled()
    })

    it('close が投げても例外を外へ出さず、記録から外す(L-053)', () => {
      const { center, created } = setup()
      const window = makeWindow()
      center.show(window, request)
      created[0].close.mockImplementation(() => {
        throw new Error('x')
      })
      expect(() => center.dismiss(window, 'slot-1')).not.toThrow()
      center.clearWindow(window)
      expect(created[0].close).toHaveBeenCalledOnce()
    })
  })

  describe('点滅の止め方(Windows・Linux)', () => {
    it.each(['win32', 'linux'] as const)(
      '%s では、dismiss でそのウィンドウの通知が無くなれば点滅を止める',
      (platform) => {
        const { center } = setup({ platform })
        const window = makeWindow()
        center.show(window, request)
        center.dismiss(window, 'slot-1')
        expect(window.flashFrame).toHaveBeenLastCalledWith(false)
      }
    )

    it('ほかのタブの通知(作業の完了も)が残っていれば、点滅を止めない', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      center.show(window, request)
      center.show(window, { ...request, slotId: 'slot-2', kind: 'done' })
      center.dismiss(window, 'slot-1')
      expect(window.flashFrame).not.toHaveBeenCalledWith(false)
    })

    it('別のウィンドウの通知は、このウィンドウの点滅の判定に入れない', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      const other = makeWindow()
      center.show(window, request)
      center.show(other, request)
      center.dismiss(window, 'slot-1')
      expect(window.flashFrame).toHaveBeenLastCalledWith(false)
      expect(other.flashFrame).not.toHaveBeenCalledWith(false)
    })

    it('フォーカスがあるときの show で前の通知を閉じ、通知が無くなれば点滅を止める', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      center.show(window, request)
      window.isFocused.mockReturnValue(true)
      center.show(window, { ...request, kind: 'confirm' })
      expect(window.flashFrame).toHaveBeenLastCalledWith(false)
    })

    it('通知の無いタブの dismiss では点滅に触れない', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      center.dismiss(window, 'slot-1')
      expect(window.flashFrame).not.toHaveBeenCalled()
    })

    it('ウィンドウの後始末で通知を閉じたら点滅も止める(破棄済みなら触れない)', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      center.show(window, request)
      center.clearWindow(window)
      expect(window.flashFrame).toHaveBeenLastCalledWith(false)

      const destroyed = makeWindow()
      center.show(destroyed, request)
      destroyed.isDestroyed.mockReturnValue(true)
      expect(() => center.clearWindow(destroyed)).not.toThrow()
      expect(destroyed.flashFrame).not.toHaveBeenCalledWith(false)
    })

    it('macOS では dismiss・後始末でも点滅に触れない', () => {
      const { center } = setup({ platform: 'darwin' })
      const window = makeWindow()
      center.show(window, request)
      center.dismiss(window, 'slot-1')
      center.show(window, request)
      center.clearWindow(window)
      expect(window.flashFrame).not.toHaveBeenCalled()
    })

    it('点滅を止めるのが投げても、例外を外へ出さない(L-053)', () => {
      const { center } = setup({ platform: 'win32' })
      const window = makeWindow()
      center.show(window, request)
      window.flashFrame.mockImplementation(() => {
        throw new Error('x')
      })
      expect(() => center.dismiss(window, 'slot-1')).not.toThrow()
    })
  })

  describe('setBadge', () => {
    it('macOS では Dock のバッジに数を出し、0 なら消す', () => {
      const { center, setDockBadge } = setup({ platform: 'darwin' })
      center.setBadge(3)
      center.setBadge(0)
      expect(setDockBadge.mock.calls).toEqual([['3'], ['']])
    })

    it.each(['win32', 'linux'] as const)('%s では何もしない', (platform) => {
      const { center, setDockBadge } = setup({ platform })
      center.setBadge(2)
      expect(setDockBadge).not.toHaveBeenCalled()
    })
  })
})
