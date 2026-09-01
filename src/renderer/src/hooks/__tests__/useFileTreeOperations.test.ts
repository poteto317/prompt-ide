import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode, OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileTreeOperations } from '../useFileTreeOperations'
import type { FileOperationLockOptions, ResetForFileChangeOptions } from '../useFileEditing'

const mockReadDirectory = vi.mocked(fileSystemApi.readDirectory)
const mockCreateFile = vi.mocked(fileSystemApi.createFile)
const mockCreateDirectory = vi.mocked(fileSystemApi.createDirectory)
const mockRenameEntry = vi.mocked(fileSystemApi.renameEntry)
const mockDeleteEntry = vi.mocked(fileSystemApi.deleteEntry)

const mockTree: FileTreeNode[] = [{ name: 'index.ts', path: '/project/src/index.ts', type: 'file' }]

const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
const dirNode: FileTreeNode = { name: 'src', path: '/project/src', type: 'directory', children: [] }

function makeOpenFile(path: string, name: string): OpenFile {
  return { path, name, content: 'content', savedContent: 'content', language: 'typescript' }
}

function renderOperations(config?: {
  folderPath?: string | null
  initialOpenFiles?: OpenFile[]
  initialActiveFilePath?: string | null
  onConfirm?: (message: string) => boolean
  resetForFileChange?: (options?: ResetForFileChangeOptions) => void
  lockPathForFileOperation?: (
    targetPath: string,
    options?: FileOperationLockOptions
  ) => Promise<() => void>
  invalidatePendingReads?: (affectedPath: string) => void
  beginTreeWrite?: () => (() => boolean) | null
}) {
  const resetForFileChange = config?.resetForFileChange ?? vi.fn()
  const lockPathForFileOperation = config?.lockPathForFileOperation ?? (async () => () => {})
  const invalidatePendingReads = config?.invalidatePendingReads ?? vi.fn()
  const onConfirm = config?.onConfirm ?? vi.fn<(message: string) => boolean>().mockReturnValue(true)
  // null を明示的に渡すケースを undefined(デフォルト値を使う)と区別する
  const folderPath = config && 'folderPath' in config ? (config.folderPath ?? null) : '/project'
  const treeWriteGuard = makeTreeWriteGuard()
  const { result } = renderHook(() => {
    const [openFiles, setOpenFiles] = useState<OpenFile[]>(config?.initialOpenFiles ?? [])
    const activeFilePath = config?.initialActiveFilePath ?? openFiles[0]?.path ?? null
    const ops = useFileTreeOperations({
      getFolderPath: () => folderPath,
      getOpenFiles: () => openFiles,
      setOpenFiles,
      getActiveFilePath: () => activeFilePath,
      resetForFileChange,
      onConfirm,
      invalidatePendingReads,
      beginTreeWrite: config?.beginTreeWrite ?? treeWriteGuard,
      lockPathForFileOperation,
      reportTreeLoad: vi.fn()
    })
    return { ...ops, openFiles }
  })
  return { result, resetForFileChange, onConfirm, invalidatePendingReads, lockPathForFileOperation }
}

function renderOperationsWithFolder(getFolderPath: () => string | null) {
  const { result } = renderHook(() =>
    useFileTreeOperations({
      getFolderPath,
      getOpenFiles: () => [],
      setOpenFiles: () => {},
      getActiveFilePath: () => null,
      resetForFileChange: vi.fn(),
      onConfirm: () => true,
      invalidatePendingReads: vi.fn(),
      beginTreeWrite: makeTreeWriteGuard(),
      lockPathForFileOperation: async () => () => {},
      reportTreeLoad: vi.fn()
    })
  )
  return { result }
}

