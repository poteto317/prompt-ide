import type { WebContents } from 'electron'
import type { AgentNotificationShowRequest } from '@shared/types'
import { agentNotificationText } from '@shared/agentNotificationText'
import { sendSafely } from './safeWebContentsSend'

// エージェントの完了・許可待ちの OS の通知(設計書「main」)。ウィンドウ・タブごとに最新の 1 件だけを保持し(記録から外す
// 契機は設計書「main」の Notification インスタンスの保持を参照。それまで参照を持ち、GC で click が失われないように)、押したらウィンドウを前面にして renderer へ知らせる。Windows・Linux は通知と
// 同時にタスクバーのボタンを点滅させ(フォーカスを得るか、そのウィンドウの通知が無くなるまで)、macOS は Dock のバッジで待っているタブの数を出す。Electron の実物は ipcHandlers.ts で注入する

/** OS の通知 1 件(Electron の Notification を包んだもの) */
export interface AgentNotificationHandle {
  show(): void
  close(): void
  onClick(listener: () => void): void
  // close の知らせは購読しない。Windows はトーストのタイムアウトでも close を知らせるが、通知はアクションセンターに残り、
  // その後の close() で消せる。知らせで記録を外すと、同じタブの前の通知・ウィンドウの後始末で閉じられなくなる
}

