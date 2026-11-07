import { describe, it, expect, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { FolderAccessManager } from '../../folderAccessManager'
import { getAllowedFolder, assertFileWithinFolder } from '../../handlers/fileAccessGuard'
import { assertFileWithinFolder as assertFileWithinFolderInMain } from '../../fileWithinFolder'

function makeFolderAccess(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn(),
    ...overrides
  } as unknown as FolderAccessManager
}

function makeEvent(senderId: number): IpcMainInvokeEvent {
  return { sender: { id: senderId } } as IpcMainInvokeEvent
}

describe('getAllowedFolder', () => {
  it('folderAccess.get の結果を返す', () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
    expect(getAllowedFolder(folderAccess, makeEvent(1))).toBe('/project')
  })

  it('folderAccess.get を event.sender.id で呼ぶ', () => {
    const get = vi.fn().mockReturnValue('/project')
    const folderAccess = makeFolderAccess({ get })
    getAllowedFolder(folderAccess, makeEvent(42))
    expect(get).toHaveBeenCalledWith(42)
  })

  it('未設定のとき "No folder open" エラーをスロー', () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    expect(() => getAllowedFolder(folderAccess, makeEvent(1))).toThrow('No folder open')
  })
})

describe('assertFileWithinFolder', () => {
  it('main 直下の fileWithinFolder の関数をそのまま再エクスポートする', () => {
    expect(assertFileWithinFolder).toBe(assertFileWithinFolderInMain)
  })
})
