import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve as resolvePath, relative, sep } from 'path'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockOpenFolderDialog = vi.hoisted(() => vi.fn())
const mockReadDirRecursive = vi.hoisted(() => vi.fn())
const mockReadFileContent = vi.hoisted(() => vi.fn())
const mockWriteFileContent = vi.hoisted(() => vi.fn())
const mockCreateFile = vi.hoisted(() => vi.fn())
const mockCreateDirectory = vi.hoisted(() => vi.fn())
const mockRenameEntry = vi.hoisted(() => vi.fn())
const mockDeleteEntry = vi.hoisted(() => vi.fn())
const mockAddToGitignore = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())
const mockToGitRelativePath = vi.hoisted(() => vi.fn())
const mockIsSymbolicLink = vi.hoisted(() => vi.fn())

vi.mock('../../dialogService', () => ({ openFolderDialog: mockOpenFolderDialog }))
vi.mock('../../fileSystem', () => ({
  readDirRecursive: mockReadDirRecursive,
  readFileContent: mockReadFileContent,
  writeFileContent: mockWriteFileContent,
  createFile: mockCreateFile,
  createDirectory: mockCreateDirectory,
  renameEntry: mockRenameEntry,
  deleteEntry: mockDeleteEntry,
  isSymbolicLink: mockIsSymbolicLink
}))
vi.mock('../../gitignoreService', () => ({
  addToGitignore: mockAddToGitignore
}))
vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath
}))
vi.mock('../../pathNormalize', () => ({
  toGitRelativePath: mockToGitRelativePath
}))

import { registerFileSystemHandlers } from '../../handlers/fileSystemHandlers'

const mockIpcMain = { handle: mockHandle } as never

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

