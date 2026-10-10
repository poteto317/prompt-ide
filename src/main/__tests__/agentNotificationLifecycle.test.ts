import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { setupAgentNotificationLifecycle } from '../agentNotificationLifecycle'

function setup(): {
  center: { handleWindowFocus: Mock; clearWindow: Mock; setBadge: Mock }
  window: EventEmitter
  webContents: EventEmitter
} {
  const app = new EventEmitter()
  const center = { handleWindowFocus: vi.fn(), clearWindow: vi.fn(), setBadge: vi.fn() }
  setupAgentNotificationLifecycle(app as unknown as App, center)
  const webContents = new EventEmitter()
  const window = Object.assign(new EventEmitter(), { webContents })
  app.emit('browser-window-created', {}, window)
  return { center, window, webContents }
}

describe('setupAgentNotificationLifecycle', () => {
  it('ウィンドウがフォーカスを得たら点滅を止める', () => {
    const { center, window } = setup()
    window.emit('focus')
    expect(center.handleWindowFocus).toHaveBeenCalledWith(window)
  })

  it('ウィンドウが閉じたら残っている通知を閉じ、バッジを 0 に戻す(1 ウィンドウの前提)', () => {
    const { center, window } = setup()
    window.emit('closed')
    expect(center.clearWindow).toHaveBeenCalledWith(window)
    expect(center.setBadge).toHaveBeenCalledWith(0)
  })

  it('リロード(メインフレームの文書の入れ替わり)で残っている通知を閉じる', () => {
    const { center, window, webContents } = setup()
    webContents.emit('did-navigate')
    expect(center.clearWindow).toHaveBeenCalledWith(window)
    expect(center.setBadge).not.toHaveBeenCalled()
  })

  it('読み込みに失敗してエラーの画面に入れ替わったときも閉じる。ERR_ABORTED(-3)では閉じない', () => {
    const { center, webContents } = setup()
    webContents.emit('did-fail-load', {}, -3, '', 'file:///x', true)
    expect(center.clearWindow).not.toHaveBeenCalled()
    webContents.emit('did-fail-load', {}, -6, '', 'file:///x', true)
    expect(center.clearWindow).toHaveBeenCalledOnce()
  })

  it('will-navigate で止めた遷移(did-start-navigation だけが届く)では閉じない', () => {
    const { center, webContents } = setup()
    webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(center.clearWindow).not.toHaveBeenCalled()
  })
})
