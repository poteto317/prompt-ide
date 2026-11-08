import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { setupFolderChangeWatcherLifecycle } from '../folderChangeWatcherLifecycle'

function setup(): {
  app: EventEmitter
  disable: ReturnType<typeof vi.fn>
  onFolderChanged: ReturnType<typeof vi.fn>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  // 寿命が使うのは onFolderChanged と disable だけ(Pick で受ける)
  const disable = vi.fn()
  const onFolderChanged = vi.fn()
  const folderAccess = new FolderAccessManager()
  setupFolderChangeWatcherLifecycle(
    app as unknown as App,
    { disable, onFolderChanged },
    folderAccess
  )
  return { app, disable, onFolderChanged, folderAccess }
}

describe('setupFolderChangeWatcherLifecycle', () => {
  it('フォルダの切り替え → onFolderChanged で張り直す(無効にしない)', () => {
    const { disable, onFolderChanged, folderAccess } = setup()
    folderAccess.set(3, '/a')
    expect(onFolderChanged).toHaveBeenCalledExactlyOnceWith(3)
    expect(disable).not.toHaveBeenCalled()
  })

  it.each<[string, (webContents: EventEmitter) => void]>([
    ['ウィンドウの破棄', (webContents) => webContents.emit('destroyed')],
    [
      'renderer のプロセスの終了',
      (webContents) =>
        webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    ],
    [
      'リロード(did-navigate)',
      (webContents) => webContents.emit('did-navigate', {}, 'app://index.html', 200, 'OK')
    ]
  ])('%s → disable で無効にする(張り直さない)', (_label, end) => {
    const { app, disable, onFolderChanged } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    end(webContents)
    expect(disable).toHaveBeenCalledExactlyOnceWith(3)
    expect(onFolderChanged).not.toHaveBeenCalled()
  })
})
