import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath } from 'path'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockOpenFolderDialog = vi.hoisted(() => vi.fn())
const mockReadDirRecursive = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())
const mockWriteFileContent = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('../../dialogService', () => ({ openFolderDialog: mockOpenFolderDialog }))
vi.mock('../../fileSystem', () => ({
  readDirRecursive: mockReadDirRecursive,
  readFileContent: mockReadFileContent,
  writeFileContent: mockWriteFileContent
}))
vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath
}))

import { registerFileSystemHandlers } from '../../handlers/fileSystemHandlers'

const mockIpcMain = { handle: mockHandle } as never

function makeFolderAccess(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    ...overrides
  } as unknown as FolderAccessManager
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number) {
  return { sender: { id: senderId } }
}

function makeEnoentError(path: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, realpath '${path}'`) as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
})

describe('registerFileSystemHandlers', () => {
  describe('dialog:openFolder', () => {
    it('openFolderDialog に委譲して結果を返す', async () => {
      const folderAccess = makeFolderAccess()
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockOpenFolderDialog.mockResolvedValue('/project')
      const result = await getRegisteredHandler('dialog:openFolder')(makeEvent(1))
      expect(mockOpenFolderDialog).toHaveBeenCalledOnce()
      expect(result).toBe('/project')
    })

    it('結果が null のとき folderAccess.set を呼ばない', async () => {
      const folderAccess = makeFolderAccess()
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockOpenFolderDialog.mockResolvedValue(null)
      const result = await getRegisteredHandler('dialog:openFolder')(makeEvent(1))
      expect(result).toBeNull()
      expect(folderAccess.set).not.toHaveBeenCalled()
    })

    it('結果が非 null のとき realpath 解決後に folderAccess.set を呼ぶ', async () => {
      const folderAccess = makeFolderAccess()
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockOpenFolderDialog.mockResolvedValue('/project')
      await getRegisteredHandler('dialog:openFolder')(makeEvent(1))
      expect(folderAccess.set).toHaveBeenCalledWith(1, '/project')
    })
  })

  describe('fs:readDirectory', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      const handler = getRegisteredHandler('fs:readDirectory')
      await expect(handler(makeEvent(1), '/project')).rejects.toThrow('No folder open')
    })

    it('allowedFolder と同じ realpath のとき readDirRecursive を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockReadDirRecursive.mockResolvedValue([])
      const handler = getRegisteredHandler('fs:readDirectory')
      await handler(makeEvent(1), '/project')
      expect(mockReadDirRecursive).toHaveBeenCalledWith('/project')
    })

    it('allowedFolder と異なるパスは "Access denied" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      const handler = getRegisteredHandler('fs:readDirectory')
      await expect(handler(makeEvent(1), '/other')).rejects.toThrow('Access denied')
      expect(mockReadDirRecursive).not.toHaveBeenCalled()
    })
  })

  describe('fs:readFile', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:readFile')(makeEvent(1), '/project/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('folderAccess.assertWithinFolder に委譲する', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockReadFileContent.mockResolvedValue('content')
      await getRegisteredHandler('fs:readFile')(makeEvent(1), '/project/index.ts')
      expect(folderAccess.assertWithinFolder).toHaveBeenCalledWith('/project', '/project/index.ts')
    })

    it('assertWithinFolder が通った後に readFileContent を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockReadFileContent.mockResolvedValue('const x = 1')
      const result = await getRegisteredHandler('fs:readFile')(makeEvent(1), '/project/index.ts')
      expect(result).toBe('const x = 1')
    })

    it('assertWithinFolder がエラーをスローしたとき readFileContent を呼ばない', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /etc/passwd'))
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:readFile')(makeEvent(1), '/etc/passwd')
      ).rejects.toThrow('Access denied')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('選択したファイルが外部で削除され assertWithinFolder が ENOENT をスローしたとき、分かりやすいメッセージに変換する', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockRejectedValue(makeEnoentError('/project/index.ts'))
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:readFile')(makeEvent(1), '/project/index.ts')
      ).rejects.toThrow('ファイルが見つかりません: /project/index.ts')
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })
  })

  describe('fs:writeFile', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'new content')
      ).rejects.toThrow('No folder open')
    })

    it('folderAccess.assertWithinFolder に委譲する', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'new content')
      expect(folderAccess.assertWithinFolder).toHaveBeenCalledWith('/project', '/project/index.ts')
    })

    it('assertWithinFolder が通った後に writeFileContent を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'new content')
      expect(mockWriteFileContent).toHaveBeenCalledWith('/project/index.ts', 'new content')
    })

    it('assertWithinFolder がエラーをスローしたとき writeFileContent を呼ばない', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /etc/passwd'))
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/etc/passwd', 'x')
      ).rejects.toThrow('Access denied')
      expect(mockWriteFileContent).not.toHaveBeenCalled()
    })

    it('保存対象ファイルが外部で削除され assertWithinFolder が ENOENT をスローしたとき、分かりやすいメッセージに変換する', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockRejectedValue(makeEnoentError('/project/index.ts'))
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'x')
      ).rejects.toThrow('ファイルが見つかりません: /project/index.ts')
      expect(mockWriteFileContent).not.toHaveBeenCalled()
    })

    it('writeFileContent 自体が ENOENT をスローしたときも分かりやすいメッセージに変換する', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockWriteFileContent.mockRejectedValue(makeEnoentError('/project/index.ts'))
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'x')
      ).rejects.toThrow('ファイルが見つかりません: /project/index.ts')
    })

    it('ENOENT 以外のエラーはそのままスローする', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'x')
      ).rejects.toThrow('EACCES')
    })
  })
})