// 実装側(useFileSystem)と同じ順序ガードをテスト用に用意する
function makeTreeWriteGuard(): () => (() => boolean) | null {
  let seq = 0
  return () => {
    const mine = ++seq
    return () => mine === seq
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useFileTreeOperations', () => {
  it('初期状態で fileTree は空配列、error は null', () => {
    const { result } = renderOperations()
    expect(result.current.fileTree).toEqual([])
    expect(result.current.error).toBeNull()
  })

  describe('createFile', () => {
    it('API を呼んだあとルートからツリーを再読込する', async () => {
      mockCreateFile.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations()

      await act(async () => {
        await result.current.createFile('/project', 'new.ts')
      })

      expect(mockCreateFile).toHaveBeenCalledWith('/project', 'new.ts')
      expect(mockReadDirectory).toHaveBeenCalledWith('/project')
      expect(result.current.fileTree).toEqual(mockTree)
    })

    it('失敗したとき error にセットされツリー再読込しない', async () => {
      mockCreateFile.mockRejectedValue(new Error('既に存在します: new.ts'))
      const { result } = renderOperations()

      await act(async () => {
        await result.current.createFile('/project', 'new.ts')
      })

      expect(result.current.error?.message).toBe('既に存在します: new.ts')
      expect(mockReadDirectory).not.toHaveBeenCalled()
    })

    it('folderPath が null のときツリー再読込をスキップする(readDirectory を呼ばない)', async () => {
      mockCreateFile.mockResolvedValue(undefined)
      const { result } = renderOperations({ folderPath: null })

      await act(async () => {
        await result.current.createFile('/project', 'new.ts')
      })

      expect(mockReadDirectory).not.toHaveBeenCalled()
      expect(result.current.error).toBeNull()
    })
  })

  describe('createDirectory', () => {
    it('API を呼んだあとツリーを再読込する', async () => {
      mockCreateDirectory.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations()

      await act(async () => {
        await result.current.createDirectory('/project/src', 'newdir')
      })

      expect(mockCreateDirectory).toHaveBeenCalledWith('/project/src', 'newdir')
      expect(mockReadDirectory).toHaveBeenCalledWith('/project')
    })
  })

  describe('renameEntry', () => {
    it('開いていないファイルのリネームでは openFile を変更せず resetForFileChange も呼ばない', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)],
        resetForFileChange
      })

      const otherNode: FileTreeNode = {
        name: 'other.ts',
        path: '/project/src/other.ts',
        type: 'file'
      }
      await act(async () => {
        await result.current.renameEntry(otherNode, 'renamed.ts')
      })

      expect(mockRenameEntry).toHaveBeenCalledWith('/project/src/other.ts', 'renamed.ts')
      expect(result.current.openFiles[0]?.path).toBe(fileNode.path)
      expect(resetForFileChange).not.toHaveBeenCalled()
    })

    it('開いているファイル自体のリネームで path/name/language が追随する', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)]
      })

      await act(async () => {
        await result.current.renameEntry(fileNode, 'index.md')
      })

      expect(result.current.openFiles[0]?.path).toBe('/project/src/index.md')
      expect(result.current.openFiles[0]?.name).toBe('index.md')
      expect(result.current.openFiles[0]?.language).toBe('markdown')
    })

    it('開いているファイル自体のリネームで resetForFileChange が呼ばれる(保存状態の世代を更新する)', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)],
        resetForFileChange
      })

      await act(async () => {
        await result.current.renameEntry(fileNode, 'index.md')
      })

      expect(resetForFileChange).toHaveBeenCalledOnce()
    })

    it('開いているファイルの祖先ディレクトリのリネームでパスのプレフィックスが付け替わる', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)]
      })

      await act(async () => {
        await result.current.renameEntry(dirNode, 'lib')
      })

      expect(mockRenameEntry).toHaveBeenCalledWith('/project/src', 'lib')
      expect(result.current.openFiles[0]?.path).toBe('/project/lib/index.ts')
    })

    it('開いているファイルの祖先ディレクトリのリネームでも resetForFileChange が呼ばれる', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)],
        resetForFileChange
      })

      await act(async () => {
        await result.current.renameEntry(dirNode, 'lib')
      })

      expect(resetForFileChange).toHaveBeenCalledOnce()
    })

    it('openFiles が空のとき何もしない(例外にならない)', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations({ initialOpenFiles: [] })

      await act(async () => {
        await result.current.renameEntry(fileNode, 'renamed.ts')
      })

      expect(result.current.openFiles).toEqual([])
    })
  })

  describe('deleteEntry', () => {
    it('確認ダイアログでキャンセルすると API を呼ばない', async () => {
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderOperations({ onConfirm })

      await act(async () => {
        await result.current.deleteEntry(fileNode)
      })

      expect(onConfirm).toHaveBeenCalledWith('「index.ts」を削除しますか？')
      expect(mockDeleteEntry).not.toHaveBeenCalled()
    })

    it('ディレクトリの確認メッセージには中身も削除される旨を含む', async () => {
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderOperations({ onConfirm })

      await act(async () => {
        await result.current.deleteEntry(dirNode)
      })

      expect(onConfirm).toHaveBeenCalledWith('「src」を削除しますか？中身もすべて削除されます。')
    })

    it('確認 OK で API を呼びツリーを再読込する', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const { result } = renderOperations()

      await act(async () => {
        await result.current.deleteEntry(fileNode)
      })

      expect(mockDeleteEntry).toHaveBeenCalledWith('/project/src/index.ts')
      expect(mockReadDirectory).toHaveBeenCalledWith('/project')
    })

    it('開いているファイル自体を削除すると openFiles が閉じられ resetForFileChange が呼ばれる', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)],
        resetForFileChange
      })

      await act(async () => {
        await result.current.deleteEntry(fileNode)
      })

      expect(result.current.openFiles).toEqual([])
      expect(resetForFileChange).toHaveBeenCalledOnce()
    })

    it('開いているファイルの祖先ディレクトリを削除すると openFiles が閉じられる', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)]
      })

      await act(async () => {
        await result.current.deleteEntry(dirNode)
      })

      expect(result.current.openFiles).toEqual([])
    })

    it('無関係なファイルの削除では openFiles を閉じない', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const { result } = renderOperations({
        initialOpenFiles: [makeOpenFile(fileNode.path, fileNode.name)]
      })

      const otherNode: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }
      await act(async () => {
        await result.current.deleteEntry(otherNode)
      })

      expect(result.current.openFiles[0]?.path).toBe(fileNode.path)
    })

    it('失敗したとき error にセットされる', async () => {
      mockDeleteEntry.mockRejectedValue(new Error('Access denied: /project/src/index.ts'))
      const { result } = renderOperations()

      await act(async () => {
        await result.current.deleteEntry(fileNode)
      })

      expect(result.current.error?.message).toBe('Access denied: /project/src/index.ts')
    })
  })
})

