import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetGitStatus = vi.hoisted(() => vi.fn())
const mockStageFile = vi.hoisted(() => vi.fn())
const mockUnstageFile = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockGetDiff = vi.hoisted(() => vi.fn())
const mockStageHunk = vi.hoisted(() => vi.fn())
const mockUnstageHunk = vi.hoisted(() => vi.fn())
const mockGetLog = vi.hoisted(() => vi.fn())
const mockGetBranches = vi.hoisted(() => vi.fn())
const mockGetTags = vi.hoisted(() => vi.fn())
const mockAmendCommit = vi.hoisted(() => vi.fn())

vi.mock('../../gitService', () => ({
  getGitStatus: mockGetGitStatus,
  stageFile: mockStageFile,
  unstageFile: mockUnstageFile,
  commit: mockCommit,
  getDiff: mockGetDiff,
  stageHunk: mockStageHunk,
  unstageHunk: mockUnstageHunk,
  getLog: mockGetLog,
  getBranches: mockGetBranches,
  getTags: mockGetTags,
  amendCommit: mockAmendCommit,
}))

import { registerGitHandlers } from '../../handlers/gitHandlers'

const mockIpcMain = { handle: mockHandle } as never

function makeFolderAccess(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn(),
    ...overrides,
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerGitHandlers', () => {
  describe('git:getStatus', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getStatus')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder を引数に getGitStatus を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      const mockResult = { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] }
      mockGetGitStatus.mockResolvedValue(mockResult)
      const result = await getRegisteredHandler('git:getStatus')(makeEvent(1))
      expect(mockGetGitStatus).toHaveBeenCalledWith('/project')
      expect(result).toEqual(mockResult)
    })

    it('getGitStatus が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetGitStatus.mockRejectedValue(new Error('git error'))
      await expect(getRegisteredHandler('git:getStatus')(makeEvent(1))).rejects.toThrow('git error')
    })
  })

  describe('git:stage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、stageFile を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    })

    it('assertWithinFolder が throw した場合、stageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockStageFile).not.toHaveBeenCalled()
    })

    it('相対パスの filePath を allowedFolder 基準の絶対パスに解決してから assertWithinFolder と stageFile を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから stageFile を呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT',
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), 'deleted.ts')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockStageFile).toHaveBeenCalledWith('/project', '/project/deleted.ts')
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、assertParentWithinFolder にフォールバックせずエラーを伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
      const assertParentWithinFolder = vi.fn()
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '../outside/deleted.ts')
      ).rejects.toThrow('Access denied')
      expect(assertParentWithinFolder).not.toHaveBeenCalled()
      expect(mockStageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:unstage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、unstageFile を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    })

    it('assertWithinFolder が throw した場合、unstageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })

    it('相対パスの filePath を allowedFolder 基準の絶対パスに解決してから assertWithinFolder と unstageFile を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', '/project/src/index.ts')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから unstageFile を呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT',
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'deleted.ts')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', '/project/deleted.ts')
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、assertParentWithinFolder にフォールバックせずエラーを伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
      const assertParentWithinFolder = vi.fn()
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '../outside/deleted.ts')
      ).rejects.toThrow('Access denied')
      expect(assertParentWithinFolder).not.toHaveBeenCalled()
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:commit', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と message を引数に commit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:commit')(makeEvent(1), 'feat: 新機能')
      expect(mockCommit).toHaveBeenCalledWith('/project', 'feat: 新機能')
    })

    it('commit が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockRejectedValue(new Error('commit failed'))
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'commit failed'
      )
    })
  })

  describe('git:getDiff', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:getDiff')(makeEvent(1), 'src/index.ts', false)
      ).rejects.toThrow('No folder open')
    })

    it('境界チェックは解決済みの絶対パスで行うが、getDiff には相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      const result = await getRegisteredHandler('git:getDiff')(makeEvent(1), 'src/index.ts', true)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'src/index.ts', true)
      expect(result).toBe('DIFF_TEXT')
    })

    it('絶対パスの filePath が渡っても、getDiff には allowedFolder 基準の相対パスで呼ぶ', async () => {
      // simple-git の status().files[].path はリポジトリルートからの相対パスのため、
      // getDiff 内の未追跡ファイル判定と一致させる必要がある。絶対パスのまま渡すと
      // 判定が常に不一致になり、未追跡ファイルの疑似diffが生成されない
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/project/src/index.ts', false)
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'src/index.ts', false)
    })

    it('ネストした相対パスも allowedFolder 基準の相対パスのまま getDiff に渡る', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'sub/dir/file.ts', true)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/sub/dir/file.ts')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'sub/dir/file.ts', true)
    })
  })

  describe('git:stageHunk', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      ).rejects.toThrow('No folder open')
    })

    it('境界チェック後、stageHunk を解決済みパスと patch 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageHunk).toHaveBeenCalledWith('/project', '/project/src/index.ts', 'PATCH')
    })
  })

  describe('git:unstageHunk', () => {
    it('境界チェック後、unstageHunk を解決済みパスと patch 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageHunk).toHaveBeenCalledWith('/project', '/project/src/index.ts', 'PATCH')
    })
  })

  describe('git:getLog', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と limit/skip を引数に getLog を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetLog.mockResolvedValue([])
      await getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)
      expect(mockGetLog).toHaveBeenCalledWith('/project', 20, 0)
    })
  })

  describe('git:getBranches', () => {
    it('folderAccess の allowedFolder を引数に getBranches を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetBranches.mockResolvedValue([])
      await getRegisteredHandler('git:getBranches')(makeEvent(1))
      expect(mockGetBranches).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:getTags', () => {
    it('folderAccess の allowedFolder を引数に getTags を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetTags.mockResolvedValue([])
      await getRegisteredHandler('git:getTags')(makeEvent(1))
      expect(mockGetTags).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:amendCommit', () => {
    it('folderAccess の allowedFolder と message を引数に amendCommit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockAmendCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:amendCommit')(makeEvent(1), 'feat: 修正後')
      expect(mockAmendCommit).toHaveBeenCalledWith('/project', 'feat: 修正後')
    })
  })
})
