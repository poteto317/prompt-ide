import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { OpenFileWatcher } from '../openFileWatcher'
import { setupOpenFileWatcherLifecycle } from '../openFileWatcherLifecycle'

function setup(): {
  app: EventEmitter
  clear: ReturnType<typeof vi.spyOn>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  const watcher = new OpenFileWatcher({ watch: vi.fn(), notify: vi.fn() })
  const clear = vi.spyOn(watcher, 'clear')
  const folderAccess = new FolderAccessManager()
  setupOpenFileWatcherLifecycle(app as unknown as App, watcher, folderAccess)
  return { app, clear, folderAccess }
}

describe('setupOpenFileWatcherLifecycle', () => {
  it('ウィンドウの破棄で監視を閉じる', () => {
    const { app, clear } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    webContents.emit('destroyed')
    expect(clear).toHaveBeenCalledWith(3)
  })

  it('破棄の通知の中で id を読まない(破棄済みの webContents の id は例外になる)', () => {
    const { app, clear } = setup()
    let destroyed = false
    const webContents = new EventEmitter()
    Object.defineProperty(webContents, 'id', {
      get: () => {
        if (destroyed) throw new Error('Object has been destroyed')
        return 3
      }
    })
    app.emit('web-contents-created', {}, webContents)
    destroyed = true
    expect(() => webContents.emit('destroyed')).not.toThrow()
    expect(clear).toHaveBeenCalledWith(3)
  })

  // Electron 39 で確かめた順: did-start-navigation は will-navigate より先に届き、will-navigate で止めた遷移(ファイルの
  // ドロップなど)でも届く。文書が実際に入れ替わったとき(did-navigate、ERR_ABORTED 以外の did-fail-load)だけ閉じる
  it.each<[string, (webContents: EventEmitter) => void, boolean]>([
    [
      'will-navigate で止めた遷移(did-start-navigation だけが届く)では閉じない',
      (webContents) =>
        webContents.emit('did-start-navigation', {
          url: 'file:///Users/me/dropped.txt',
          isMainFrame: true,
          isSameDocument: false,
          frame: null
        }),
      false
    ],
    [
      'リロード・許可した遷移の確定(did-navigate)で閉じる',
      (webContents) => webContents.emit('did-navigate', {}, 'app://index.html', 200, 'OK'),
      true
    ],
    [
      'メインフレームの読み込みの失敗(エラーの画面に入れ替わる)で閉じる',
      (webContents) =>
        webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://index.html', true),
      true
    ],
    [
      'メインフレームの遷移の取り消し(ERR_ABORTED)では閉じない',
      (webContents) =>
        webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'app://index.html', true),
      false
    ],
    [
      'サブフレームの読み込みの失敗では閉じない',
      (webContents) =>
        webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://f.html', false),
      false
    ],
    [
      '同じ文書内の遷移では閉じない',
      (webContents) => webContents.emit('did-navigate-in-page', {}, 'app://index.html#x', true),
      false
    ]
  ])('%s', (_label, navigate, cleared) => {
    const { app, clear } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    navigate(webContents)
    expect(clear.mock.calls).toEqual(cleared ? [[3]] : [])
  })

  it('renderer のプロセスが落ちたら監視を閉じる', () => {
    const { app, clear } = setup()
    const webContents = Object.assign(new EventEmitter(), { id: 3 })
    app.emit('web-contents-created', {}, webContents)
    webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(clear).toHaveBeenCalledWith(3)
  })

  it('フォルダの切り替えで閉じる', () => {
    const { clear, folderAccess } = setup()
    folderAccess.set(3, '/a')
    expect(clear).toHaveBeenCalledWith(3)
  })
})