describe('保留中の読み込みの無効化', () => {
  it('deleteEntry で invalidatePendingReads を呼ぶ', async () => {
    // 削除対象を読み込み中だと、あとから解決して削除済みファイルを表示してしまう
    const invalidatePendingReads = vi.fn()
    // clearAllMocks は実装(mockRejectedValue 等)を消さないため、明示的に成功させる
    mockDeleteEntry.mockResolvedValue(undefined)
    const { result } = renderOperations({ invalidatePendingReads })
    await act(async () => {
      await result.current.deleteEntry({
        name: 'a.ts',
        path: '/project/a.ts',
        type: 'file'
      })
    })
    expect(invalidatePendingReads).toHaveBeenCalledWith('/project/a.ts')
  })

  it('renameEntry で invalidatePendingReads を呼ぶ', async () => {
    const invalidatePendingReads = vi.fn()
    mockRenameEntry.mockResolvedValue(undefined)
    const { result } = renderOperations({ invalidatePendingReads })
    await act(async () => {
      await result.current.renameEntry(
        { name: 'a.ts', path: '/project/a.ts', type: 'file' },
        'b.ts'
      )
    })
    expect(invalidatePendingReads).toHaveBeenCalled()
  })
})

describe('ツリー再読込のフォルダ判定', () => {
  it('読み込み中にフォルダが切り替わったらツリーを反映しない', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    let current: string | null = '/project'
    mockReadDirectory.mockImplementation(() => {
      // 読み込みの解決前にフォルダが切り替わった状況を再現する
      current = '/other'
      return Promise.resolve([{ name: 'stale.ts', path: '/project/stale.ts', type: 'file' }])
    })
    const { result } = renderOperationsWithFolder(() => current)
    await act(async () => {
      await result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })
    expect(result.current.fileTree).toEqual([])
  })

  it('読み込み中の失敗も、フォルダが切り替わっていればエラーにしない', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    let current: string | null = '/project'
    mockReadDirectory.mockImplementation(() => {
      current = '/other'
      return Promise.reject(new Error('Access denied: /project'))
    })
    const { result } = renderOperationsWithFolder(() => current)
    await act(async () => {
      await result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })
    expect(result.current.error).toBeNull()
  })

  it('先に始まった再読込が後発の結果を上書きしない', async () => {
    // 同一フォルダで CRUD が重なると解決順が入れ替わり得る
    mockDeleteEntry.mockResolvedValue(undefined)
    mockCreateFile.mockResolvedValue(undefined)
    const firstTree = [{ name: 'first.ts', path: '/project/first.ts', type: 'file' as const }]
    const secondTree = [{ name: 'second.ts', path: '/project/second.ts', type: 'file' as const }]
    let resolveFirst: (tree: FileTreeNode[]) => void = () => {}
    let call = 0
    mockReadDirectory.mockImplementation(() => {
      call += 1
      if (call === 1) {
        return new Promise<FileTreeNode[]>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve(secondTree)
    })

    const { result } = renderOperations()
    let firstOp: Promise<void> = Promise.resolve()
    act(() => {
      firstOp = result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })
    // 削除の FS 操作を進め、1 回目の再読込が保留になった状態にする
    await act(async () => {})
    // 2 番目の操作が先に完了してツリーを更新する
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    expect(result.current.fileTree).toEqual(secondTree)

    // 先に始まった再読込が遅れて解決しても、後発の結果を壊さない
    await act(async () => {
      resolveFirst(firstTree)
    })
    await act(async () => {})
    expect(result.current.fileTree).toEqual(secondTree)
    await firstOp
  })

  it('フォルダが同じなら再読込したツリーを反映する', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    const tree = [{ name: 'fresh.ts', path: '/project/fresh.ts', type: 'file' as const }]
    mockReadDirectory.mockResolvedValue(tree)
    const { result } = renderOperations()
    await act(async () => {
      await result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })
    expect(result.current.fileTree).toEqual(tree)
  })
})

