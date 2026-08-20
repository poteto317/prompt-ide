import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileSystem } from '../useFileSystem'

const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
const mockReadDirectory = vi.mocked(fileSystemApi.readDirectory)
const mockReadFileContent = vi.mocked(fileSystemApi.readFileContent)
const mockWriteFileContent = vi.mocked(fileSystemApi.writeFileContent)

const mockTree: FileTreeNode[] = [
  {
    name: 'src',
    path: '/project/src',
    type: 'directory',
    children: [{ name: 'index.ts', path: '/project/src/index.ts', type: 'file' }]
  },
  { name: 'package.json', path: '/project/package.json', type: 'file' }
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
    await act(async () => {
      await result.current.openFolder()
    })

    expect(result.current.folderPath).toBe('/project')
    expect(result.current.fileTree).toEqual(mockTree)
    expect(result.current.error).toBeNull()
  })

  it('openFolder キャンセル時（null 返却）: 状態変化なし', async () => {
    mockOpenFolder.mockResolvedValue(null)

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    expect(result.current.folderPath).toBeNull()
    expect(result.current.fileTree).toEqual([])
    expect(mockReadDirectory).not.toHaveBeenCalled()
  })

  it('openFolder が throw した場合: error にセットされ folderPath / fileTree は変化しない', async () => {
    mockOpenFolder.mockRejectedValue(new Error('dialog error'))

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    expect(result.current.folderPath).toBeNull()
    expect(result.current.fileTree).toEqual([])
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('dialog error')
  })

  it('readDirectory が throw した場合: error にセットされ folderPath は変化しない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockRejectedValue(new Error('permission denied'))

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    expect(result.current.folderPath).toBeNull()
    expect(result.current.error?.message).toBe('permission denied')
  })

  it('openFolder 成功後に再度呼ぶと error がリセットされる', async () => {
    mockOpenFolder.mockRejectedValueOnce(new Error('first error'))
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error).not.toBeNull()

    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.folderPath).toBe('/project')
  })

  it('selectFile でファイルの内容が openFile にセットされる', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileNode)
    })

    expect(result.current.openFile).toMatchObject({
      path: '/project/src/index.ts',
      name: 'index.ts',
      content: 'const x = 1',
      language: 'typescript'
    })
    expect(result.current.error).toBeNull()
  })

  it('selectFile はファイルを開けたとき true を返す', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.selectFile(fileNode)
    })
    expect(opened).toBe(true)
  })

  it('selectFile はディレクトリを渡されたとき false を返す', async () => {
    const { result } = renderHook(() => useFileSystem())
    const dirNode: FileTreeNode = { name: 'src', path: '/project/src', type: 'directory' }
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.selectFile(dirNode)
    })
    expect(opened).toBe(false)
  })

  it('selectFile は読み込みに失敗したとき false を返す', async () => {
    mockReadFileContent.mockRejectedValue(new Error('読み込み失敗'))

    const { result } = renderHook(() => useFileSystem())
    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.selectFile(fileNode)
    })
    expect(opened).toBe(false)
    expect(result.current.error).not.toBeNull()
  })

  it('selectFile は未保存変更の破棄がキャンセルされたとき false を返す', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => false)

    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileNode)
    })
    act(() => result.current.updateFileContent('編集済み'))

    const otherNode: FileTreeNode = { name: 'App.tsx', path: '/project/src/App.tsx', type: 'file' }
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.selectFile(otherNode)
    })
    expect(opened).toBe(false)
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
  })

  it('selectFile でディレクトリを渡しても openFile は変化しない', async () => {
    const { result } = renderHook(() => useFileSystem())
    const dirNode: FileTreeNode = { name: 'src', path: '/project/src', type: 'directory' }
    await act(async () => {
      await result.current.selectFile(dirNode)
    })

    expect(result.current.openFile).toBeNull()
    expect(mockReadFileContent).not.toHaveBeenCalled()
  })

  it('openFolder 成功時に openFile がリセットされる', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileNode)
    })
    expect(result.current.openFile).not.toBeNull()

    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockResolvedValue([])
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.openFile).toBeNull()
  })

  it('selectFile が throw した場合: error にセットされ openFile は変化しない', async () => {
    mockReadFileContent.mockRejectedValue(new Error('read error'))

    const { result } = renderHook(() => useFileSystem())
    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileNode)
    })

    expect(result.current.openFile).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('read error')
  })

  async function openAndSelect(result: { current: ReturnType<typeof useFileSystem> }) {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    await act(async () => {
      await result.current.openFolder()
    })
    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileNode)
    })
  }

  // isDirty / updateFileContent / saveFile 自体の詳細な挙動は useFileEditing.test.ts で
  // 単体検証済み。ここでは useFileEditing との合成（openFolder/selectFile からの委譲）が
  // 正しく機能することのみを軽量に確認する。
  describe('useFileEditing との合成', () => {
    it('isDirty / updateFileContent / saveFile が戻り値から利用できる', async () => {
      mockWriteFileContent.mockResolvedValue(undefined)
      const { result } = renderHook(() => useFileSystem())
      await openAndSelect(result)
      expect(result.current.isDirty).toBe(false)

      act(() => {
        result.current.updateFileContent('const x = 2')
      })
      expect(result.current.isDirty).toBe(true)

      await act(async () => {
        await result.current.saveFile()
      })
      expect(mockWriteFileContent).toHaveBeenCalledWith('/project/src/index.ts', 'const x = 2')
      expect(result.current.isDirty).toBe(false)
    })

    it('未保存変更があるとき openFolder は確認ガードで開くのをブロックできる', async () => {
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })
      mockOpenFolder.mockClear()

      await act(async () => {
        await result.current.openFolder()
      })

      expect(onConfirm).toHaveBeenCalledWith(expect.any(String))
      expect(mockOpenFolder).not.toHaveBeenCalled()
      expect(result.current.openFile?.content).toBe('const x = 2')
    })

    it('onConfirm が true を返せば openFolder はブロックされずに続行する', async () => {
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })
      mockOpenFolder.mockResolvedValue('/other')
      mockReadDirectory.mockResolvedValue([])

      await act(async () => {
        await result.current.openFolder()
      })

      expect(mockOpenFolder).toHaveBeenCalled()
      expect(result.current.folderPath).toBe('/other')
    })

    it('未保存変更があるとき selectFile も確認ガードでファイル切り替えをブロックできる', async () => {
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })
      mockReadFileContent.mockClear()
      const otherNode: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }

      await act(async () => {
        await result.current.selectFile(otherNode)
      })

      expect(onConfirm).toHaveBeenCalledWith(expect.any(String))
      expect(mockReadFileContent).not.toHaveBeenCalled()
      expect(result.current.openFile?.path).toBe('/project/src/index.ts')
      expect(result.current.openFile?.content).toBe('const x = 2')
    })

    it('saveFile の失敗は error ではなく saveError にセットされる（フォルダ系エラーとの混線防止）', async () => {
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem())
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      await act(async () => {
        await result.current.saveFile()
      })

      expect(result.current.saveError?.message).toBe('EACCES')
      expect(result.current.error).toBeNull()
    })

    it('openFolder の失敗は saveError ではなく error にセットされる（保存系エラーとの混線防止）', async () => {
      mockOpenFolder.mockRejectedValue(new Error('dialog error'))
      const { result } = renderHook(() => useFileSystem())

      await act(async () => {
        await result.current.openFolder()
      })

      expect(result.current.error?.message).toBe('dialog error')
      expect(result.current.saveError).toBeNull()
    })

    it('保存失敗後に別ファイルへ切り替わると saveError がクリアされる', async () => {
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      mockReadFileContent.mockResolvedValue('package content')
      const otherNode: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }
      await act(async () => {
        await result.current.selectFile(otherNode)
      })

      expect(result.current.saveError).toBeNull()
    })

    it('保存失敗後に同じファイルを開き直しても saveError がクリアされる（reselect同一パス）', async () => {
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      mockReadFileContent.mockResolvedValue('const x = 1')
      const sameNode: FileTreeNode = {
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      }
      await act(async () => {
        await result.current.selectFile(sameNode)
      })

      expect(result.current.saveError).toBeNull()
    })

    it('別ファイルの保存中でも、切り替え先のファイルは isSaving でブロックされずに保存できる', async () => {
      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      let firstSave: Promise<void> = Promise.resolve()
      act(() => {
        firstSave = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      mockReadFileContent.mockResolvedValue('package content')
      const otherNode: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }
      await act(async () => {
        await result.current.selectFile(otherNode)
      })
      expect(result.current.isSaving).toBe(false)

      mockWriteFileContent.mockResolvedValueOnce(undefined)
      act(() => {
        result.current.updateFileContent('package content 2')
      })
      await act(async () => {
        await result.current.saveFile()
      })
      expect(mockWriteFileContent).toHaveBeenCalledWith(
        '/project/package.json',
        'package content 2'
      )

      await act(async () => {
        resolveWrite()
        await firstSave
      })
    })

    it('closeFile で openFile が null になる', async () => {
      const { result } = renderHook(() => useFileSystem())
      await openAndSelect(result)
      expect(result.current.openFile).not.toBeNull()

      act(() => {
        result.current.closeFile()
      })

      expect(result.current.openFile).toBeNull()
    })

    it('未保存変更があるとき closeFile は確認ガードで閉じるのをブロックできる', async () => {
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      act(() => {
        result.current.closeFile()
      })

      expect(onConfirm).toHaveBeenCalledWith(expect.any(String))
      expect(result.current.openFile).not.toBeNull()
    })

    it('onConfirm が true を返せば closeFile はブロックされずに openFile を閉じる', async () => {
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      act(() => {
        result.current.closeFile()
      })

      expect(onConfirm).toHaveBeenCalledWith(expect.any(String))
      expect(result.current.openFile).toBeNull()
    })

    it('closeFile 後は saveError がクリアされる', async () => {
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      act(() => {
        result.current.closeFile()
      })

      expect(result.current.saveError).toBeNull()
    })

    it('保存中に closeFile しても、保存完了後に古い結果（savedContent/saveError）が反映されない', async () => {
      let rejectWrite: (err: Error) => void = () => {}
      mockWriteFileContent.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject
          })
      )
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      let firstSave: Promise<void> = Promise.resolve()
      act(() => {
        firstSave = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      act(() => {
        result.current.closeFile()
      })
      expect(result.current.openFile).toBeNull()

      // 保存中に閉じた後、書き込みが失敗して解決しても、既に無関係になった
      // 編集セッションのエラーとして saveError に反映されてはならない
      // （generation 不一致によりガードされることを確認する）。
      await act(async () => {
        rejectWrite(new Error('EACCES'))
        await firstSave
      })
      expect(result.current.saveError).toBeNull()
      expect(result.current.openFile).toBeNull()
    })

    it('isSaving が戻り値から利用でき、保存完了後は false に戻る', async () => {
      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem())
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })

      let savePromise: Promise<void> = Promise.resolve()
      act(() => {
        savePromise = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      await act(async () => {
        resolveWrite()
        await savePromise
      })
      expect(result.current.isSaving).toBe(false)
    })
  })
})
