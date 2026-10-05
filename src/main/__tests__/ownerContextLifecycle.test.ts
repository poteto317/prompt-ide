import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { App } from 'electron'
import { FolderAccessManager } from '../folderAccessManager'
import { onOwnerContextEnded } from '../ownerContextLifecycle'
import type { OwnerContextEnd } from '../ownerContextLifecycle'

function setup(): {
  app: EventEmitter
  ended: ReturnType<typeof vi.fn<(end: OwnerContextEnd) => void>>
  folderAccess: FolderAccessManager
} {
  const app = new EventEmitter()
  const ended = vi.fn<(end: OwnerContextEnd) => void>()
  const folderAccess = new FolderAccessManager()
  onOwnerContextEnded(app as unknown as App, folderAccess, ended)
  return { app, ended, folderAccess }
}

function createWebContents(app: EventEmitter, id = 3): EventEmitter & { id: number } {
  const webContents = Object.assign(new EventEmitter(), { id })
  app.emit('web-contents-created', {}, webContents)
  return webContents
}

describe('onOwnerContextEnded', () => {
  it('ウィンドウの破棄(destroyed)で 1 回呼ぶ', () => {
    const { app, ended } = setup()
    const webContents = createWebContents(app)
    webContents.emit('destroyed')
    expect(ended.mock.calls).toEqual([[{ ownerId: 3, cause: 'destroyed', webContents }]])
  })

  it('renderer のプロセスの終了(render-process-gone)で 1 回呼ぶ', () => {
    const { app, ended } = setup()
    const webContents = createWebContents(app)
    webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(ended.mock.calls).toEqual([[{ ownerId: 3, cause: 'crashed', webContents }]])
  })

  it.each<[string, (webContents: EventEmitter) => void]>([
    ['did-navigate', (webContents) => webContents.emit('did-navigate', {}, 'app://index.html')],
    [
      'メインフレームの did-fail-load(ERR_ABORTED 以外)',
      (webContents) =>
        webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://index.html', true)
    ]
  ])('メインフレームの文書の入れ替わり(%s)で reloaded として 1 回呼ぶ', (_label, emit) => {
    const { app, ended } = setup()
    const webContents = createWebContents(app)
    emit(webContents)
    expect(ended.mock.calls).toEqual([[{ ownerId: 3, cause: 'reloaded', webContents }]])
  })

  it.each<[string, (webContents: EventEmitter) => void]>([
    [
      'ERR_ABORTED',
      (webContents) =>
        webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'app://index.html', true)
    ],
    [
      'サブフレームの失敗',
      (webContents) =>
        webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'app://f.html', false)
    ],
    [
      'did-start-navigation だけ',
      (webContents) =>
        webContents.emit('did-start-navigation', {
          url: 'file:///dropped.txt',
          isMainFrame: true,
          isSameDocument: false,
          frame: null
        })
    ]
  ])('文書が残る遷移(%s)では呼ばない', (_label, emit) => {
    const { app, ended } = setup()
    emit(createWebContents(app))
    expect(ended).not.toHaveBeenCalled()
  })

  it('フォルダの切り替えで folder-changed として 1 回呼ぶ(webContents は渡さない)', () => {
    const { ended, folderAccess } = setup()
    folderAccess.set(5, '/a')
    expect(ended.mock.calls).toEqual([[{ ownerId: 5, cause: 'folder-changed' }]])
  })

  it('破棄の後も作成時に控えた id を使う(破棄済みの webContents の id は例外になる)', () => {
    const { app, ended } = setup()
    let destroyed = false
    const webContents = new EventEmitter()
    Object.defineProperty(webContents, 'id', {
      get: () => {
        if (destroyed) throw new Error('Object has been destroyed')
        return 7
      }
    })
    app.emit('web-contents-created', {}, webContents)
    destroyed = true
    expect(() => webContents.emit('destroyed')).not.toThrow()
    expect(() => webContents.emit('render-process-gone', {}, {})).not.toThrow()
    expect(ended.mock.calls.map(([end]) => [end.ownerId, end.cause])).toEqual([
      [7, 'destroyed'],
      [7, 'crashed']
    ])
  })
})
