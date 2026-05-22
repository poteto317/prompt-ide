import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileSystem } from '../useFileSystem'

const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
const mockReadDirectory = vi.mocked(fileSystemApi.readDirectory)
const mockReadFileContent = vi.mocked(fileSystemApi.readFileContent)

const mockTree: FileTreeNode[] = [
  { name: 'src', path: '/project/src', type: 'directory', children: [
    { name: 'index.ts', path: '/project/src/index.ts', type: 'file' },
  ]},
  { name: 'package.json', path: '/project/package.json', type: 'file' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useFileSystem', () => {
  it('初期状態で folderPath / fileTree / openFile / error が null / 空', () => {
    const { result } = renderHook(() => useFileSystem())
    expect(result.current.folderPath).toBeNull()
    expect(result.current.fileTree).toEqual([])
    expect(result.current.openFile).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('openFolder 成功時: folderPath と fileTree がセットされ error は null', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })

    expect(result.current.folderPath).toBe('/project')
    expect(result.current.fileTree).toEqual(mockTree)
    expect(result.current.error).toBeNull()
  })

  it('openFolder キャンセル時（null 返却）: 状態変化なし', async () => {
    mockOpenFolder.mockResolvedValue(null)

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })

    expect(result.current.folderPath).toBeNull()
    expect(result.current.fileTree).toEqual([])
    expect(mockReadDirectory).not.toHaveBeenCalled()
  })

  it('openFolder が throw した場合: error にセットされ folderPath / fileTree は変化しない', async () => {
    mockOpenFolder.mockRejectedValue(new Error('dialog error'))

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })

    expect(result.current.folderPath).toBeNull()
    expect(result.current.fileTree).toEqual([])
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('dialog error')
  })

  it('readDirectory が throw した場合: error にセットされ folderPath は変化しない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockRejectedValue(new Error('permission denied'))

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })

    expect(result.current.folderPath).toBeNull()
    expect(result.current.error?.message).toBe('permission denied')
  })

  it('openFolder 成功後に再度呼ぶと error がリセットされる', async () => {
    mockOpenFolder.mockRejectedValueOnce(new Error('first error'))
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })
    expect(result.current.error).not.toBeNull()

    await act(async () => { await result.current.openFolder() })
    expect(result.current.error).toBeNull()
    expect(result.current.folderPath).toBe('/project')
  })

  it('selectFile でファイルの内容が openFile にセットされる', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })

    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => { await result.current.selectFile(fileNode) })

    expect(result.current.openFile).toMatchObject({
      path: '/project/src/index.ts',
      name: 'index.ts',
      content: 'const x = 1',
      language: 'typescript',
    })
    expect(result.current.error).toBeNull()
  })

  it('selectFile でディレクトリを渡しても openFile は変化しない', async () => {
    const { result } = renderHook(() => useFileSystem())
    const dirNode: FileTreeNode = { name: 'src', path: '/project/src', type: 'directory' }
    await act(async () => { await result.current.selectFile(dirNode) })

    expect(result.current.openFile).toBeNull()
    expect(mockReadFileContent).not.toHaveBeenCalled()
  })

  it('openFolder 成功時に openFile がリセットされる', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')

    const { result } = renderHook(() => useFileSystem())
    await act(async () => { await result.current.openFolder() })

    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => { await result.current.selectFile(fileNode) })
    expect(result.current.openFile).not.toBeNull()

    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockResolvedValue([])
    await act(async () => { await result.current.openFolder() })
    expect(result.current.openFile).toBeNull()
  })

  it('selectFile が throw した場合: error にセットされ openFile は変化しない', async () => {
    mockReadFileContent.mockRejectedValue(new Error('read error'))

    const { result } = renderHook(() => useFileSystem())
    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => { await result.current.selectFile(fileNode) })

    expect(result.current.openFile).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('read error')
  })
})