/** 通知を出すウィンドウ(BrowserWindow の使う部分) */
export interface AgentNotificationWindow {
  isDestroyed(): boolean
  isFocused(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
  flashFrame(flag: boolean): void
  readonly webContents: Pick<WebContents, 'isDestroyed' | 'send'>
}

export interface AgentNotificationCenterDeps {
  platform: NodeJS.Platform
  /** Notification.isSupported() */
  isSupported: () => boolean
  createNotification: (options: { title: string; body: string }) => AgentNotificationHandle
  /** app.dock.setBadge(macOS だけ呼ぶ) */
  setDockBadge: (text: string) => void
}

export interface AgentNotificationCenter {
  /**
   * ウィンドウにフォーカスが無ければ通知を出す。同じウィンドウ・同じタブの前の通知は、新しい通知を出さないとき(前面・
   * 通知に対応していない)も閉じる。閉じてそのウィンドウの通知が無くなれば点滅を止める
   */
  show(window: AgentNotificationWindow, request: AgentNotificationShowRequest): void
  /**
   * そのウィンドウ・そのタブの残っている通知を閉じて記録から外す(送る契機は設計書「main」を参照。前面・通知に対応して
   * いないときは show が閉じる)。番号が使い回されても同じ題の通知を並べない。そのウィンドウの通知が無くなれば点滅を止める
   */
  dismiss(window: AgentNotificationWindow, slotId: string): void
  /** 待っているタブの数(macOS の Dock のバッジ。ほかの OS では何もしない) */
  setBadge(count: number): void
  /** ウィンドウがフォーカスを得た(点滅を止める) */
  handleWindowFocus(window: AgentNotificationWindow): void
  /** ウィンドウが閉じた・リロードした(残っている通知を閉じる。押されても届く先が無いため。点滅も止める) */
  clearWindow(window: AgentNotificationWindow): void
}

/** 閉じる途中の例外で後続(新しい通知・残りの通知の後始末)を止めない(L-053) */
const closeQuietly = (handle: AgentNotificationHandle): void => {
  try {
    handle.close()
  } catch {
    // 既に閉じた通知などは捨てる
  }
}

export function createAgentNotificationCenter({
  platform,
  isSupported,
  createNotification,
  setDockBadge
}: AgentNotificationCenterDeps): AgentNotificationCenter {
  const flashes = platform !== 'darwin'
  const byWindow = new Map<AgentNotificationWindow, Map<string, AgentNotificationHandle>>()

  /** 記録がその通知のままなら消す(押された通知が、入れ替わった後の新しい通知の記録を消さないように) */
  const forget = (
    window: AgentNotificationWindow,
    slotId: string,
    handle: AgentNotificationHandle
  ): void => {
    const slots = byWindow.get(window)
    if (slots === undefined || slots.get(slotId) !== handle) return
    slots.delete(slotId)
    if (slots.size === 0) byWindow.delete(window)
  }

  /** 点滅を止める(Windows・Linux だけ。破棄済みのウィンドウには触れない。投げても後続を止めない。L-053) */
  const stopFlashing = (window: AgentNotificationWindow): void => {
    if (!flashes || window.isDestroyed()) return
    try {
      window.flashFrame(false)
    } catch {
      // 点滅を止められなくても、通知の後始末は続ける
    }
  }

  /**
   * 同じウィンドウ・同じタブの前の通知を記録から外して閉じる。閉じた通知があれば true。新しい通知は後から remember で入れる
   */
  const dismissPrevious = (window: AgentNotificationWindow, slotId: string): boolean => {
    const previous = byWindow.get(window)?.get(slotId)
    if (previous === undefined) return false
    forget(window, slotId, previous)
    closeQuietly(previous)
    return true
  }

  /**
   * 前の通知を閉じ、そのウィンドウに残っている通知(作業の完了も含む)が無くなったら点滅を止める。点滅は「待っている・
   * 終わったタブがある」知らせ(Windows・Linux でのバッジの代わり)なので、背面のまま通知が無くなったら残さない
   */
  const dismissAndSettleFlash = (window: AgentNotificationWindow, slotId: string): void => {
    if (!dismissPrevious(window, slotId)) return
    if (!byWindow.has(window)) stopFlashing(window)
  }

  /**
   * 記録から外す契機(設計書「main」を参照)まで通知を持つ。
   * close の知らせでは外さないので、件数はウィンドウごとに「通知が出たことのある開いているタブの数」までで、clearWindow で消える
   */
  const remember = (
    window: AgentNotificationWindow,
    slotId: string,
    handle: AgentNotificationHandle
  ): void => {
    const slots = byWindow.get(window) ?? new Map<string, AgentNotificationHandle>()
    byWindow.set(window, slots)
    slots.set(slotId, handle)
  }

  const activate = (window: AgentNotificationWindow, slotId: string): void => {
    if (window.isDestroyed()) return
    try {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    } catch {
      // 前面化できなくても、タブへ移る知らせは送る(通知の click の listener から投げると main の未処理例外になる。L-053)
    }
    sendSafely(window.webContents, 'agentNotification:activated', { slotId })
  }

  return {
    show(window, { slotId, tabNumber, kind, cliKind }) {
      if (window.isDestroyed()) return
      // 新しい出来事が起きた時点で、同じタブの前の通知は古い。前面のとき・通知に対応していないときも、前の通知は閉じる
      if (window.isFocused() || !isSupported()) {
        dismissAndSettleFlash(window, slotId)
        return
      }
      // 題・本文は固定の表から作る(renderer の文字列を通知に出さない。L-019)
      const { title, body } = agentNotificationText(kind, tabNumber, cliKind)
      dismissPrevious(window, slotId)
      const handle = createNotification({ title, body })
      remember(window, slotId, handle)
      handle.onClick(() => {
        forget(window, slotId, handle)
        activate(window, slotId)
      })
      handle.show()
      if (flashes) window.flashFrame(true)
    },
    dismiss(window, slotId) {
      dismissAndSettleFlash(window, slotId)
    },
    setBadge(count) {
      if (platform !== 'darwin') return
      setDockBadge(count > 0 ? String(count) : '')
    },
    handleWindowFocus(window) {
      stopFlashing(window)
    },
    clearWindow(window) {
      const slots = byWindow.get(window)
      byWindow.delete(window)
      if (slots === undefined) return
      for (const handle of slots.values()) closeQuietly(handle)
      // 通知が無くなったので、dismiss と同じく点滅も止める(閉じたウィンドウは破棄済みなので触れない)
      stopFlashing(window)
    }
  }
}
