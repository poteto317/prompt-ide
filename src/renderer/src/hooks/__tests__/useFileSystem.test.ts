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

  it('先行する遅い読み込みが後から開いたファイルの表示を上書きしない', async () => {
    // クイックオープンで A を選んだまま閉じ、開き直して B を選ぶと 2 本の読み込みが
    // 同時に走る。A のほうが遅いと、解決順のせいで A が B を上書きしてしまう
    let resolveSlow: (content: string) => void = () => {}
    mockReadFileContent
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSlow = resolve
          })
      )
      .mockResolvedValueOnce('fast content')

    const slowNode: FileTreeNode = { name: 'slow.ts', path: '/project/slow.ts', type: 'file' }
    const fastNode: FileTreeNode = { name: 'fast.ts', path: '/project/fast.ts', type: 'file' }

    const { result } = renderHook(() => useFileSystem())
    let slowPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      slowPromise = result.current.selectFile(slowNode)
    })
    await act(async () => {
      await result.current.selectFile(fastNode)
    })
    expect(result.current.openFile?.path).toBe('/project/fast.ts')

    let slowOpened: boolean | undefined
    await act(async () => {
      resolveSlow('slow content')
      slowOpened = await slowPromise
    })
    expect(slowOpened).toBe(false)
    expect(result.current.openFile?.path).toBe('/project/fast.ts')
    expect(result.current.openFile?.content).toBe('fast content')
  })

  it('先行する読み込みの失敗が後から開いたファイルの表示を壊さない', async () => {
    let rejectSlow: (err: Error) => void = () => {}
    mockReadFileContent
      .mockImplementationOnce(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectSlow = reject
          })
      )
      .mockResolvedValueOnce('fast content')

    const slowNode: FileTreeNode = { name: 'slow.ts', path: '/project/slow.ts', type: 'file' }
    const fastNode: FileTreeNode = { name: 'fast.ts', path: '/project/fast.ts', type: 'file' }

    const { result } = renderHook(() => useFileSystem())
    let slowPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      slowPromise = result.current.selectFile(slowNode)
    })
    await act(async () => {
      await result.current.selectFile(fastNode)
    })
    await act(async () => {
      rejectSlow(new Error('遅延した失敗'))
      await slowPromise
    })
    expect(result.current.error).toBeNull()
    expect(result.current.openFile?.path).toBe('/project/fast.ts')
  })

  it('openFolder は保留中の読み込みを無効化する', async () => {
    let resolveSlow: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSlow = resolve
        })
    )
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockResolvedValue([])

    const slowNode: FileTreeNode = { name: 'slow.ts', path: '/project/slow.ts', type: 'file' }
    const { result } = renderHook(() => useFileSystem())
    act(() => {
      void result.current.selectFile(slowNode)
    })
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      resolveSlow('slow content')
    })
    expect(result.current.openFile).toBeNull()
  })

  it('closeFile は保留中の読み込みを無効化する', async () => {
    // 読み込み待ちのままタブを閉じたのに、あとから解決してファイルが再表示されるのを防ぐ
    let resolveSlow: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSlow = resolve
        })
    )
    const slowNode: FileTreeNode = { name: 'slow.ts', path: '/project/slow.ts', type: 'file' }
    const { result } = renderHook(() => useFileSystem())
    let slowPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      slowPromise = result.current.selectFile(slowNode)
    })
    act(() => result.current.closeFile())
    await act(async () => {
      resolveSlow('slow content')
      await slowPromise
    })
    expect(result.current.openFile).toBeNull()
  })

  it('ディレクトリ読み込み中のファイル操作で openFolder が中断されない', async () => {
    // ファイル読み込みと同じカウンタで中断判定すると、読み込み中にタブを閉じる/
    // ファイルをクリックするだけでフォルダ選択が黙って捨てられる
    let resolveTree: (tree: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/newfolder')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveTree = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem())
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    // 読み込み中にタブを閉じる(ファイル側のカウンタが進む)
    act(() => result.current.closeFile())
    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    expect(result.current.folderPath).toBe('/newfolder')
    expect(result.current.fileTree).toEqual(mockTree)
  })

  it('ディレクトリ読み込み中に開いたファイルを openFolder が消さない', async () => {
    // openFolder はネイティブダイアログのあと readDirectory を待つ。
    // その間に始まった選択が先に確定した場合、あとから openFile を null にしない
    let resolveTree: (tree: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveTree = resolve
        })
    )
    mockReadFileContent.mockResolvedValue('const x = 1')

    const { result } = renderHook(() => useFileSystem())
    let folderPromise: Promise<void> = Promise.resolve()
    // ネイティブダイアログの解決まで進め、readDirectory 待ちの状態にする
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    const fileNode: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(fileNode)
    })
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')

    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
  })

  it('古い openFolder の失敗が新しいフォルダの状態を上書きしない', async () => {
    // フォルダ読み込みの失敗は、より新しい「フォルダ選択」があったときだけ抑止する。
    // ファイル選択で抑止すると、実際に起きたフォルダ読み込み失敗が握り潰される
    let rejectFirst: (err: Error) => void = () => {}
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((_resolve, reject) => {
          rejectFirst = reject
        })
    )
    const { result } = renderHook(() => useFileSystem())
    let firstPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      firstPromise = result.current.openFolder()
    })

    mockOpenFolder.mockResolvedValue('/new')
    mockReadDirectory.mockResolvedValue(mockTree)
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/new')

    await act(async () => {
      rejectFirst(new Error('遅延したフォルダ読み込み失敗'))
      await firstPromise
    })
    expect(result.current.error).toBeNull()
    expect(result.current.folderPath).toBe('/new')
  })

  it('読み込み中に入った未保存の編集を確認なしで破棄しない', async () => {
    // Enter 後に閉じて旧ファイルを編集すると、あとから届いた読み込み結果が
    // 確認なしにバッファを置き換えて編集内容を失う
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const first: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(first)
    })

    let resolveSecond: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSecond = resolve
        })
    )
    const second: FileTreeNode = { name: 'App.tsx', path: '/project/src/App.tsx', type: 'file' }
    let secondPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      secondPromise = result.current.selectFile(second)
    })
    // 読み込み待ちの間に編集が入る(開始時点の確認では拾えない)
    act(() => result.current.updateFileContent('編集済み'))

    let opened: boolean | undefined
    await act(async () => {
      resolveSecond('const y = 2')
      opened = await secondPromise
    })
    expect(onConfirm).toHaveBeenCalled()
    expect(opened).toBe(false)
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
    expect(result.current.openFile?.content).toBe('編集済み')
  })

  it('読み込み中のファイルを削除したらその結果を表示しない', async () => {
    // 削除済みのファイルを表示してしまうと、編集して保存した時点で復活する
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    let resolveRead: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        })
    )
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    let readPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      readPromise = result.current.selectFile(node)
    })
    await act(async () => {
      await result.current.deleteEntry(node)
    })
    await act(async () => {
      resolveRead('const x = 1')
      await readPromise
    })
    expect(result.current.openFile).toBeNull()
  })

  it('未保存のまま別ファイルを開いても破棄確認は 1 回だけ', async () => {
    // 開始時の確認とコミット直前の再確認で、同じダイアログが 2 回出てはいけない
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const first: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(first)
    })
    act(() => result.current.updateFileContent('編集済み'))
    onConfirm.mockClear()

    const second: FileTreeNode = { name: 'App.tsx', path: '/project/src/App.tsx', type: 'file' }
    await act(async () => {
      await result.current.selectFile(second)
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(result.current.openFile?.path).toBe('/project/src/App.tsx')
  })

  it('無関係なファイルの削除では進行中のファイルオープンを取り消さない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    let resolveRead: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        })
    )
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const target: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    let readPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      readPromise = result.current.selectFile(target)
    })
    // 読み込み中のファイルとは無関係なファイルを削除する
    await act(async () => {
      await result.current.deleteEntry({
        name: 'other.ts',
        path: '/project/other.ts',
        type: 'file'
      })
    })
    let opened: boolean | undefined
    await act(async () => {
      resolveRead('const x = 1')
      opened = await readPromise
    })
    expect(opened).toBe(true)
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
  })

  it('ディレクトリ読み込み中に入った編集を openFolder が確認なしで破棄しない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(node)
    })

    let resolveTree: (tree: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveTree = resolve
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    onConfirm.mockClear()
    // ディレクトリ走査の間に編集が入る
    act(() => result.current.updateFileContent('編集済み'))
    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    expect(onConfirm).toHaveBeenCalled()
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
