import { describe, it, expect, vi } from 'vitest'
import { setupFolderAccessLifecycle } from '../folderAccessLifecycle'
import type { FolderAccessManager } from '../folderAccessManager'

function makeApp() {
  return { on: vi.fn() } as unknown as Electron.App
}

function makeFolderAccess() {
  return { delete: vi.fn() } as unknown as FolderAccessManager
}

describe('setupFolderAccessLifecycle', () => {
  it('app に "web-contents-created" リスナーを登録する', () => {
    const app = makeApp()
    const folderAccess = makeFolderAccess()
    setupFolderAccessLifecycle(app, folderAccess)
    expect(app.on).toHaveBeenCalledWith('web-contents-created', expect.any(Function))
  })

  it('webContents が destroyed されると folderAccess.delete が呼ばれる', () => {
    const app = makeApp()
    const folderAccess = makeFolderAccess()
    setupFolderAccessLifecycle(app, folderAccess)

    const webContentsCreatedCb = (app.on as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]: [string]) => event === 'web-contents-created'
    )![1]

    let destroyedCb: (() => void) | undefined
    const mockWebContents = {
      id: 42,
      on: (_event: string, cb: () => void) => {
        if (_event === 'destroyed') destroyedCb = cb
      }
    }
    webContentsCreatedCb(null, mockWebContents)

    expect(destroyedCb).toBeDefined()
    destroyedCb!()
    expect(folderAccess.delete).toHaveBeenCalledWith(42)
  })

  it('複数の webContents がそれぞれ独立して管理される', () => {
    const app = makeApp()
    const folderAccess = makeFolderAccess()
    setupFolderAccessLifecycle(app, folderAccess)

    const webContentsCreatedCb = (app.on as ReturnType<typeof vi.fn>).mock.calls[0][1]

    const destroyedCbs: (() => void)[] = []
    for (const id of [1, 2, 3]) {
      const mockWebContents = {
        id,
        on: (_event: string, cb: () => void) => {
          if (_event === 'destroyed') destroyedCbs.push(cb)
        }
      }
      webContentsCreatedCb(null, mockWebContents)
    }

    destroyedCbs[1]()
    expect(folderAccess.delete).toHaveBeenCalledWith(2)
    expect(folderAccess.delete).toHaveBeenCalledTimes(1)
  })

  it('destroyed リスナーが呼ばれなければ delete は呼ばれない', () => {
    const app = makeApp()
    const folderAccess = makeFolderAccess()
    setupFolderAccessLifecycle(app, folderAccess)

    const webContentsCreatedCb = (app.on as ReturnType<typeof vi.fn>).mock.calls[0][1]
    const mockWebContents = { id: 10, on: vi.fn() }
    webContentsCreatedCb(null, mockWebContents)

    expect(folderAccess.delete).not.toHaveBeenCalled()
  })
})