function makeEexistError(path: string): NodeJS.ErrnoException {
  const err = new Error(`EEXIST: file already exists, '${path}'`) as NodeJS.ErrnoException
  err.code = 'EEXIST'
  return err
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

function makeEnoentError(path: string): NodeJS.ErrnoException {
  const err = new Error(
    `ENOENT: no such file or directory, realpath '${path}'`
  ) as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  // 既存の fs:addToGitignore テストは実際の相対パス変換と同じ結果を返すデフォルト実装で扱う。
  // 正規化そのものの変換ロジックは pathNormalize.test.ts で検証する
  mockToGitRelativePath.mockImplementation((folder: string, absolutePath: string) =>
    relative(folder, absolutePath).split(sep).join('/')
  )
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

    it('fs エラーでない Error(アクセス拒否等)はそのままスローする', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockWriteFileContent.mockRejectedValue(new Error('Access denied: /project/index.ts'))
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'x')
      ).rejects.toThrow('Access denied: /project/index.ts')
    })

    it('EACCES 等の他の fs エラーは汎用の日本語メッセージに変換される', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockWriteFileContent.mockRejectedValue(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      )
      await expect(
        getRegisteredHandler('fs:writeFile')(makeEvent(1), '/project/index.ts', 'x')
      ).rejects.toThrow('ファイル操作に失敗しました(EACCES): /project/index.ts')
    })
  })

  describe('fs:createFile', () => {
    function setup(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertParentWithinFolder: vi.fn().mockResolvedValue('/project/src'),
        ...overrides
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      return folderAccess
    }

    it('親ディレクトリ検証後、解決済みの親 + name で createFile を呼ぶ', async () => {
      const folderAccess = setup()
      await getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/src', 'new.ts')
      expect(folderAccess.assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project/src')
      expect(mockCreateFile).toHaveBeenCalledWith('/project/src/new.ts')
    })

    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      setup({ get: vi.fn().mockReturnValue(undefined) })
      await expect(
        getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/src', 'new.ts')
      ).rejects.toThrow('No folder open')
      expect(mockCreateFile).not.toHaveBeenCalled()
    })

    it('親ディレクトリ検証が失敗したとき createFile を呼ばない(トラバーサル拒否)', async () => {
      setup({
        assertParentWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /etc'))
      })
      await expect(
        getRegisteredHandler('fs:createFile')(makeEvent(1), '/etc', 'evil')
      ).rejects.toThrow('Access denied')
      expect(mockCreateFile).not.toHaveBeenCalled()
    })

    it.each(['', '   ', '.', '..', 'a/b', 'a\\b', ' spaced '])(
      '無効な名前 %j は拒否され createFile を呼ばない',
      async (name) => {
        setup()
        await expect(
          getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/src', name)
        ).rejects.toThrow('無効な名前です')
        expect(mockCreateFile).not.toHaveBeenCalled()
      }
    )

    it('name が文字列でないとき拒否する', async () => {
      setup()
      await expect(
        getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/src', 123)
      ).rejects.toThrow('名前は文字列である必要があります')
    })

    it('..foo のようなドット始まりの名前は許可される', async () => {
      setup()
      await getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/src', '..foo')
      expect(mockCreateFile).toHaveBeenCalledWith('/project/src/..foo')
    })

    it('EEXIST は「既に存在します」に変換される', async () => {
      setup()
      mockCreateFile.mockRejectedValue(makeEexistError('/project/src/new.ts'))
      await expect(
        getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/src', 'new.ts')
      ).rejects.toThrow('既に存在します: new.ts')
    })

    it('親不存在の ENOENT は「対象が見つかりません」に変換される', async () => {
      setup({
        assertParentWithinFolder: vi.fn().mockRejectedValue(makeEnoentError('/project/gone'))
      })
      await expect(
        getRegisteredHandler('fs:createFile')(makeEvent(1), '/project/gone', 'new.ts')
      ).rejects.toThrow('対象が見つかりません: /project/gone')
    })
  })

  describe('fs:createDirectory', () => {
    it('親ディレクトリ検証後、解決済みの親 + name で createDirectory を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertParentWithinFolder: vi.fn().mockResolvedValue('/project')
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await getRegisteredHandler('fs:createDirectory')(makeEvent(1), '/project', 'newdir')
      expect(mockCreateDirectory).toHaveBeenCalledWith('/project/newdir')
    })

    it('EEXIST は「既に存在します」に変換される', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertParentWithinFolder: vi.fn().mockResolvedValue('/project')
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockCreateDirectory.mockRejectedValue(makeEexistError('/project/newdir'))
      await expect(
        getRegisteredHandler('fs:createDirectory')(makeEvent(1), '/project', 'newdir')
      ).rejects.toThrow('既に存在します: newdir')
    })

    it('無効な名前は拒否され createDirectory を呼ばない', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertParentWithinFolder: vi.fn().mockResolvedValue('/project')
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:createDirectory')(makeEvent(1), '/project', '../evil')
      ).rejects.toThrow('無効な名前です')
      expect(mockCreateDirectory).not.toHaveBeenCalled()
    })
  })

  describe('fs:renameEntry', () => {
    function setup(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined),
        ...overrides
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      return folderAccess
    }

    it('対象パス検証後、同一ディレクトリ内の新パスで renameEntry を呼ぶ', async () => {
      const folderAccess = setup()
      await getRegisteredHandler('fs:renameEntry')(makeEvent(1), '/project/src/old.ts', 'new.ts')
      expect(folderAccess.assertWithinFolder).toHaveBeenCalledWith(
        '/project',
        '/project/src/old.ts'
      )
      expect(mockRenameEntry).toHaveBeenCalledWith('/project/src/old.ts', '/project/src/new.ts')
    })

    it('ルートフォルダ外のパスは拒否され renameEntry を呼ばない', async () => {
      setup({
        assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /etc/passwd'))
      })
      await expect(
        getRegisteredHandler('fs:renameEntry')(makeEvent(1), '/etc/passwd', 'new')
      ).rejects.toThrow('Access denied')
      expect(mockRenameEntry).not.toHaveBeenCalled()
    })

    it('無効な新名称は拒否され renameEntry を呼ばない', async () => {
      setup()
      await expect(
        getRegisteredHandler('fs:renameEntry')(makeEvent(1), '/project/src/old.ts', 'a/b')
      ).rejects.toThrow('無効な名前です')
      expect(mockRenameEntry).not.toHaveBeenCalled()
    })

    it('EEXIST は「既に存在します」に変換される', async () => {
      setup()
      mockRenameEntry.mockRejectedValue(makeEexistError('/project/src/new.ts'))
      await expect(
        getRegisteredHandler('fs:renameEntry')(makeEvent(1), '/project/src/old.ts', 'new.ts')
      ).rejects.toThrow('既に存在します: new.ts')
    })

    it('ENOENT は「対象が見つかりません」に変換される', async () => {
      setup({
        assertWithinFolder: vi.fn().mockRejectedValue(makeEnoentError('/project/src/gone.ts'))
      })
      await expect(
        getRegisteredHandler('fs:renameEntry')(makeEvent(1), '/project/src/gone.ts', 'new.ts')
      ).rejects.toThrow('対象が見つかりません: /project/src/gone.ts')
    })
  })

  describe('fs:deleteEntry', () => {
    function setup(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined),
        ...overrides
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      return folderAccess
    }

    it('対象パス検証後に deleteEntry を呼ぶ', async () => {
      const folderAccess = setup()
      await getRegisteredHandler('fs:deleteEntry')(makeEvent(1), '/project/src/old.ts')
      expect(folderAccess.assertWithinFolder).toHaveBeenCalledWith(
        '/project',
        '/project/src/old.ts'
      )
      expect(mockDeleteEntry).toHaveBeenCalledWith('/project/src/old.ts')
    })

    it('ルートフォルダ外のパスは拒否され deleteEntry を呼ばない', async () => {
      setup({
        assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /etc/passwd'))
      })
      await expect(
        getRegisteredHandler('fs:deleteEntry')(makeEvent(1), '/etc/passwd')
      ).rejects.toThrow('Access denied')
      expect(mockDeleteEntry).not.toHaveBeenCalled()
    })

    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      setup({ get: vi.fn().mockReturnValue(undefined) })
      await expect(
        getRegisteredHandler('fs:deleteEntry')(makeEvent(1), '/project/src/old.ts')
      ).rejects.toThrow('No folder open')
    })

    it('ENOENT は「対象が見つかりません」に変換される', async () => {
      setup({
        assertWithinFolder: vi.fn().mockRejectedValue(makeEnoentError('/project/gone'))
      })
      await expect(
        getRegisteredHandler('fs:deleteEntry')(makeEvent(1), '/project/gone')
      ).rejects.toThrow('対象が見つかりません: /project/gone')
    })

    it('EBUSY 等の他の fs エラーは汎用の日本語メッセージに変換される', async () => {
      setup({ assertWithinFolder: vi.fn().mockResolvedValue(undefined) })
      mockDeleteEntry.mockRejectedValue(
        Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
      )
      await expect(
        getRegisteredHandler('fs:deleteEntry')(makeEvent(1), '/project/src/locked.ts')
      ).rejects.toThrow('ファイル操作に失敗しました(EBUSY): /project/src/locked.ts')
    })

    it('fs エラーでない Error(アクセス拒否等)はそのままスローする', async () => {
      setup({
        assertWithinFolder: vi.fn().mockRejectedValue(new Error('Access denied: /outside'))
      })
      await expect(
        getRegisteredHandler('fs:deleteEntry')(makeEvent(1), '/outside')
      ).rejects.toThrow('Access denied: /outside')
    })
  })

  describe('fs:addToGitignore', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      ).rejects.toThrow('No folder open')
    })

    it('.gitignore がシンボリックリンクの場合、リンク先を辿らず書き込みを拒否する', async () => {
      // realpath ベースの境界チェックには穴がある: リンク先がまだ存在しない
      // 「壊れたシンボリックリンク」だと realpath が ENOENT を返し、
      // assertFileWithinFolder の ENOENT フォールバックが親(= allowedFolder 自身)の
      // 検証だけで通してしまう。その後 writeFileContent は symlink を辿って
      // サンドボックス外にファイルを新規作成する(実機で再現確認済み)。
      // lstat ベースで symlink 自体を弾く必要がある
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined),
        assertParentWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockIsSymbolicLink.mockResolvedValue(true)
      mockAddToGitignore.mockResolvedValue(undefined)

      await expect(
        getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      ).rejects.toThrow()
      expect(mockAddToGitignore).not.toHaveBeenCalled()
    })

    it('.gitignore がまだ存在しない場合は書き込みを許可する(新規作成の経路を塞がない)', async () => {
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined),
        assertParentWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      // lstat は対象が存在しなければ ENOENT を投げる
      mockIsSymbolicLink.mockRejectedValue(makeEnoentError('/project/.gitignore'))
      mockAddToGitignore.mockResolvedValue(undefined)

      await getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      expect(mockAddToGitignore).toHaveBeenCalledWith('/project', 'dist')
    })

    it('.gitignore の祖先がディレクトリではなくファイルに置き換わっていた場合(ENOTDIR)も、書き込みを許可する', async () => {
      // git checkout 等で .gitignore の祖先ディレクトリが同名ファイルに
      // 置き換わっていた場合、lstat は ENOENT ではなく ENOTDIR を投げる。
      // isGitignoreSymlink が ENOENT だけを「対象なし」として扱っていると、
      // このケースで未変換の ENOTDIR がそのまま fs:addToGitignore 全体を
      // 失敗させてしまう(このファイル内の他のフォールバック
      // (assertFileWithinFolder/resolveCanonicalPath)は ENOTDIR も同じ
      // 「対象なし」として扱っているのと一貫性が無い)
      const enotdir = Object.assign(new Error('ENOTDIR: not a directory'), {
        code: 'ENOTDIR'
      })
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder: vi.fn().mockResolvedValue(undefined),
        assertParentWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      // 後続のテストに影響しないよう、この1回限りの動作として設定する
      // (mockIsSymbolicLink は各テストが個別に mockResolvedValue/mockRejectedValue で
      // 上書きする前提で、vi.clearAllMocks() は実装まではクリアしないため)
      mockIsSymbolicLink.mockRejectedValueOnce(enotdir)
      mockAddToGitignore.mockResolvedValue(undefined)

      await getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      expect(mockAddToGitignore).toHaveBeenCalledWith('/project', 'dist')
    })

    it('書き込み先の .gitignore 自体も境界チェックする(サンドボックス外へのシンボリックリンク対策)', async () => {
      // .gitignore は readFileContent/writeFileContent で素に読み書きしており、
      // これらはシンボリックリンクを辿る。悪意あるリポジトリで .gitignore が
      // ~/.zshrc 等へのリンクだと、「.gitignore に追加」でサンドボックス外の
      // ファイルが書き換えられてしまう。他の fs ハンドラは全て realpath ベースの
      // 境界チェックを通しているのに、ここだけ通っていなかった
      const assertWithinFolder = vi.fn().mockImplementation(async (_folder, path) => {
        if (path === '/project/.gitignore') throw new Error('Access denied: /project/.gitignore')
      })
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder: vi.fn().mockResolvedValue(undefined)
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockAddToGitignore.mockResolvedValue(undefined)

      await expect(
        getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      ).rejects.toThrow('Access denied')
      expect(mockAddToGitignore).not.toHaveBeenCalled()
    })

    it('assertWithinFolder で境界チェックし、フォルダルートからの相対パスで addToGitignore を呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockAddToGitignore.mockResolvedValue(undefined)
      await getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/dist')
      expect(mockAddToGitignore).toHaveBeenCalledWith('/project', 'dist')
    })

    it('folderPath と絶対パスを toGitRelativePath に通してから addToGitignore に渡す（Windows のバックスラッシュ区切りを正規化するため）', async () => {
      // path.relative は Windows では \ 区切りの文字列を返すが、.gitignore のパターンは
      // / 区切りでなければ無効になる。toGitRelativePath による正規化を経由することを
      // 統合的に検証する。正規化関数自体の変換ロジックは pathNormalize.test.ts で単体テストする
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockAddToGitignore.mockResolvedValue(undefined)
      mockToGitRelativePath.mockReturnValue('NORMALIZED_PATH')

      await getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/sub/dir/generated')

      expect(mockToGitRelativePath).toHaveBeenCalledWith('/project', '/project/sub/dir/generated')
      expect(mockAddToGitignore).toHaveBeenCalledWith('/project', 'NORMALIZED_PATH')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから addToGitignore を呼ぶ', async () => {
      // エクスプローラーのツリーが未更新のまま、ディスク上では既に削除された
      // ファイルに対して「.gitignore に追加」した場合を想定する。git:stage 等の
      // 他ハンドラと同じフォールバックが無いと、素の ENOENT がそのまま伝播してしまう
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockAddToGitignore.mockResolvedValue(undefined)
      mockToGitRelativePath.mockReturnValue('deleted.txt')

      await getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/deleted.txt')

      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockAddToGitignore).toHaveBeenCalledWith('/project', 'deleted.txt')
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、汎用の日本語メッセージに変換して伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
        )
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/locked.txt')
      ).rejects.toThrow('ファイル操作に失敗しました(EACCES): /project/locked.txt')
      expect(mockAddToGitignore).not.toHaveBeenCalled()
    })

    it('addToGitignore(.gitignore への書き込み)が失敗した場合、対象ファイルではなく .gitignore を指すメッセージに変換する', async () => {
      // 境界チェック(targetPath)と .gitignore への書き込みは別の操作であり、
      // 後者が失敗した原因は対象ファイル(例: dist)ではなく .gitignore 自体
      // (書き込み権限やディスクフル等)にある。同じ targetPath に紐づけた
      // メッセージにすると、無関係なファイルが問題であるかのように誤認させる
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockToGitRelativePath.mockReturnValue('dist')
      mockAddToGitignore.mockRejectedValue(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      )

      await expect(
        getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      ).rejects.toThrow('ファイル操作に失敗しました(EACCES): /project/.gitignore')
    })

    it('isSymbolicLink(.gitignore)が ENOENT/ENOTDIR 以外のエラーで失敗した場合、エラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerFileSystemHandlers(mockIpcMain, folderAccess)
      mockToGitRelativePath.mockReturnValue('dist')
      mockIsSymbolicLink.mockRejectedValue(
        Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      )

      await expect(
        getRegisteredHandler('fs:addToGitignore')(makeEvent(1), '/project/dist')
      ).rejects.toThrow('ファイル操作に失敗しました(EACCES): /project/.gitignore')
    })
  })
})