describe('保存ロックの張り方', () => {
  it('作成では、作られるパスだけを無効にする', async () => {
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.createFile('/project', 'a.ts')
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ invalidatesPaths: ['/project/a.ts'] })
    )
  })

  it('ディレクトリの作成では、作られるパス自体だけを無効にする', async () => {
    // 配下（sub/file.ts 等）の保存は、フォルダを作り直しても何かを潰すわけではない
    // ので待つだけでよい。ただし削除してバッファだけ残したファイルと同じ名前の
    // ディレクトリを作ると、待って書き込む扱いでは EISDIR で失敗するため、
    // 作られるパス自体は createFile と同じく無効にする必要がある
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.createDirectory('/project', 'sub')
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({
        invalidatesPaths: ['/project/sub'],
        abortMessage: expect.stringContaining('ディレクトリ')
      })
    )
  })

  it('リネームでは、移行先だけ別の文言で中止を伝える', async () => {
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.renameEntry(
        { name: 'a.ts', path: '/project/a.ts', type: 'file' },
        'b.ts'
      )
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project/',
      expect.objectContaining({
        invalidatesPaths: [
          { path: '/project/a.ts' },
          { path: '/project/b.ts', abortMessage: expect.stringContaining('リネーム') }
        ]
      })
    )
  })

  it('リネーム先の名前が不正なら、移行先を無効化しない', async () => {
    // '' や 'sub/x.ts' だと、親ディレクトリ自身や別の階層を指してしまう
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.renameEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' }, '')
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project/',
      expect.objectContaining({ invalidatesPaths: [{ path: '/project/a.ts' }] })
    )
  })

  it('作成の名前が空なら、親ディレクトリ配下を巻き込まない', async () => {
    // joinPath('/project', '') は '/project/' になり、その配下すべてが対象になる
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.createFile('/project', '')
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project',
      expect.objectContaining({ invalidatesPaths: null })
    )
  })

  it('リネームの追随では、中止の通知を残すよう伝える', async () => {
    const resetForFileChange = vi.fn()
    const { result } = renderOperations({
      resetForFileChange,
      initialOpenFiles: [
        {
          path: '/project/a.ts',
          name: 'a.ts',
          content: '',
          savedContent: '',
          language: 'typescript'
        }
      ]
    })

    await act(async () => {
      await result.current.renameEntry(
        { name: 'a.ts', path: '/project/a.ts', type: 'file' },
        'b.ts'
      )
    })

    expect(resetForFileChange).toHaveBeenCalledWith({
      renamed: { from: '/project/a.ts', to: '/project/b.ts' }
    })
  })
})

