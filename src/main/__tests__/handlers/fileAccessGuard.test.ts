import { describe, it, expect, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { FolderAccessManager } from '../../folderAccessManager'
import { getAllowedFolder, assertFileAccess } from '../../handlers/fileAccessGuard'

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

describe('assertFileAccess', () => {
  it('getAllowedFolder の結果を assertWithinFolder に渡す', async () => {
    const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
    const folderAccess = makeFolderAccess({
      get: vi.fn().mockReturnValue('/project'),
      assertWithinFolder
    })
    await assertFileAccess(folderAccess, makeEvent(1), '/project/index.ts')
    expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/index.ts')
  })

  it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
    const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
    await expect(
      assertFileAccess(folderAccess, makeEvent(1), '/project/index.ts')
    ).rejects.toThrow('No folder open')
  })

  it('assertWithinFolder が拒否したときエラーが伝播する', async () => {
    const folderAccess = makeFolderAccess({
      get: vi.fn().mockReturnValue('/project'),
      assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /etc/passwd'))
    })
    await expect(assertFileAccess(folderAccess, makeEvent(1), '/etc/passwd')).rejects.toThrow(
      'Access denied'
    )
  })
})
