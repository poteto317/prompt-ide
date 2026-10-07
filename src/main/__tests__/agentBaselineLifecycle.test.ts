import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { setupAgentBaselineLifecycle } from '../agentBaselineLifecycle'

function setup(): {
  app: EventEmitter
  clear: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  const clear = vi.fn(async () => undefined)
  const close = vi.fn()
  const folderAccess = new FolderAccessManager()
  setupAgentBaselineLifecycle(app as unknown as App, { clear, close }, folderAccess)
  return { app, clear, close, folderAccess }
}

const createWebContents = (app: EventEmitter, id: number): EventEmitter => {
  const webContents = Object.assign(new EventEmitter(), { id })
  app.emit('web-contents-created', {}, webContents)
  return webContents
}

describe('setupAgentBaselineLifecycle', () => {
  it.each<[string, (webContents: EventEmitter) => void]>([
    ['ウィンドウの破棄', (w) => w.emit('destroyed')],
    ['renderer のプロセスの終了', (w) => w.emit('render-process-gone')],
    ['リロード(文書の入れ替わり)', (w) => w.emit('did-navigate', {}, 'app://index.html', 200, 'OK')]
  ])('%s でその所有者の記録を捨てる', (_label, trigger) => {
    const { app, clear } = setup()
    const webContents = createWebContents(app, 7)
    createWebContents(app, 8)
    trigger(webContents)
    expect(clear).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('フォルダが別のパスに変わったら捨て、同じパスなら捨てない', () => {
    const { clear, folderAccess } = setup()
    folderAccess.set(1, '/a')
    clear.mockClear()
    folderAccess.set(1, '/a')
    expect(clear).not.toHaveBeenCalled()
    folderAccess.set(1, '/b')
    expect(clear).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('捨てる失敗は未処理の拒否にしない', async () => {
    const { app, clear } = setup()
    clear.mockRejectedValueOnce(new Error('rm failed'))
    const webContents = createWebContents(app, 7)
    expect(() => webContents.emit('destroyed')).not.toThrow()
    await Promise.resolve()
  })

  it('アプリの終了(before-quit)で registry を閉じ、終了は止めない', () => {
    const { app, close } = setup()
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    expect(close).toHaveBeenCalledOnce()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