describe('削除中の保存中止メッセージ', () => {
  it('ファイル削除の中止では、フォルダの作り直しを案内しない', async () => {
    // ファイル自身が消えただけで親フォルダは残っているため、再保存すれば
    // ファイルは作り直される。「フォルダを作り直してから」は誤った案内になる
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })

    const [, options] = lockPathForFileOperation.mock.calls[0]
    expect(options?.abortMessage).toContain('削除')
    expect(options?.abortMessage).not.toContain('フォルダ')
  })

  it('ディレクトリ削除の中止では、フォルダの作り直しを案内する', async () => {
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.deleteEntry({ name: 'sub', path: '/project/sub', type: 'directory' })
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project/sub',
      expect.objectContaining({ abortMessage: expect.stringContaining('フォルダ') })
    )
  })

  it('リネーム先がファイルの場合、中止の文言は「ファイル」と伝える', async () => {
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.renameEntry(
        { name: 'a.ts', path: '/project/a.ts', type: 'file' },
        'b.ts'
      )
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project/',
      expect.objectContaining({
        invalidatesPaths: [
          { path: '/project/a.ts' },
          { path: '/project/b.ts', abortMessage: expect.stringContaining('ファイル') }
        ]
      })
    )
  })

  it('リネーム先がディレクトリの場合、中止の文言は「ディレクトリ」と伝える', async () => {
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(() => {})
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.renameEntry(
        { name: 'sub', path: '/project/sub', type: 'directory' },
        'sub2'
      )
    })

    expect(lockPathForFileOperation).toHaveBeenCalledWith(
      '/project/',
      expect.objectContaining({
        invalidatesPaths: [
          { path: '/project/sub' },
          { path: '/project/sub2', abortMessage: expect.stringContaining('ディレクトリ') }
        ]
      })
    )
  })
})

