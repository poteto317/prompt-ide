import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode, OpenFile } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileTreeOperations } from '../useFileTreeOperations'

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
  initialOpenFile?: OpenFile | null
  onConfirm?: (message: string) => boolean
  resetForFileChange?: () => void
  invalidatePendingReads?: (affectedPath: string) => void
}) {
  const resetForFileChange = config?.resetForFileChange ?? vi.fn()
  const invalidatePendingReads = config?.invalidatePendingReads ?? vi.fn()
  const onConfirm = config?.onConfirm ?? vi.fn<(message: string) => boolean>().mockReturnValue(true)
  // null を明示的に渡すケースを undefined(デフォルト値を使う)と区別する
  const folderPath = config && 'folderPath' in config ? (config.folderPath ?? null) : '/project'
  const { result } = renderHook(() => {
    const [openFile, setOpenFile] = useState<OpenFile | null>(config?.initialOpenFile ?? null)
    const ops = useFileTreeOperations({
      folderPath,
      openFile,
      setOpenFile,
      resetForFileChange,
      onConfirm,
      invalidatePendingReads
    })
    return { ...ops, openFile }
  })
  return { result, resetForFileChange, onConfirm, invalidatePendingReads }
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
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name),
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
      expect(result.current.openFile?.path).toBe(fileNode.path)
      expect(resetForFileChange).not.toHaveBeenCalled()
    })

    it('開いているファイル自体のリネームで path/name/language が追随する', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations({
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name)
      })

      await act(async () => {
        await result.current.renameEntry(fileNode, 'index.md')
      })

      expect(result.current.openFile?.path).toBe('/project/src/index.md')
      expect(result.current.openFile?.name).toBe('index.md')
      expect(result.current.openFile?.language).toBe('markdown')
    })

    it('開いているファイル自体のリネームで resetForFileChange が呼ばれる(保存状態の世代を更新する)', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name),
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
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name)
      })

      await act(async () => {
        await result.current.renameEntry(dirNode, 'lib')
      })

      expect(mockRenameEntry).toHaveBeenCalledWith('/project/src', 'lib')
      expect(result.current.openFile?.path).toBe('/project/lib/index.ts')
    })

    it('開いているファイルの祖先ディレクトリのリネームでも resetForFileChange が呼ばれる', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name),
        resetForFileChange
      })

      await act(async () => {
        await result.current.renameEntry(dirNode, 'lib')
      })

      expect(resetForFileChange).toHaveBeenCalledOnce()
    })

    it('openFile が null のとき何もしない(例外にならない)', async () => {
      mockRenameEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue(mockTree)
      const { result } = renderOperations({ initialOpenFile: null })

      await act(async () => {
        await result.current.renameEntry(fileNode, 'renamed.ts')
      })

      expect(result.current.openFile).toBeNull()
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

    it('開いているファイル自体を削除すると openFile が閉じられ resetForFileChange が呼ばれる', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const resetForFileChange = vi.fn()
      const { result } = renderOperations({
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name),
        resetForFileChange
      })

      await act(async () => {
        await result.current.deleteEntry(fileNode)
      })

      expect(result.current.openFile).toBeNull()
      expect(resetForFileChange).toHaveBeenCalledOnce()
    })

    it('開いているファイルの祖先ディレクトリを削除すると openFile が閉じられる', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const { result } = renderOperations({
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name)
      })

      await act(async () => {
        await result.current.deleteEntry(dirNode)
      })

      expect(result.current.openFile).toBeNull()
    })

    it('無関係なファイルの削除では openFile を閉じない', async () => {
      mockDeleteEntry.mockResolvedValue(undefined)
      mockReadDirectory.mockResolvedValue([])
      const { result } = renderOperations({
        initialOpenFile: makeOpenFile(fileNode.path, fileNode.name)
      })

      const otherNode: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }
      await act(async () => {
        await result.current.deleteEntry(otherNode)
      })

      expect(result.current.openFile?.path).toBe(fileNode.path)
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
