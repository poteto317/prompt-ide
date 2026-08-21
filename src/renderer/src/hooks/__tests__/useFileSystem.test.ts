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
const mockDeleteEntry = vi.mocked(fileSystemApi.deleteEntry)
const mockRenameEntry = vi.mocked(fileSystemApi.renameEntry)
const mockCreateFile = vi.mocked(fileSystemApi.createFile)

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

  it('readDirectory が throw した場合: error にセットされ、選択したフォルダは確定する', async () => {
    // main は選択直後にアクセス範囲を切り替えるため、表示側も選択したフォルダに
    // 合わせる(旧フォルダを表示したままだと以降の操作が全てアクセス拒否になる)
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockRejectedValue(new Error('permission denied'))

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    expect(result.current.folderPath).toBe('/project')
    expect(result.current.fileTree).toEqual([])
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

  it('別ファイルに切り替わっていれば内容が同じでも破棄確認する', async () => {
    // 内容の文字列だけで判定すると、走査中に別ファイルを開いて偶然同じ内容に
    // なった場合に「変化なし」と誤判定し、未保存の変更を無確認で破棄する
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('same')
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const first: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(first)
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
    // 走査中に別ファイルを開き、内容はスナップショットと同じ文字列にする
    const second: FileTreeNode = { name: 'App.tsx', path: '/project/src/App.tsx', type: 'file' }
    await act(async () => {
      await result.current.selectFile(second)
    })
    act(() => result.current.updateFileContent('same'))
    onConfirm.mockClear()
    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    // 確定した選択があるので閉じない(消すなら確認が要る)
    expect(result.current.openFile?.path).toBe('/project/src/App.tsx')
  })

  it('フォルダ確定でファイルを閉じるとき、保留中の読み込みも無効化する', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
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

    // 走査中に始まった読み込みは、まだコミットしていない
    let resolveRead: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        })
    )
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    let readPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      readPromise = result.current.selectFile(node)
    })
    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    expect(result.current.openFile).toBeNull()

    await act(async () => {
      resolveRead('const x = 1')
      await readPromise
    })
    // 旧フォルダのファイルが新しいフォルダに現れてはいけない
    expect(result.current.openFile).toBeNull()
  })

  it('削除完了前に読み込みがコミットしても削除済みファイルを残さない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }

    // 削除の実行中に、対象ファイルの読み込みが先に確定する
    mockDeleteEntry.mockImplementationOnce(async () => {
      await result.current.selectFile(node)
    })
    await act(async () => {
      await result.current.deleteEntry(node)
    })
    expect(result.current.openFile).toBeNull()
  })

  it('未保存の編集があるファイルをリネームしても編集内容を失わない', async () => {
    // ミラーが編集を取り込めていないと、リネーム時に古い状態を書き戻して
    // 未保存の編集が消える
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    mockRenameEntry.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(node)
    })
    act(() => result.current.updateFileContent('編集済み'))
    expect(result.current.isDirty).toBe(true)

    await act(async () => {
      await result.current.renameEntry(node, 'renamed.ts')
    })
    expect(result.current.openFile?.name).toBe('renamed.ts')
    expect(result.current.openFile?.content).toBe('編集済み')
    expect(result.current.isDirty).toBe(true)
  })

  it('新しいフォルダの走査中に始まった古いツリー再読込がそれを無効化しない', async () => {
    // 旧フォルダ A の CRUD から呼ばれた refreshTree が、B の走査中に世代を
    // 進めてしまうと、B の結果が捨てられフォルダ選択が黙って失われる
    mockOpenFolder.mockResolvedValue('/old')
    mockDeleteEntry.mockResolvedValue(undefined)
    const oldTree: FileTreeNode[] = [{ name: 'old.ts', path: '/old/old.ts', type: 'file' }]
    const newTree: FileTreeNode[] = [{ name: 'new.ts', path: '/new/new.ts', type: 'file' }]
    // /new の走査は 1 本の保留 promise を全呼び出しで共有する。呼び出しごとに
    // 作り直すと resolveNew が上書きされ、最初の走査が永久に解決しない
    let resolveNew: (tree: FileTreeNode[]) => void = () => {}
    const pendingNew = new Promise<FileTreeNode[]>((resolve) => {
      resolveNew = resolve
    })
    mockReadDirectory.mockImplementation((target: string) =>
      target === '/new' ? pendingNew : Promise.resolve(oldTree)
    )

    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    // 新しいフォルダの走査を保留状態にする
    mockOpenFolder.mockResolvedValue('/new')
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    // 走査中に旧フォルダの削除 → refreshTree が走る。
    // 再読込は保留中の走査と同じ readDirectory を待つため、ここでは完了を待たない
    let deletePromise: Promise<void> = Promise.resolve()
    await act(async () => {
      deletePromise = result.current.deleteEntry({
        name: 'a.ts',
        path: '/old/a.ts',
        type: 'file'
      })
    })
    await act(async () => {
      resolveNew(newTree)
      await folderPromise
      await deletePromise
    })
    expect(result.current.folderPath).toBe('/new')
    expect(result.current.fileTree).toEqual(newTree)
  })

  it('フォルダ切替後に始まった古いツリー再読込が新しいフォルダを壊さない', async () => {
    // クロージャの folderPath を読むと、切替後に始まった再読込が旧フォルダを
    // 読み込み、その結果で新しいフォルダのツリーを上書きしてしまう
    const oldTree: FileTreeNode[] = [{ name: 'old.ts', path: '/old/old.ts', type: 'file' }]
    const newTree: FileTreeNode[] = [{ name: 'new.ts', path: '/new/new.ts', type: 'file' }]
    mockReadDirectory.mockImplementation((target: string) =>
      Promise.resolve(target === '/new' ? newTree : oldTree)
    )
    mockOpenFolder.mockResolvedValue('/old')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // 削除の FS 操作を保留させ、その間にフォルダを切り替える
    let finishDelete: () => void = () => {}
    mockDeleteEntry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve
        })
    )
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry({
        name: 'a.ts',
        path: '/old/a.ts',
        type: 'file'
      })
    })

    mockOpenFolder.mockResolvedValue('/new')
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.fileTree).toEqual(newTree)

    // ここで初めて古い CRUD の refreshTree が始まる
    await act(async () => {
      finishDelete()
      await deletePromise
    })
    expect(result.current.folderPath).toBe('/new')
    expect(result.current.fileTree).toEqual(newTree)
    expect(result.current.error).toBeNull()
  })

  it('フォルダ切替をキャンセルしても走査中に始まった読み込みは無効化する', async () => {
    // キャンセルで即 return すると無効化に到達せず、その読み込みが再確認なしに
    // バッファを置き換えて編集内容を失う
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

    // 走査中に編集し、さらに別ファイルの読み込みを開始する
    act(() => result.current.updateFileContent('編集済み'))
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

    // 最終確認をキャンセルする
    onConfirm.mockReturnValue(false)
    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })

    await act(async () => {
      resolveSecond('const y = 2')
      await secondPromise
    })
    // 走査中に始まった読み込みは無効化され、編集内容が残る
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
    expect(result.current.openFile?.content).toBe('編集済み')
  })

  it('ディレクトリ走査中に発生したエラーをフォルダ確定時にクリアする', async () => {
    // openFolder 冒頭の setError(null) より後に起きたエラーは、確定時にも
    // 消さないと新しいフォルダの画面に残り続ける
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
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

    // 走査中にファイル読み込みが失敗してエラーが立つ
    mockReadFileContent.mockRejectedValue(new Error('読み込み失敗'))
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
    })
    expect(result.current.error).not.toBeNull()

    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.error).toBeNull()
  })

  it('走査中に選択が確定していても、未コミットの読み込みは無効化する', async () => {
    // 早期 return する分岐でも無効化しないと、新しいフォルダに旧フォルダの
    // ファイルがあとから表示される
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
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

    // 走査中に A の読み込みが確定する
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
    })
    // さらに B の読み込みを開始する(未コミット)
    let resolveSecond: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSecond = resolve
        })
    )
    let secondPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      secondPromise = result.current.selectFile({
        name: 'App.tsx',
        path: '/project/src/App.tsx',
        type: 'file'
      })
    })

    await act(async () => {
      resolveTree(mockTree)
      await folderPromise
    })
    await act(async () => {
      resolveSecond('const y = 2')
      await secondPromise
    })
    // B は無効化され、A のまま(新しいフォルダに B が現れない)
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
  })

  it('走査中に完了した CRUD の結果がフォルダ確定後のツリーに反映される', async () => {
    // 先行する readDirectory のスナップショットには CRUD の結果が入っていない
    mockOpenFolder.mockResolvedValue('/project')
    mockCreateFile.mockResolvedValue(undefined)
    const before: FileTreeNode[] = [{ name: 'a.ts', path: '/project/a.ts', type: 'file' }]
    const after: FileTreeNode[] = [
      { name: 'a.ts', path: '/project/a.ts', type: 'file' },
      { name: 'b.ts', path: '/project/b.ts', type: 'file' }
    ]
    let resolveInitial: (tree: FileTreeNode[]) => void = () => {}
    let calls = 0
    mockReadDirectory.mockImplementation(() => {
      calls += 1
      if (calls === 1) {
        return new Promise<FileTreeNode[]>((resolve) => {
          resolveInitial = resolve
        })
      }
      return Promise.resolve(after)
    })

    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    // 走査中にファイルを作成する
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    await act(async () => {
      resolveInitial(before)
      await folderPromise
    })
    await act(async () => {})
    expect(result.current.fileTree).toEqual(after)
  })

  it('保留中の古い再読込がフォルダ確定後のツリーを上書きしない', async () => {
    // 同じフォルダを開き直した場合、パスが一致するため順序だけでは弾けない
    mockOpenFolder.mockResolvedValue('/project')
    mockDeleteEntry.mockResolvedValue(undefined)
    const staleTree: FileTreeNode[] = [
      { name: 'stale.ts', path: '/project/stale.ts', type: 'file' }
    ]
    const freshTree: FileTreeNode[] = [
      { name: 'fresh.ts', path: '/project/fresh.ts', type: 'file' }
    ]
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // 削除に伴う再読込を保留させる
    let resolveStale: (tree: FileTreeNode[]) => void = () => {}
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveStale = resolve
        })
    )
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry({
        name: 'a.ts',
        path: '/project/a.ts',
        type: 'file'
      })
    })
    await act(async () => {})

    // 同じフォルダを開き直して新しいツリーを確定させる
    mockReadDirectory.mockResolvedValue(freshTree)
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.fileTree).toEqual(freshTree)

    // 遅れて解決した古い再読込が上書きしない
    await act(async () => {
      resolveStale(staleTree)
      await deletePromise
    })
    expect(result.current.fileTree).toEqual(freshTree)
  })

  it('フォルダ走査が失敗しても、走査中に完了した CRUD の結果を取り込む', async () => {
    // 走査中は再読込を止めているため、失敗時に取り直さないとツリーが古いまま残る
    mockOpenFolder.mockResolvedValue('/project')
    mockCreateFile.mockResolvedValue(undefined)
    const initial: FileTreeNode[] = [{ name: 'a.ts', path: '/project/a.ts', type: 'file' }]
    const afterCreate: FileTreeNode[] = [
      ...initial,
      { name: 'b.ts', path: '/project/b.ts', type: 'file' }
    ]
    mockReadDirectory.mockResolvedValue(initial)
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // 2 回目のフォルダ走査を失敗させる
    let rejectScan: (err: Error) => void = () => {}
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((_resolve, reject) => {
          rejectScan = reject
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    // 走査中にファイル作成が成功する(再読込は保留される)
    mockReadDirectory.mockResolvedValue(afterCreate)
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    expect(result.current.fileTree).toEqual(initial)

    await act(async () => {
      rejectScan(new Error('走査失敗'))
      await folderPromise
    })
    expect(result.current.fileTree).toEqual(afterCreate)
    // 取り直しに成功したので、走査失敗のエラーはもう当てはまらない
    expect(result.current.error).toBeNull()
    expect(result.current.folderLoadError).toBeNull()
  })

  it('フォルダ確定後の取り直しが失敗しても openFolder を reject させない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockCreateFile.mockResolvedValue(undefined)
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    let resolveScan: (tree: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveScan = resolve
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    await act(async () => {
      await result.current.createFile('/other', 'b.ts')
    })

    // 確定後の取り直しを失敗させる
    mockReadDirectory.mockRejectedValue(new Error('取り直し失敗'))
    let rejected = false
    await act(async () => {
      resolveScan([])
      await folderPromise.catch(() => {
        rejected = true
      })
    })
    expect(rejected).toBe(false)
    expect(result.current.error).not.toBeNull()
  })

  it('同じ tick で入った編集も破棄確認の対象にする', async () => {
    // スナップショットが layout effect 更新の ref を見ていると、同期ミラーだけが
    // 更新された編集を取りこぼし、未保存の変更を無確認で上書きする
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
    })

    let resolveSecond: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSecond = resolve
        })
    )
    let secondPromise: Promise<boolean> = Promise.resolve(false)
    // 読み込み開始と編集を同じ tick でまとめて行う
    act(() => {
      secondPromise = result.current.selectFile({
        name: 'App.tsx',
        path: '/project/src/App.tsx',
        type: 'file'
      })
      result.current.updateFileContent('編集済み')
    })
    await act(async () => {
      resolveSecond('const y = 2')
      await secondPromise
    })
    expect(onConfirm).toHaveBeenCalled()
    expect(result.current.openFile?.content).toBe('編集済み')
  })

  it('フォルダ選択をキャンセルしても、その間の CRUD の結果を反映する', async () => {
    // ネイティブダイアログ表示中も再読込を止めていると、キャンセル時に
    // 捨てられた再読込が復元されずツリーが古いまま残る
    mockCreateFile.mockResolvedValue(undefined)
    const initial: FileTreeNode[] = [{ name: 'a.ts', path: '/project/a.ts', type: 'file' }]
    const afterCreate: FileTreeNode[] = [
      ...initial,
      { name: 'b.ts', path: '/project/b.ts', type: 'file' }
    ]
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(initial)
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // ダイアログをキャンセルする(その間にファイル作成が完了する)
    let cancelDialog: (value: string | null) => void = () => {}
    mockOpenFolder.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          cancelDialog = resolve
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    act(() => {
      folderPromise = result.current.openFolder()
    })
    mockReadDirectory.mockResolvedValue(afterCreate)
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    await act(async () => {
      cancelDialog(null)
      await folderPromise
    })
    expect(result.current.fileTree).toEqual(afterCreate)
  })

  it('先行するフォルダ選択の失敗が新しいフォルダのエラーを上書きしない', async () => {
    // ダイアログ解決前は世代が未割当だと、reject 時に「最新か」を判定できない
    mockReadDirectory.mockResolvedValue([])
    let rejectFirstDialog: (err: Error) => void = () => {}
    mockOpenFolder.mockImplementationOnce(
      () =>
        new Promise<string | null>((_resolve, reject) => {
          rejectFirstDialog = reject
        })
    )
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    let firstPromise: Promise<void> = Promise.resolve()
    act(() => {
      firstPromise = result.current.openFolder()
    })

    mockOpenFolder.mockResolvedValue('/new')
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/new')

    await act(async () => {
      rejectFirstDialog(new Error('ダイアログ失敗'))
      await firstPromise
    })
    expect(result.current.error).toBeNull()
  })

  it('フォルダ切替後に届いた CRUD の失敗を新しいフォルダに表示しない', async () => {
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    let rejectCreate: (err: Error) => void = () => {}
    mockCreateFile.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCreate = reject
        })
    )
    let createPromise: Promise<void> = Promise.resolve()
    act(() => {
      createPromise = result.current.createFile('/old', 'b.ts')
    })

    mockOpenFolder.mockResolvedValue('/new')
    await act(async () => {
      await result.current.openFolder()
    })

    await act(async () => {
      rejectCreate(new Error('作成失敗'))
      await createPromise
    })
    expect(result.current.error).toBeNull()
  })

  it('同じバッチで複数のファイルが確定しても、開いた順に信号へ残る', async () => {
    // 直近 1 件しか持たないと、消費側(最近開いたファイルの履歴)が
    // 中間のファイルを取りこぼす
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // 同じタスク内で連続して開く(React は両方の更新を 1 回のレンダーへまとめる)
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
      await result.current.selectFile({
        name: 'App.tsx',
        path: '/project/src/App.tsx',
        type: 'file'
      })
    })
    const paths = result.current.openedFileSignal.events.map((e) => e.path)
    expect(paths).toContain('/project/src/index.ts')
    expect(paths).toContain('/project/src/App.tsx')
  })

  it('走査に失敗しても選択したフォルダを確定する(アクセス範囲と表示を一致させる)', async () => {
    // main は選択直後にアクセス範囲を新しいフォルダへ切り替えるため、旧フォルダの
    // ツリーを表示したままにすると、以降の操作がすべてアクセス拒否になる
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue([{ name: 'a.ts', path: '/old/a.ts', type: 'file' }])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    mockOpenFolder.mockResolvedValue('/new')
    mockReadDirectory.mockRejectedValue(new Error('走査失敗'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/new')
    expect(result.current.fileTree).toEqual([])
    expect(result.current.error).not.toBeNull()
  })

  it('走査中に別のフォルダ選択をキャンセルしても、走査結果は確定する', async () => {
    // ダイアログ試行の世代と実際の走査の世代を分けないと、キャンセルした試行が
    // 実行中の走査を無効化してフォルダ選択が黙って失われる
    const tree: FileTreeNode[] = [{ name: 'a.ts', path: '/target/a.ts', type: 'file' }]
    let resolveScan: (t: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/target')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveScan = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    let firstPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      firstPromise = result.current.openFolder()
    })

    // 走査中に別のダイアログを開いてキャンセルする
    mockOpenFolder.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.openFolder()
    })

    await act(async () => {
      resolveScan(tree)
      await firstPromise
    })
    expect(result.current.folderPath).toBe('/target')
    expect(result.current.fileTree).toEqual(tree)
  })

  it('走査が並行していても、抑止された再読込を最後にやり直す', async () => {
    // B の finally 時点では A がまだ走査中で再読込が抑止される。A の完了時に
    // やり直さないと、走査中に完了した CRUD の結果がツリーへ反映されない
    mockCreateFile.mockResolvedValue(undefined)
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // A の走査を保留させる
    let resolveA: (t: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/a')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveA = resolve
        })
    )
    let aPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      aPromise = result.current.openFolder()
    })
    // A の走査中に CRUD が完了する(再読込は抑止される)
    await act(async () => {
      await result.current.createFile('/old', 'b.ts')
    })

    // B が先に成功して確定する(この時点でも A が走査中なので再読込は抑止される)
    mockOpenFolder.mockResolvedValue('/b')
    mockReadDirectory.mockResolvedValue([])
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/b')

    // A の完了で走査が 0 本になり、抑止していた再読込をやり直す
    const refreshed: FileTreeNode[] = [{ name: 'b.ts', path: '/b/b.ts', type: 'file' }]
    mockReadDirectory.mockResolvedValue(refreshed)
    await act(async () => {
      resolveA([])
      await aPromise
    })
    expect(result.current.folderPath).toBe('/b')
    expect(result.current.fileTree).toEqual(refreshed)
  })

  it('走査に失敗して確定したときも、走査中に始まった読み込みを無効化する', async () => {
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    let rejectScan: (err: Error) => void = () => {}
    mockOpenFolder.mockResolvedValue('/new')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((_resolve, reject) => {
          rejectScan = reject
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })

    // 走査中に旧ツリーのファイル選択を開始する
    let resolveRead: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        })
    )
    let readPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      readPromise = result.current.selectFile({
        name: 'index.ts',
        path: '/old/src/index.ts',
        type: 'file'
      })
    })

    await act(async () => {
      rejectScan(new Error('走査失敗'))
      await folderPromise
    })
    await act(async () => {
      resolveRead('const x = 1')
      await readPromise
    })
    // 旧フォルダのファイルが新しいフォルダに現れてはいけない
    expect(result.current.openFile).toBeNull()
  })

  it('走査に失敗して確定するとき、変更が無ければ開いているファイルも閉じる', async () => {
    // 旧フォルダのファイルが残ると、アクセス範囲は選択先なのに保存・再読込が不整合になる
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/old/src/index.ts',
        type: 'file'
      })
    })
    expect(result.current.openFile).not.toBeNull()

    mockOpenFolder.mockResolvedValue('/new')
    mockReadDirectory.mockRejectedValue(new Error('走査失敗'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/new')
    expect(result.current.openFile).toBeNull()
  })

  it('走査に失敗しても、破棄がキャンセルされればファイルを閉じない', async () => {
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/old/src/index.ts',
        type: 'file'
      })
    })

    mockOpenFolder.mockResolvedValue('/new')
    let rejectScan: (err: Error) => void = () => {}
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((_resolve, reject) => {
          rejectScan = reject
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    // 走査中に編集し、破棄をキャンセルする
    act(() => result.current.updateFileContent('編集済み'))
    onConfirm.mockReturnValue(false)
    await act(async () => {
      rejectScan(new Error('走査失敗'))
      await folderPromise
    })
    expect(result.current.openFile?.content).toBe('編集済み')
  })

  it('同じバッチで多数のファイルが確定しても、履歴の追跡上限まで信号に残る', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('x')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      for (let i = 0; i < 12; i++) {
        await result.current.selectFile({
          name: `f${i}.ts`,
          path: `/project/f${i}.ts`,
          type: 'file'
        })
      }
    })
    expect(result.current.openedFileSignal.events).toHaveLength(12)
  })

  it('同じファイルを開き直しても信号のイベントは重複させない', async () => {
    // 件数だけで上限を切ると、重複を含んだ列が枠を埋めて中間の履歴が落ちる
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('x')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    const a: FileTreeNode = { name: 'a.ts', path: '/project/a.ts', type: 'file' }
    const b: FileTreeNode = { name: 'b.ts', path: '/project/b.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(a)
      await result.current.selectFile(b)
      await result.current.selectFile(a)
    })
    const events = result.current.openedFileSignal.events
    expect(events.map((e) => e.path)).toEqual(['/project/b.ts', '/project/a.ts'])
  })

  it('folderLoadError は走査の失敗でのみ立ち、CRUD の失敗では立たない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderLoadError).toBeNull()

    // CRUD の失敗では走査エラーにしない
    mockCreateFile.mockRejectedValueOnce(new Error('作成失敗'))
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    expect(result.current.error).not.toBeNull()
    expect(result.current.folderLoadError).toBeNull()

    // 走査の失敗では立つ
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockRejectedValue(new Error('走査失敗'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderLoadError?.message).toBe('走査失敗')
  })

  it('保存して元の内容へ戻した場合も破棄確認を行う', async () => {
    // content と path だけの比較だと「編集→保存→元に戻す」で変化なしと誤判定し、
    // 保存後の未保存編集を確認なしに破棄する
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('A')
    mockWriteFileContent.mockResolvedValue(undefined)
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    await act(async () => {
      await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
    })

    let resolveSecond: (content: string) => void = () => {}
    mockReadFileContent.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveSecond = resolve
        })
    )
    let secondPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      secondPromise = result.current.selectFile({
        name: 'App.tsx',
        path: '/project/src/App.tsx',
        type: 'file'
      })
    })
    // 待っている間に 編集 → 保存 → 元の内容へ戻す
    act(() => result.current.updateFileContent('B'))
    await act(async () => {
      await result.current.saveFile()
    })
    act(() => result.current.updateFileContent('A'))
    expect(result.current.isDirty).toBe(true)

    onConfirm.mockClear()
    await act(async () => {
      resolveSecond('const y = 2')
      await secondPromise
    })
    expect(onConfirm).toHaveBeenCalled()
    expect(result.current.openFile?.path).toBe('/project/src/index.ts')
  })

  it('保存中のファイルを削除するとき、書き込みの完了を待ってから削除する', async () => {
    // 書き込みが削除より後に解決すると、旧パスを再作成してファイルが復活する
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('A')
    mockDeleteEntry.mockResolvedValue(undefined)
    let finishWrite: () => void = () => {}
    mockWriteFileContent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(node)
    })
    act(() => result.current.updateFileContent('B'))
    act(() => {
      void result.current.saveFile()
    })

    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry(node)
    })
    await act(async () => {})
    // 書き込みが終わるまで削除は実行されない
    expect(mockDeleteEntry).not.toHaveBeenCalled()

    await act(async () => {
      finishWrite()
      await deletePromise
    })
    expect(mockDeleteEntry).toHaveBeenCalledWith('/project/src/index.ts')
  })

  it('確定後の取り直しに失敗したら、その内容を走査エラーとして扱う', async () => {
    mockCreateFile.mockResolvedValue(undefined)
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    let resolveScan: (t: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/other')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveScan = resolve
        })
    )
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    await act(async () => {
      await result.current.createFile('/other', 'b.ts')
    })

    mockReadDirectory.mockRejectedValue(new Error('取り直し失敗'))
    await act(async () => {
      resolveScan([])
      await folderPromise
    })
    expect(result.current.folderLoadError?.message).toBe('取り直し失敗')
  })

  it('削除の実行中に始めようとした保存は書き込みを行わない', async () => {
    // 待機後〜FS 操作完了までの間に保存が始まると、旧パスを再作成してしまう
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('A')
    mockWriteFileContent.mockResolvedValue(undefined)
    let finishDelete: () => void = () => {}
    mockDeleteEntry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(node)
    })

    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry(node)
    })
    await act(async () => {})

    // 削除の実行中に編集して保存しようとする
    act(() => result.current.updateFileContent('B'))
    await act(async () => {
      await result.current.saveFile()
    })
    expect(mockWriteFileContent).not.toHaveBeenCalled()

    await act(async () => {
      finishDelete()
      await deletePromise
    })
  })

  it('走査失敗後にフォルダ変更をキャンセルしてもエラーを消さない', async () => {
    // エラーだけ消えると、空のツリーを「一致するファイルがありません」と誤案内する
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockRejectedValue(new Error('走査失敗'))
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderLoadError?.message).toBe('走査失敗')

    mockOpenFolder.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderLoadError?.message).toBe('走査失敗')
  })

  it('CRUD 後の再読込に失敗したら走査エラーとして扱い、成功したら消す', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
    mockCreateFile.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    mockReadDirectory.mockRejectedValueOnce(new Error('再読込失敗'))
    await act(async () => {
      await result.current.createFile('/project', 'a.ts')
    })
    expect(result.current.folderLoadError?.message).toBe('再読込失敗')

    const tree: FileTreeNode[] = [{ name: 'a.ts', path: '/project/a.ts', type: 'file' }]
    mockReadDirectory.mockResolvedValue(tree)
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    expect(result.current.folderLoadError).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('重なるパスの FS 操作を直列化する', async () => {
    // 親ディレクトリの削除と子ファイルのリネームが並行すると、実行順によって
    // 誤った対象を操作したり、ツリーと実体が食い違ったりする
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
    const order: string[] = []
    let finishDelete: () => void = () => {}
    mockDeleteEntry.mockImplementationOnce(() => {
      order.push('delete:start')
      return new Promise<void>((resolve) => {
        finishDelete = () => {
          order.push('delete:end')
          resolve()
        }
      })
    })
    mockRenameEntry.mockImplementation(() => {
      order.push('rename:start')
      return Promise.resolve()
    })

    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    let deletePromise: Promise<void> = Promise.resolve()
    let renamePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry({
        name: 'src',
        path: '/project/src',
        type: 'directory'
      })
    })
    await act(async () => {})
    act(() => {
      renamePromise = result.current.renameEntry(
        { name: 'a.ts', path: '/project/src/a.ts', type: 'file' },
        'b.ts'
      )
    })
    await act(async () => {})
    // 削除が終わるまでリネームは始まらない
    expect(order).toEqual(['delete:start'])

    await act(async () => {
      finishDelete()
      await deletePromise
      await renamePromise
    })
    expect(order).toEqual(['delete:start', 'delete:end', 'rename:start'])
  })

  it('反映されなかった取り直しでは、現在のエラーを消さない', async () => {
    mockCreateFile.mockResolvedValue(undefined)
    mockOpenFolder.mockResolvedValue('/old')
    mockReadDirectory.mockResolvedValue([])
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })

    // A の走査を保留させ、その間に CRUD を完了させる
    let resolveA: (t: FileTreeNode[]) => void = () => {}
    mockOpenFolder.mockResolvedValue('/a')
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveA = resolve
        })
    )
    let aPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      aPromise = result.current.openFolder()
    })
    await act(async () => {
      await result.current.createFile('/old', 'x.ts')
    })

    // B が失敗して確定し、エラーが立つ
    mockOpenFolder.mockResolvedValue('/b')
    mockReadDirectory.mockRejectedValue(new Error('B の走査失敗'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error?.message).toBe('B の走査失敗')

    // A の取り直しは stale で反映されない。エラーを消してはいけない
    await act(async () => {
      resolveA([])
      await aPromise
    })
    expect(result.current.error?.message).toBe('B の走査失敗')
  })

  it('末尾のファイルを開き直しても信号の ID は前進する', async () => {
    // ID が再利用されると、消費側がイベント発生を検知できない
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('x')
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    const a: FileTreeNode = { name: 'a.ts', path: '/project/a.ts', type: 'file' }
    const b: FileTreeNode = { name: 'b.ts', path: '/project/b.ts', type: 'file' }
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile(a)
      await result.current.selectFile(b)
    })
    const idBefore = result.current.openedFileSignal.events.at(-1)?.id as number
    await act(async () => {
      await result.current.selectFile(b)
    })
    const idAfter = result.current.openedFileSignal.events.at(-1)?.id as number
    expect(idAfter).toBeGreaterThan(idBefore)
  })

  it('作成の実行中は重なる削除を待たせる', async () => {
    // 作成が mutex を通らないと、作成先の祖先の削除と並行して実行順依存になる
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
    const order: string[] = []
    let finishCreate: () => void = () => {}
    mockCreateFile.mockImplementationOnce(() => {
      order.push('create:start')
      return new Promise<void>((resolve) => {
        finishCreate = () => {
          order.push('create:end')
          resolve()
        }
      })
    })
    mockDeleteEntry.mockImplementation(() => {
      order.push('delete:start')
      return Promise.resolve()
    })
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    let createPromise: Promise<void> = Promise.resolve()
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      createPromise = result.current.createFile('/project/src', 'x.ts')
    })
    await act(async () => {})
    act(() => {
      deletePromise = result.current.deleteEntry({
        name: 'src',
        path: '/project/src',
        type: 'directory'
      })
    })
    await act(async () => {})
    expect(order).toEqual(['create:start'])
    await act(async () => {
      finishCreate()
      await createPromise
      await deletePromise
    })
    expect(order).toEqual(['create:start', 'create:end', 'delete:start'])
  })

  it('フォルダ選択をキャンセルしても、走査失敗のエラー表示を消さない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockRejectedValue(new Error('走査失敗'))
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error?.message).toBe('走査失敗')

    mockOpenFolder.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error?.message).toBe('走査失敗')
  })

  it('削除の待機中に入った未保存の編集を確認なしで破棄しない', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('A')
    mockDeleteEntry.mockResolvedValue(undefined)
    let finishWrite: () => void = () => {}
    mockWriteFileContent.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
    })
    const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
    await act(async () => {
      await result.current.selectFile(node)
    })
    // 保存を開始させ、削除がその完了を待つ状態にする
    act(() => result.current.updateFileContent('B'))
    act(() => {
      void result.current.saveFile()
    })
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry(node)
    })
    await act(async () => {})
    onConfirm.mockClear()
    // 待機中にさらに編集する
    act(() => result.current.updateFileContent('C'))
    await act(async () => {
      finishWrite()
      await deletePromise
    })
    // 追加の編集について確認している
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

  async function openAndSelect(result: {
    current: ReturnType<typeof useFileSystem>
  }): Promise<void> {
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