describe('release の呼び出しに succeeded を渡す', () => {
  it('createFile が成功したら succeeded: true で release する', async () => {
    const release = vi.fn()
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(release)
    mockCreateFile.mockResolvedValue(undefined)
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.createFile('/project', 'new.ts')
    })

    expect(release).toHaveBeenCalledWith({ succeeded: true })
  })

  it('createFile が失敗したら succeeded: false で release する', async () => {
    // これが呼ばれないと、中止の文言（作成されたファイルを上書きします）が
    // 実際には何も作られていないのに取り下げられず残ってしまう
    const release = vi.fn()
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(release)
    mockCreateFile.mockRejectedValue(new Error('EEXIST'))
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.createFile('/project', 'new.ts')
    })

    expect(release).toHaveBeenCalledWith({ succeeded: false })
  })

  it('renameEntry が成功したら succeeded: true で release する', async () => {
    const release = vi.fn()
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(release)
    mockRenameEntry.mockResolvedValue(undefined)
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.renameEntry(
        { name: 'a.ts', path: '/project/a.ts', type: 'file' },
        'b.ts'
      )
    })

    expect(release).toHaveBeenCalledWith({ succeeded: true })
  })

  it('renameEntry が失敗したら succeeded: false で release する', async () => {
    const release = vi.fn()
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(release)
    mockRenameEntry.mockRejectedValue(new Error('EEXIST'))
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.renameEntry(
        { name: 'a.ts', path: '/project/a.ts', type: 'file' },
        'b.ts'
      )
    })

    expect(release).toHaveBeenCalledWith({ succeeded: false })
  })

  it('deleteEntry が成功したら succeeded: true で release する', async () => {
    const release = vi.fn()
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(release)
    mockDeleteEntry.mockResolvedValue(undefined)
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })

    expect(release).toHaveBeenCalledWith({ succeeded: true })
  })

  it('ロック取得後に IPC 自体が失敗したら succeeded: false で release する', async () => {
    // ロック取得より前の確認（削除しますか）で断ると、そもそもロックを
    // 取らないので release は呼ばれない。ロックを取った後に失敗するのは、
    // fileSystemApi.deleteEntry が例外を投げる経路
    const release = vi.fn()
    const lockPathForFileOperation = vi
      .fn<(targetPath: string, options?: FileOperationLockOptions) => Promise<() => void>>()
      .mockResolvedValue(release)
    mockDeleteEntry.mockRejectedValue(new Error('EACCES'))
    const { result } = renderOperations({ lockPathForFileOperation })

    await act(async () => {
      await result.current.deleteEntry({ name: 'a.ts', path: '/project/a.ts', type: 'file' })
    })

    expect(release).toHaveBeenCalledWith({ succeeded: false })
  })
})

describe('複数ファイルへの追随', () => {
  it('祖先ディレクトリの削除で、配下にある開いている複数ファイルがすべて閉じる', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const fileB = makeOpenFile('/project/src/b.ts', 'b.ts')
    const { result } = renderOperations({
      initialOpenFiles: [fileA, fileB],
      initialActiveFilePath: fileA.path
    })

    await act(async () => {
      await result.current.deleteEntry(dirNode)
    })

    expect(result.current.openFiles).toEqual([])
  })

  it('祖先ディレクトリの削除で、配下の非アクティブファイルが dirty なら確認する', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const dirtyFileB = { ...makeOpenFile('/project/src/b.ts', 'b.ts'), content: '編集済み' }
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderOperations({
      initialOpenFiles: [fileA, dirtyFileB],
      initialActiveFilePath: fileA.path,
      onConfirm
    })

    await act(async () => {
      await result.current.deleteEntry(dirNode)
    })

    expect(onConfirm).toHaveBeenCalled()
    expect(result.current.openFiles).toEqual([])
  })

  it('祖先ディレクトリのリネームで、配下にある複数の開いているファイルの path がすべて付け替わる', async () => {
    mockRenameEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const fileB = makeOpenFile('/project/src/nested/b.ts', 'b.ts')
    const { result } = renderOperations({
      initialOpenFiles: [fileA, fileB],
      initialActiveFilePath: fileA.path
    })

    await act(async () => {
      await result.current.renameEntry(dirNode, 'renamed')
    })

    expect(result.current.openFiles.map((f) => f.path)).toEqual([
      '/project/renamed/a.ts',
      '/project/renamed/nested/b.ts'
    ])
  })

  it('非アクティブファイルの削除では resetForFileChange を呼ばない', async () => {
    mockDeleteEntry.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const fileA = makeOpenFile('/project/src/a.ts', 'a.ts')
    const fileB = makeOpenFile('/project/src/b.ts', 'b.ts')
    const resetForFileChange = vi.fn()
    const { result } = renderOperations({
      initialOpenFiles: [fileA, fileB],
      initialActiveFilePath: fileA.path,
      resetForFileChange
    })

    await act(async () => {
      await result.current.deleteEntry({ name: 'b.ts', path: '/project/src/b.ts', type: 'file' })
    })

    expect(resetForFileChange).not.toHaveBeenCalled()
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/a.ts'])
  })
})
