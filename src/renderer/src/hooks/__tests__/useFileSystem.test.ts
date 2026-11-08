import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
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
  routeCheckedWritesToWriteFileContent()
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

  it('未保存のまま別ファイルを開いても破棄確認はしない(新規タブとして追加されるため)', async () => {
    // 複数タブ化により、別ファイルを開く操作は既存タブを破棄しない。よって確認は不要
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
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.openFile?.path).toBe('/project/src/App.tsx')
    expect(result.current.openFiles.map((f) => f.path)).toEqual([
      '/project/src/index.ts',
      '/project/src/App.tsx'
    ])
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

  it('走査の後のやり直しの途中に静かな読み直しを頼んでも、やり直しは反映し(applied)、走査の失敗のエラーを消す', async () => {
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

    // 2 回目のフォルダ走査を失敗させる(失敗の経路は setError の後に、抑止したやり直しを手動で行う)
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
    // 走査中にファイル作成が成功する(再読込は抑止される)
    await act(async () => {
      await result.current.createFile('/project', 'b.ts')
    })
    // 走査の後のやり直しの読み込みを止めておく
    let resolveRetry: (tree: FileTreeNode[]) => void = () => {}
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveRetry = resolve
        })
    )
    await act(async () => {
      rejectScan(new Error('走査失敗'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.error).not.toBeNull()
    const readsBeforeQuiet = mockReadDirectory.mock.calls.length
    // やり直しの途中に静かな読み直しが届く(手動を追い越さない)
    await act(async () => {
      await result.current.refreshTreeQuietly()
    })
    expect(mockReadDirectory.mock.calls.length).toBe(readsBeforeQuiet)
    mockReadDirectory.mockResolvedValue(afterCreate)
    await act(async () => {
      resolveRetry(afterCreate)
      await folderPromise
    })
    expect(result.current.fileTree).toEqual(afterCreate)
    expect(result.current.error).toBeNull()
  })

  it('isFolderScanPending → 走査の間だけ true', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    let resolveScan: (tree: FileTreeNode[]) => void = () => {}
    mockReadDirectory.mockImplementationOnce(
      () =>
        new Promise<FileTreeNode[]>((resolve) => {
          resolveScan = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem())
    expect(result.current.isFolderScanPending()).toBe(false)
    let folderPromise: Promise<void> = Promise.resolve()
    await act(async () => {
      folderPromise = result.current.openFolder()
    })
    expect(result.current.isFolderScanPending()).toBe(true)
    await act(async () => {
      resolveScan([])
      await folderPromise
    })
    expect(result.current.isFolderScanPending()).toBe(false)
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

  it('別ファイルの読み込み中と同じ tick に入った編集は、読み込み中のタブではなく元のアクティブタブに反映される', async () => {
    // スナップショットが layout effect 更新の ref を見ていると、同期ミラーだけが
    // 更新された編集を取りこぼし、別タブの読み込み中の内容へ誤って反映してしまう
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
    // 読み込み開始と編集を同じ tick でまとめて行う。読み込み中はまだ index.ts が
    // アクティブなので、この編集は index.ts に反映されるべきである
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
    // 複数タブ化により、別ファイルを開く操作は既存タブを破棄しないため確認は不要
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.activeFilePath).toBe('/project/src/App.tsx')
    expect(result.current.openFile?.content).toBe('const y = 2')
    const indexTab = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
    expect(indexTab?.content).toBe('編集済み')
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

  it('リネームの実行中は移行先への作成を待たせる', async () => {
    // 元の path だけを予約すると、移行先(同じ親の下)への作成と並行して走り、
    // どちらが先に完了するかで結果が変わる
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
    const order: string[] = []
    let finishRename: () => void = () => {}
    mockRenameEntry.mockImplementationOnce(() => {
      order.push('rename:start')
      return new Promise<void>((resolve) => {
        finishRename = () => {
          order.push('rename:end')
          resolve()
        }
      })
    })
    mockCreateFile.mockImplementation(() => {
      order.push('create:start')
      return Promise.resolve()
    })
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    let renamePromise: Promise<void> = Promise.resolve()
    let createPromise: Promise<void> = Promise.resolve()
    act(() => {
      renamePromise = result.current.renameEntry(
        { name: 'src', path: '/project/src', type: 'directory' },
        'src2'
      )
    })
    await act(async () => {})
    act(() => {
      createPromise = result.current.createFile('/project/src2', 'x.ts')
    })
    await act(async () => {})
    expect(order).toEqual(['rename:start'])
    await act(async () => {
      finishRename()
      await renamePromise
      await createPromise
    })
    expect(order).toEqual(['rename:start', 'rename:end', 'create:start'])
  })

  it('破棄確認をキャンセルしたらツリーを再読込しない', async () => {
    // 削除していないのに再読込が走ると、その失敗がエラー表示されたり
    // 不要な更新で別の状態を上書きしたりする
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    let releaseSave: () => void = () => {}
    mockWriteFileContent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve
        })
    )
    const confirmResults = [true, false]
    const onConfirm = vi.fn(() => confirmResults.shift() ?? true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile(mockTree[0].children![0])
    })
    // 保存を進行中にして削除をロック待ちにする
    act(() => result.current.updateFileContent('保存前の編集'))
    act(() => {
      void result.current.saveFile()
    })
    await act(async () => {})
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry(mockTree[0].children![0])
    })
    await act(async () => {})
    // ロック待ちの間に編集が入る
    act(() => {
      result.current.updateFileContent('編集済み')
    })
    const readsBefore = mockReadDirectory.mock.calls.length
    await act(async () => {
      releaseSave()
      await deletePromise
    })
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(mockDeleteEntry).not.toHaveBeenCalled()
    expect(mockReadDirectory.mock.calls.length).toBe(readsBefore)
  })

  it('ルート直下のリネーム中も重なる作成を待たせる', async () => {
    // 親が '/' になるため、正規化して空文字列にすると予約がどのパスとも
    // 重ならなくなり、ロックが素通りしてしまう
    mockOpenFolder.mockResolvedValue('/')
    mockReadDirectory.mockResolvedValue([])
    const order: string[] = []
    let finishRename: () => void = () => {}
    mockRenameEntry.mockImplementationOnce(() => {
      order.push('rename:start')
      return new Promise<void>((resolve) => {
        finishRename = () => {
          order.push('rename:end')
          resolve()
        }
      })
    })
    mockCreateFile.mockImplementation(() => {
      order.push('create:start')
      return Promise.resolve()
    })
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    let renamePromise: Promise<void> = Promise.resolve()
    let createPromise: Promise<void> = Promise.resolve()
    act(() => {
      renamePromise = result.current.renameEntry(
        { name: 'a.ts', path: '/a.ts', type: 'file' },
        'b.ts'
      )
    })
    await act(async () => {})
    act(() => {
      createPromise = result.current.createFile('/', 'x.ts')
    })
    await act(async () => {})
    expect(order).toEqual(['rename:start'])
    await act(async () => {
      finishRename()
      await renamePromise
      await createPromise
    })
    expect(order).toEqual(['rename:start', 'rename:end', 'create:start'])
  })

  it('ルート直下のリネーム中は重なる保存を開始させない', async () => {
    // 保存中の書き込みがリネーム後に解決すると、旧パスが再作成される
    mockOpenFolder.mockResolvedValue('/')
    mockReadDirectory.mockResolvedValue([{ name: 'a.ts', path: '/a.ts', type: 'file' }])
    mockReadFileContent.mockResolvedValue('const x = 1')
    const order: string[] = []
    let finishRename: () => void = () => {}
    mockRenameEntry.mockImplementationOnce(() => {
      order.push('rename:start')
      return new Promise<void>((resolve) => {
        finishRename = () => {
          order.push('rename:end')
          resolve()
        }
      })
    })
    mockWriteFileContent.mockImplementation(() => {
      order.push('save:start')
      return Promise.resolve()
    })
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile({ name: 'a.ts', path: '/a.ts', type: 'file' })
    })
    act(() => result.current.updateFileContent('編集済み'))
    let renamePromise: Promise<void> = Promise.resolve()
    act(() => {
      renamePromise = result.current.renameEntry(
        { name: 'a.ts', path: '/a.ts', type: 'file' },
        'b.ts'
      )
    })
    await act(async () => {})
    act(() => {
      void result.current.saveFile()
    })
    await act(async () => {})
    expect(order).toEqual(['rename:start'])
    await act(async () => {
      finishRename()
      await renamePromise
    })
  })

  it('先行ダイアログが遅れて返っても後発のフォルダ選択を上書きしない', async () => {
    // 古い試行のまま進むと走査の世代を進めてしまい、後発の結果が捨てられて
    // 古いフォルダが最終表示になる
    let resolveFirst: (path: string) => void = () => {}
    mockOpenFolder
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementation(() => Promise.resolve('/new'))
    const newTree: FileTreeNode[] = [{ name: 'new.ts', path: '/new/new.ts', type: 'file' }]
    mockReadDirectory.mockImplementation((target: string) =>
      Promise.resolve(target === '/new' ? newTree : [])
    )
    const { result } = renderHook(() => useFileSystem())
    let firstPromise: Promise<void> = Promise.resolve()
    act(() => {
      firstPromise = result.current.openFolder()
    })
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/new')
    await act(async () => {
      resolveFirst('/old')
      await firstPromise
    })
    expect(result.current.folderPath).toBe('/new')
    expect(result.current.fileTree).toEqual(newTree)
    expect(mockReadDirectory).not.toHaveBeenCalledWith('/old')
  })

  it('操作中にフォルダが切り替わったらツリーを取り直さない', async () => {
    // 旧フォルダで始まった CRUD が新フォルダのツリーやエラーを更新してしまう
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue([])
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
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry({
        name: 'a.ts',
        path: '/project/a.ts',
        type: 'file'
      })
    })
    await act(async () => {})
    // 削除の実行中にフォルダを切り替える
    mockOpenFolder.mockResolvedValue('/new')
    await act(async () => {
      await result.current.openFolder()
    })
    const readsBefore = mockReadDirectory.mock.calls.length
    await act(async () => {
      finishDelete()
      await deletePromise
    })
    expect(mockReadDirectory.mock.calls.length).toBe(readsBefore)
  })

  it('削除の実行中に入った編集も確認なしで破棄しない', async () => {
    // ロック待ちを抜けたあとも、IPC の解決までエディタは操作できる。
    // その間の編集を確認なしで捨てると、タブごと消えて変更が失われる
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    let finishDelete: () => void = () => {}
    mockDeleteEntry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve
        })
    )
    const confirmResults = [true, false]
    const onConfirm = vi.fn(() => confirmResults.shift() ?? true)
    const target = mockTree[0].children![0]
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile(target)
    })
    let deletePromise: Promise<void> = Promise.resolve()
    act(() => {
      deletePromise = result.current.deleteEntry(target)
    })
    await act(async () => {})
    // 削除の実行中(IPC 解決前)に編集が入る
    act(() => result.current.updateFileContent('編集済み'))
    await act(async () => {
      finishDelete()
      await deletePromise
    })
    expect(onConfirm).toHaveBeenCalledTimes(2)
    // 破棄を断ったので、編集内容は残す(保存すればファイルを作り直せる)
    expect(result.current.openFile?.content).toBe('編集済み')
  })

  it('Windows で大文字小文字だけ違うパスの削除でも開いているファイルを閉じる', async () => {
    // 正規化後に同一だと isPathInside は false を返すため、完全一致を含む
    // 判定を使わないと削除済みファイルのタブが残り、保存で復活してしまう
    const winTree: FileTreeNode[] = [{ name: 'a.ts', path: 'C:\\project\\a.ts', type: 'file' }]
    mockOpenFolder.mockResolvedValue('C:\\project')
    mockReadDirectory.mockResolvedValue(winTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    mockDeleteEntry.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile(winTree[0])
    })
    expect(result.current.openFile?.path).toBe('C:\\project\\a.ts')
    await act(async () => {
      // 表記だけ違う同じファイルを削除する
      await result.current.deleteEntry({ name: 'A.ts', path: 'C:\\Project\\A.ts', type: 'file' })
    })
    expect(result.current.openFile).toBeNull()
  })

  it('Windows で大文字小文字だけ違うパスのリネームでも開いているファイルが追随する', async () => {
    const winTree: FileTreeNode[] = [{ name: 'a.ts', path: 'C:\\project\\a.ts', type: 'file' }]
    mockOpenFolder.mockResolvedValue('C:\\project')
    mockReadDirectory.mockResolvedValue(winTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    mockRenameEntry.mockResolvedValue(undefined)
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile(winTree[0])
    })
    await act(async () => {
      await result.current.renameEntry(
        { name: 'A.ts', path: 'C:\\Project\\A.ts', type: 'file' },
        'b.ts'
      )
    })
    expect(result.current.openFile?.path).toBe('C:\\Project\\b.ts')
    expect(result.current.openFile?.name).toBe('b.ts')
  })

  it('Windows で表記だけ違うフォルダへ開き直してもツリーを取り直す', async () => {
    // 生の比較だと別フォルダとみなして再読込がスキップされ、先行走査の
    // 古いツリーが残ってしまう
    mockOpenFolder.mockResolvedValue('C:\\Project')
    mockReadDirectory.mockResolvedValue([])
    let finishCreate: () => void = () => {}
    mockCreateFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve
        })
    )
    const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
    await act(async () => {
      await result.current.openFolder()
    })
    let createPromise: Promise<void> = Promise.resolve()
    act(() => {
      createPromise = result.current.createFile('C:\\Project', 'x.ts')
    })
    await act(async () => {})
    // 同じ実体を表記違いで開き直す
    mockOpenFolder.mockResolvedValue('c:\\project')
    await act(async () => {
      await result.current.openFolder()
    })
    const readsBefore = mockReadDirectory.mock.calls.length
    await act(async () => {
      finishCreate()
      await createPromise
    })
    expect(mockReadDirectory.mock.calls.length).toBe(readsBefore + 1)
  })

  it('Windows で表記だけ違う同じファイルの信号は重複させない', async () => {
    // 重複が残ると上限 50 件を食い潰し、同一バッチで多数開いたときに
    // 別ファイルのイベントが処理前に押し出されて履歴が欠落する
    const winTree: FileTreeNode[] = [
      { name: 'a.ts', path: 'C:\\project\\a.ts', type: 'file' },
      { name: 'b.ts', path: 'C:\\project\\b.ts', type: 'file' }
    ]
    mockOpenFolder.mockResolvedValue('C:\\project')
    mockReadDirectory.mockResolvedValue(winTree)
    mockReadFileContent.mockResolvedValue('const x = 1')
    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
      await result.current.selectFile(winTree[0])
      await result.current.selectFile(winTree[1])
      // 表記だけ違う同じファイルを開き直す
      await result.current.selectFile({
        name: 'A.ts',
        path: 'C:\\Project\\A.ts',
        type: 'file'
      })
    })
    const paths = result.current.openedFileSignal.events.map((event) => event.path)
    expect(paths).toEqual(['C:\\project\\b.ts', 'C:\\Project\\A.ts'])
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

    it('未保存変更があっても selectFile は確認せずに別ファイルを新規タブとして開く', async () => {
      // 複数タブ化により、別ファイルを開く操作は既存タブを破棄しないため確認は不要
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openAndSelect(result)
      act(() => {
        result.current.updateFileContent('const x = 2')
      })
      mockReadFileContent.mockClear()
      mockReadFileContent.mockResolvedValue('package content')
      const otherNode: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }

      await act(async () => {
        await result.current.selectFile(otherNode)
      })

      expect(onConfirm).not.toHaveBeenCalled()
      expect(mockReadFileContent).toHaveBeenCalled()
      expect(result.current.openFile?.path).toBe('/project/package.json')
      const indexTab = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
      expect(indexTab?.content).toBe('const x = 2')
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

  describe('複数タブ管理', () => {
    it('新しいファイルを開くと openFiles に追加され、既存タブの内容は保持される', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }

      await act(async () => {
        await result.current.selectFile(fileA)
      })
      act(() => result.current.updateFileContent('編集済みA'))
      await act(async () => {
        await result.current.selectFile(fileB)
      })

      expect(result.current.openFiles.map((f) => f.path)).toEqual([
        '/project/src/a.ts',
        '/project/src/b.ts'
      ])
      expect(result.current.activeFilePath).toBe('/project/src/b.ts')
      const tabA = result.current.openFiles.find((f) => f.path === '/project/src/a.ts')
      expect(tabA?.content).toBe('編集済みA')
    })

    it('既に開いているファイルを再度選択すると、新規タブを作らずそのタブをアクティブ化する', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })

      await act(async () => {
        await result.current.selectFile(fileA)
      })

      expect(result.current.openFiles).toHaveLength(2)
      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(mockReadFileContent).toHaveBeenCalledTimes(2)
    })

    it('別ファイルを開いても既存タブが dirty でも確認しない(内容は保持されるため)', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await act(async () => {
        await result.current.openFolder()
      })
      onConfirm.mockClear()
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      act(() => result.current.updateFileContent('編集済みA'))

      await act(async () => {
        await result.current.selectFile(fileB)
      })

      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('openFolder はいずれかのタブが dirty なら破棄確認する', async () => {
      mockOpenFolder.mockResolvedValueOnce('/project').mockResolvedValueOnce('/other')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      act(() => result.current.updateFileContent('編集済みA'))
      onConfirm.mockClear()

      await act(async () => {
        await result.current.openFolder()
      })

      expect(onConfirm).toHaveBeenCalled()
      expect(result.current.openFiles).toEqual([])
    })

    it('activateTab: 存在するタブへ activeFilePath を切り替える', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      expect(result.current.activeFilePath).toBe('/project/src/b.ts')

      act(() => result.current.activateTab('/project/src/a.ts'))

      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(result.current.openFile?.path).toBe('/project/src/a.ts')
      // タブの集合や順序は変えない
      expect(result.current.openFiles.map((f) => f.path)).toEqual([
        '/project/src/a.ts',
        '/project/src/b.ts'
      ])
    })

    it('activateTab: 存在しない path を渡しても何も起きない', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })

      let activated: boolean | undefined
      act(() => {
        activated = result.current.activateTab('/project/src/does-not-exist.ts')
      })

      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(result.current.openFiles).toHaveLength(1)
      // 呼び出し元(useAppState の diff タブ非アクティブ化ラッパー)が
      // 「切り替えが起きなかった」ことを判別できないと、実ファイルタブは
      // 変わらないのに diff タブだけ非アクティブになり、どちらも表示されない
      // 状態になってしまう
      expect(activated).toBe(false)
    })

    it('activateTab: 存在する path を渡した場合は true を返す', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValue('const a = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })

      let activated: boolean | undefined
      act(() => {
        activated = result.current.activateTab('/project/src/a.ts')
      })
      expect(activated).toBe(true)
    })

    it('activateTab: resetForFileChange により切り替え後に saveError がクリアされる', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      // b.ts をアクティブなまま保存を失敗させ、saveError を立てておく
      act(() => result.current.updateFileContent('編集済みB'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      act(() => result.current.activateTab('/project/src/a.ts'))

      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(result.current.saveError).toBeNull()
    })

    it('closeTab: dirty でないタブは確認せずに閉じ、アクティブなら右隣のタブに切り替わる', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent
        .mockResolvedValueOnce('const a = 1')
        .mockResolvedValueOnce('const b = 2')
        .mockResolvedValueOnce('const c = 3')
      const onConfirm = vi.fn().mockReturnValue(true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      const fileC: FileTreeNode = { name: 'c.ts', path: '/project/src/c.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      await act(async () => {
        await result.current.selectFile(fileC)
      })
      act(() => result.current.activateTab('/project/src/b.ts'))
      onConfirm.mockClear()

      act(() => result.current.closeTab('/project/src/b.ts'))

      expect(onConfirm).not.toHaveBeenCalled()
      expect(result.current.openFiles.map((f) => f.path)).toEqual([
        '/project/src/a.ts',
        '/project/src/c.ts'
      ])
      expect(result.current.activeFilePath).toBe('/project/src/c.ts')
    })

    it('closeTab: 最後のタブを閉じるとアクティブファイルが null になる(Welcome表示)', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })

      act(() => result.current.closeTab('/project/src/a.ts'))

      expect(result.current.openFiles).toEqual([])
      expect(result.current.activeFilePath).toBeNull()
    })

    it('closeTab: dirty なタブを閉じようとすると確認し、拒否されたら閉じない', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const onConfirm = vi.fn().mockReturnValue(false)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      act(() => result.current.updateFileContent('編集済み'))

      act(() => result.current.closeTab('/project/src/a.ts'))

      expect(onConfirm).toHaveBeenCalled()
      expect(result.current.openFiles).toHaveLength(1)
    })

    it('closeTab: 非アクティブなタブを閉じても resetForFileChange が呼ばれない(アクティブタブの saveError が残る)', async () => {
      // wasActive の判定を setOpenFilesAndFixActive の呼び出し後に行うよう誤って
      // 入れ替えると、非アクティブなタブを閉じただけでアクティブタブの saveError が
      // 誤ってクリアされてしまう。resetForFileChange 自体はスパイできないため、
      // その効果(saveError のクリア)が起きていないことで間接的に検証する
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      // a.ts をアクティブに戻し、保存を失敗させて saveError を立てておく
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      // 非アクティブな b.ts を閉じる(dirty ではないため確認は不要)
      act(() => result.current.closeTab('/project/src/b.ts'))

      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/a.ts'])
      // 非アクティブタブを閉じても resetForFileChange は呼ばれないため、
      // アクティブタブ(a.ts)の saveError はクリアされず残り続ける
      expect(result.current.saveError?.message).toBe('EACCES')
    })

    it('closeTab: 読み込み保留中のパスと同名にリネームされたアクティブタブを閉じた場合、保留中読み込みが無効化される', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('content of b')
      mockRenameEntry.mockResolvedValue(undefined)

      const { result } = renderHook(() => useFileSystem())
      await act(async () => {
        await result.current.openFolder()
        await result.current.selectFile({
          name: 'b.ts',
          path: '/project/src/b.ts',
          type: 'file'
        })
      })

      // index.ts の読み込みを開始(保留状態)
      let resolveRead!: (content: string) => void
      mockReadFileContent.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveRead = resolve
          })
      )
      let openPromise: Promise<boolean> | null = null
      act(() => {
        openPromise = result.current.selectFile({
          name: 'index.ts',
          path: '/project/src/index.ts',
          type: 'file'
        })
      })

      // アクティブな b.ts を index.ts にリネーム
      await act(async () => {
        await result.current.renameEntry(
          { name: 'b.ts', path: '/project/src/b.ts', type: 'file' },
          'index.ts'
        )
      })

      // リネームによってアクティブかつパスが一致した index.ts タブを閉じる
      act(() => {
        result.current.closeTab('/project/src/index.ts')
      })

      // 遅れて index.ts の読み込みが解決
      await act(async () => {
        resolveRead('content of index')
        await openPromise
      })

      // タブは復活しない
      expect(result.current.openFiles).toEqual([])
      expect(result.current.activeFilePath).toBeNull()
    })

    it('selectFile: 同じパスの保存が進行中の場合、保存完了を待ってから読み込む', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValue('const a = 1')
      let resolveWrite!: () => void
      mockWriteFileContent.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const onConfirm = vi.fn(() => true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await act(async () => {
        await result.current.openFolder()
        await result.current.selectFile({
          name: 'index.ts',
          path: '/project/src/index.ts',
          type: 'file'
        })
      })

      // 初回読み込みで 1 回呼ばれている
      expect(mockReadFileContent).toHaveBeenCalledTimes(1)

      act(() => {
        result.current.updateFileContent('modified')
      })

      // 保存を開始(write は pending)
      let savePromise: Promise<void> | null = null
      act(() => {
        savePromise = result.current.saveFile()
      })

      // タブを閉じる
      act(() => {
        result.current.closeTab('/project/src/index.ts')
      })
      expect(result.current.openFiles).toEqual([])

      // 保存が未完了のまま再度開く
      let openPromise: Promise<boolean> | null = null
      act(() => {
        openPromise = result.current.selectFile({
          name: 'index.ts',
          path: '/project/src/index.ts',
          type: 'file'
        })
      })

      // 保存待機中は呼び出し回数が増えない（未完了の保存を待っているため再読み込みに進まない）
      expect(mockReadFileContent).toHaveBeenCalledTimes(1)

      // 保存を完了させる
      let openResult: boolean | null | undefined
      await act(async () => {
        resolveWrite()
        await savePromise
        openResult = await openPromise
      })

      expect(openResult).toBe(true)
      // 保存解決後に再読み込みが行われる
      expect(mockReadFileContent).toHaveBeenCalledTimes(2)
      expect(result.current.openFile?.path).toBe('/project/src/index.ts')
    })

    it('deleteEntry: 非アクティブなファイルを削除しても、アクティブタブの saveError は残る', async () => {
      // closeTab の wasActive ゲートと同じ理由で、renameEntry/deleteEntry も
      // 「影響を受けたのがアクティブなタブかどうか」で clearStaleSaveState
      // (resetForFileChange 経由)を呼ぶかどうかを分ける必要がある。ここでは
      // 実際の useFileEditing/useFileTreeOperations の結線を通した統合テストとして、
      // 非アクティブな b.ts を削除しても、アクティブな a.ts の saveError が
      // 誤ってクリアされないことを検証する
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      mockDeleteEntry.mockResolvedValue(undefined)
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      // a.ts をアクティブに戻し、保存を失敗させて saveError を立てておく
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      // 非アクティブな b.ts を削除する
      await act(async () => {
        await result.current.deleteEntry(fileB)
      })

      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/a.ts'])
      // 無関係な非アクティブファイルの削除で、アクティブタブ(a.ts)の saveError が
      // 誤ってクリアされてはいけない
      expect(result.current.saveError?.message).toBe('EACCES')
    })

    it('deleteEntry: ディレクトリ削除で複数タブが同時に消える場合、アクティブタブの直後に生き残ったタブへ移る(1つ飛び越えない)', async () => {
      // computeAdjacentItem は「1つの要素が削除された」ことを前提に、削除位置の
      // 要素(1つ削除後にその位置へ来る要素 = 右隣)を返す設計。ディレクトリ削除は
      // 配下の複数タブ(b.ts と c.ts)を1回の setOpenFiles 呼び出しで同時に取り除くため、
      // prevIndex(削除前の c.ts の位置)を基準に next へ素朴に適用すると、
      // 本来隣接するはずの d.ts を飛び越して e.ts が選ばれてしまう
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent
        .mockResolvedValueOnce('a')
        .mockResolvedValueOnce('b')
        .mockResolvedValueOnce('c')
        .mockResolvedValueOnce('d')
        .mockResolvedValueOnce('e')
      mockDeleteEntry.mockResolvedValue(undefined)
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/dir/b.ts', type: 'file' }
      const fileC: FileTreeNode = { name: 'c.ts', path: '/project/dir/c.ts', type: 'file' }
      const fileD: FileTreeNode = { name: 'd.ts', path: '/project/d.ts', type: 'file' }
      const fileE: FileTreeNode = { name: 'e.ts', path: '/project/e.ts', type: 'file' }
      for (const file of [fileA, fileB, fileC, fileD, fileE]) {
        await act(async () => {
          await result.current.selectFile(file)
        })
      }
      // c.ts をアクティブにする(dir 配下、削除される2ファイルのうち後ろ側)
      act(() => result.current.activateTab('/project/dir/c.ts'))
      expect(result.current.activeFilePath).toBe('/project/dir/c.ts')

      // ディレクトリ 'dir' を削除する(b.ts と c.ts が1回の更新で同時に消える)
      await act(async () => {
        await result.current.deleteEntry({ name: 'dir', path: '/project/dir', type: 'directory' })
      })

      expect(result.current.openFiles.map((f) => f.path)).toEqual([
        '/project/a.ts',
        '/project/d.ts',
        '/project/e.ts'
      ])
      // e.ts(1つ飛び越えた先)ではなく、直後に生き残った d.ts へ移る
      expect(result.current.activeFilePath).toBe('/project/d.ts')
    })

    it('保存の書き込み中にタブを切り替えても、完了後に元タブの savedContent が更新される', async () => {
      // activateTab が resetForFileChange(generation を進める) を呼んでいた頃は、
      // 切り替え前のタブに対する保存が「もう無関係な世代」と誤判定され、
      // 完了しても savedContent が更新されずタブが dirty のまま残っていた
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))

      let savePromise: Promise<void> = Promise.resolve()
      act(() => {
        savePromise = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      // 書き込みが完了する前に別タブへ切り替える
      act(() => result.current.activateTab('/project/src/b.ts'))

      await act(async () => {
        resolveWrite()
        await savePromise
      })

      act(() => result.current.activateTab('/project/src/a.ts'))

      expect(result.current.openFile?.path).toBe('/project/src/a.ts')
      expect(result.current.openFile?.content).toBe('編集済みA')
      expect(result.current.openFile?.savedContent).toBe('編集済みA')
    })

    it('FS操作のロック待ち中にタブを切り替えても、保存は破棄されず書き込まれる', async () => {
      // activateTab が generation を進めていた頃は、ロック待ちループの
      // 「generation !== generationRef.current」判定で保存が黙って return され、
      // 書き込み自体が行われずデータが失われていた
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockResolvedValue(undefined)
      let resolveCreate: () => void = () => {}
      mockCreateFile.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveCreate = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))

      // 同じフォルダ(親: /project/src)への作成が、a.ts の保存をブロックする
      // (作成対象自身ではないので無効化はされず、完了を待ってから書き込む)
      let createPromise: Promise<void> = Promise.resolve()
      await act(async () => {
        createPromise = result.current.createFile('/project/src', 'new.ts')
        // ロック取得 → createFile の IPC 呼び出しが実際に始まるところまで進める
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(mockCreateFile).toHaveBeenCalled()

      let savePromise: Promise<void> = Promise.resolve()
      await act(async () => {
        savePromise = result.current.saveFile()
        await Promise.resolve()
      })
      expect(mockWriteFileContent).not.toHaveBeenCalled()

      // ロック待ちの間に別タブへ切り替える
      act(() => result.current.activateTab('/project/src/b.ts'))

      await act(async () => {
        resolveCreate()
        await Promise.all([createPromise, savePromise])
      })

      expect(mockWriteFileContent).toHaveBeenCalledWith('/project/src/a.ts', '編集済みA')
    })

    it('新しいファイルを開いても、別タブの保存中の内容は破棄されずに反映される', async () => {
      // generationRef が単一のグローバルカウンタだった頃は、無関係な新規タブを開くだけで
      // 全タブの世代が進み、保存中だった別タブの savedContent 反映がスキップされていた
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const c = 3')
      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileC: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      act(() => result.current.updateFileContent('編集済みA'))

      let savePromise: Promise<void> = Promise.resolve()
      act(() => {
        savePromise = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      // 保存が完了する前に、それまで一度も開いていない新規ファイル C を開く
      await act(async () => {
        await result.current.selectFile(fileC)
      })

      await act(async () => {
        resolveWrite()
        await savePromise
      })

      act(() => result.current.activateTab('/project/src/a.ts'))
      expect(result.current.openFile?.content).toBe('編集済みA')
      expect(result.current.openFile?.savedContent).toBe('編集済みA')
    })

    it('別のタブを閉じても、残るタブの保存中の内容は破棄されずに反映される', async () => {
      // generationRef が単一のグローバルカウンタだった頃は、アクティブなタブを
      // 閉じるだけで全タブの世代が進み、無関係な別タブの保存中だった内容の反映が
      // スキップされていた
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))

      let savePromise: Promise<void> = Promise.resolve()
      act(() => {
        savePromise = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      // 保存完了前に、b.ts をアクティブ化してから閉じる(閉じるタブ自身がアクティブな
      // ケースを再現する。非アクティブなタブを閉じても resetForFileChange 自体が
      // 呼ばれないため、このケースでは再現しない)
      act(() => result.current.activateTab('/project/src/b.ts'))
      act(() => result.current.closeTab('/project/src/b.ts'))

      await act(async () => {
        resolveWrite()
        await savePromise
      })

      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/a.ts'])
      expect(result.current.openFile?.path).toBe('/project/src/a.ts')
      expect(result.current.openFile?.content).toBe('編集済みA')
      expect(result.current.openFile?.savedContent).toBe('編集済みA')
    })

    it('FS操作のロック待ち中に新しいファイルを開いても、別タブの保存は破棄されない', async () => {
      // generationRef が単一のグローバルカウンタだった頃は、ロック待ち中に無関係な
      // 新規タブを開くだけで「generation !== generationRef.current」判定が発火し、
      // 書き込み自体が行われずデータが失われていた
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent
        .mockResolvedValueOnce('const a = 1')
        .mockResolvedValueOnce('const b = 2')
        .mockResolvedValueOnce('const c = 3')
      mockWriteFileContent.mockResolvedValue(undefined)
      let resolveCreate: () => void = () => {}
      mockCreateFile.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveCreate = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      const fileC: FileTreeNode = {
        name: 'package.json',
        path: '/project/package.json',
        type: 'file'
      }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))

      // 同じフォルダ(親: /project/src)への作成が、a.ts の保存をブロックする
      let createPromise: Promise<void> = Promise.resolve()
      await act(async () => {
        createPromise = result.current.createFile('/project/src', 'new.ts')
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(mockCreateFile).toHaveBeenCalled()

      let savePromise: Promise<void> = Promise.resolve()
      await act(async () => {
        savePromise = result.current.saveFile()
        await Promise.resolve()
      })
      expect(mockWriteFileContent).not.toHaveBeenCalled()

      // ロック待ちの間に、それまで一度も開いていない新規ファイル C を開く
      await act(async () => {
        await result.current.selectFile(fileC)
      })

      await act(async () => {
        resolveCreate()
        await Promise.all([createPromise, savePromise])
      })

      expect(mockWriteFileContent).toHaveBeenCalledWith('/project/src/a.ts', '編集済みA')
    })

    it('別ファイルをリネームしても、保存中の別タブの内容は破棄されずに反映される', async () => {
      // generationRef が単一のグローバルカウンタだった頃は、リネーム対象自身が
      // アクティブタブになっている場合に(activeAffected 経由で)全タブの世代が
      // 進み、無関係な別タブ(保存中に非アクティブへ回った A)の savedContent 反映が
      // スキップされていた。そのため、A を保存開始した後にアクティブタブを
      // リネーム対象(B)へ切り替えてからリネームする(non-active な B をリネーム
      // しても旧コードは activeAffected=false でバグを再現しない)
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('{}')
      mockRenameEntry.mockResolvedValue(undefined)
      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      // 別のディレクトリに置くことで、リネームの親ディレクトリロック(dirB)が
      // a.ts の保存(dirA 配下)を待ってしまわないようにする
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/dirA/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.json', path: '/project/dirB/b.json', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      act(() => result.current.activateTab('/project/dirA/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))

      let savePromise: Promise<void> = Promise.resolve()
      act(() => {
        savePromise = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      // 保存完了前に、アクティブタブを b.json へ切り替えてからリネームする
      act(() => result.current.activateTab('/project/dirB/b.json'))
      await act(async () => {
        await result.current.renameEntry(fileB, 'renamed.json')
      })

      await act(async () => {
        resolveWrite()
        await savePromise
      })

      act(() => result.current.activateTab('/project/dirA/a.ts'))
      expect(result.current.openFile?.content).toBe('編集済みA')
      expect(result.current.openFile?.savedContent).toBe('編集済みA')
    })

    it('reorderTabs: タブの並び順を入れ替える', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent
        .mockResolvedValueOnce('const a = 1')
        .mockResolvedValueOnce('const b = 2')
        .mockResolvedValueOnce('const c = 3')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      for (const name of ['a', 'b', 'c']) {
        await act(async () => {
          await result.current.selectFile({
            name: `${name}.ts`,
            path: `/project/src/${name}.ts`,
            type: 'file'
          })
        })
      }

      act(() => result.current.reorderTabs(0, 2))

      expect(result.current.openFiles.map((f) => f.path)).toEqual([
        '/project/src/b.ts',
        '/project/src/c.ts',
        '/project/src/a.ts'
      ])
      // アクティブファイルは変わらない
      expect(result.current.activeFilePath).toBe('/project/src/c.ts')
    })

    it('reorderTabs: 範囲外のインデックスが指定された場合は何もしない', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValue('const a = 1')
      const { result } = renderHook(() => useFileSystem())
      await act(async () => {
        await result.current.openFolder()
        await result.current.selectFile({
          name: 'index.ts',
          path: '/project/src/index.ts',
          type: 'file'
        })
      })

      act(() => {
        result.current.reorderTabs(-1, 0)
        result.current.reorderTabs(0, -1)
        result.current.reorderTabs(10, 0)
        result.current.reorderTabs(0, 10)
      })

      expect(result.current.openFiles).toHaveLength(1)
    })

    it('Windows形式パスの大文字小文字のみのリネームでも activeFilePath が新しい表記と厳密に一致する', async () => {
      // isSamePath は Windows 形式のパスを大文字小文字を無視して比較するため、
      // 大文字小文字だけが変わるリネームでは「見つかった」まま activeFilePath の
      // 表記が更新されずに残っていた。EditorPanel/EditorTabs は openFiles の path と
      // activeFilePath を厳密な === で突き合わせるため、表記が食い違うと
      // アクティブなタブが見つからず Welcome 画面に落ちてしまう
      const winTree: FileTreeNode[] = [
        { name: 'README.md', path: 'C:\\project\\README.md', type: 'file' }
      ]
      mockOpenFolder.mockResolvedValue('C:\\project')
      mockReadDirectory.mockResolvedValue(winTree)
      mockReadFileContent.mockResolvedValue('# hello')
      mockRenameEntry.mockResolvedValue(undefined)
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const node: FileTreeNode = { name: 'README.md', path: 'C:\\project\\README.md', type: 'file' }
      await act(async () => {
        await result.current.selectFile(node)
      })
      expect(result.current.activeFilePath).toBe('C:\\project\\README.md')

      await act(async () => {
        await result.current.renameEntry(node, 'readme.md')
      })

      expect(result.current.activeFilePath).toBe('C:\\project\\readme.md')
      expect(result.current.openFile).not.toBeNull()
      expect(result.current.openFile?.path).toBe('C:\\project\\readme.md')
    })

    it('reorderTabs: 同じ tick内で続けて別の操作を呼んでも並び替えが失われない(ミラー同期の不変条件)', async () => {
      // reorderTabs が commitOpenFile/setOpenFilesAndFixActive と異なり、
      // functional updater のコールバック内でミラーを更新する実装のままだと、
      // 同じ tick で後続する closeTab が読む openFilesMirrorRef が並び替え前の
      // ままになり、closeTab 側の setOpenFiles(plain array) がそれを最終状態として
      // 上書きしてしまう(=並び替えが黙って失われる)
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent
        .mockResolvedValueOnce('const a = 1')
        .mockResolvedValueOnce('const b = 2')
        .mockResolvedValueOnce('const c = 3')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      for (const name of ['a', 'b', 'c']) {
        await act(async () => {
          await result.current.selectFile({
            name: `${name}.ts`,
            path: `/project/src/${name}.ts`,
            type: 'file'
          })
        })
      }
      act(() => result.current.activateTab('/project/src/b.ts'))

      // reorderTabs と closeTab を同じ tick(同じ act 呼び出し)内で連続して呼ぶ
      act(() => {
        result.current.reorderTabs(0, 2) // [a,b,c] -> [b,c,a]
        result.current.closeTab('/project/src/b.ts') // アクティブな b を閉じる
      })

      // 並び替え後の [b,c,a] から b を除いた [c,a] になっているべき
      expect(result.current.openFiles.map((f) => f.path)).toEqual([
        '/project/src/c.ts',
        '/project/src/a.ts'
      ])
      // 並び替え後の右隣(c)がアクティブになる
      expect(result.current.activeFilePath).toBe('/project/src/c.ts')
    })
  })

  describe('reloadOpenFiles', () => {
    // git checkout 等、アプリ外(gitコマンド)から working tree が書き換わった後、
    // 開いている全タブのバッファをディスクの最新内容へ同期するために使う
    // (useAppState.ts の checkoutBranch ラッパーが呼ぶ)

    it('開いている全タブの content/savedContent をディスクの最新内容で更新する(dirty も解消する)', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const x = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(node)
      })
      act(() => result.current.updateFileContent('未保存の編集'))
      expect(result.current.isDirty).toBe(true)

      mockReadFileContent.mockResolvedValueOnce('feature/x 側の内容')
      await act(async () => {
        await result.current.reloadOpenFiles()
      })

      expect(result.current.openFile?.content).toBe('feature/x 側の内容')
      expect(result.current.isDirty).toBe(false)
    })

    it('アクティブでないタブも更新する', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
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
      await act(async () => {
        await result.current.selectFile({
          name: 'App.tsx',
          path: '/project/src/App.tsx',
          type: 'file'
        })
      })
      // 先に開いた index.ts が今は非アクティブ
      expect(result.current.activeFilePath).toBe('/project/src/App.tsx')

      mockReadFileContent.mockResolvedValueOnce('a 更新後').mockResolvedValueOnce('b 更新後')
      await act(async () => {
        await result.current.reloadOpenFiles()
      })

      const indexTab = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
      expect(indexTab?.content).toBe('a 更新後')
    })

    it('読み込みに失敗したタブ(checkout でファイル自体が無くなった等)は閉じる', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const x = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
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

      mockReadFileContent.mockRejectedValueOnce(new Error('ENOENT'))
      await act(async () => {
        await result.current.reloadOpenFiles()
      })

      expect(result.current.openFiles).toHaveLength(0)
      expect(result.current.openFile).toBeNull()
    })

    it('開いているタブが無ければ何もしない(readFileContent を呼ばない)', async () => {
      const { result } = renderHook(() => useFileSystem())
      await act(async () => {
        await result.current.reloadOpenFiles()
      })
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })
  })

  describe('reloadOpenFile / closeTabsAtOrInside / hasDirtyTabAtOrInside', () => {
    // 変更の取り消し(useDiscardFileChanges)が、対象ファイルのタブだけを同期するために使う。
    // 全タブを対象にする reloadOpenFiles と違い、対象外のタブの未保存の編集を保持する
    const openTwoFiles = async (result: {
      current: ReturnType<typeof useFileSystem>
    }): Promise<void> => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('{}')
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
      act(() => result.current.updateFileContent('index の未保存の編集'))
      await act(async () => {
        await result.current.selectFile({
          name: 'package.json',
          path: '/project/package.json',
          type: 'file'
        })
      })
      act(() => result.current.updateFileContent('package の未保存の編集'))
    }

    it('reloadOpenFile は対象のタブだけをディスクの内容で更新し、他のタブの編集は残す', async () => {
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await openTwoFiles(result)
      mockReadFileContent.mockResolvedValueOnce('const a = 0 // 取り消し後')
      await act(async () => {
        await result.current.reloadOpenFile('/project/src/index.ts')
      })
      const index = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
      const pkg = result.current.openFiles.find((f) => f.path === '/project/package.json')
      expect(index?.content).toBe('const a = 0 // 取り消し後')
      expect(index?.savedContent).toBe('const a = 0 // 取り消し後')
      expect(pkg?.content).toBe('package の未保存の編集')
      expect(mockReadFileContent).toHaveBeenLastCalledWith('/project/src/index.ts')
    })

    it('reloadOpenFile で読み込みに失敗したら、そのタブを閉じる', async () => {
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await openTwoFiles(result)
      mockReadFileContent.mockRejectedValueOnce(new Error('ENOENT'))
      await act(async () => {
        await result.current.reloadOpenFile('/project/src/index.ts')
      })
      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/package.json'])
    })

    it('reloadOpenFile は開いていないパスでは何も読み込まない', async () => {
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await openTwoFiles(result)
      mockReadFileContent.mockClear()
      await act(async () => {
        await result.current.reloadOpenFile('/project/other.ts')
      })
      expect(mockReadFileContent).not.toHaveBeenCalled()
    })

    it('closeTabsAtOrInside はそのパス自身と配下のタブを確認なしで閉じる', async () => {
      const onConfirm = vi.fn(() => true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      await openTwoFiles(result)
      onConfirm.mockClear()
      act(() => result.current.closeTabsAtOrInside('/project/src'))
      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/package.json'])
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('hasDirtyTabAtOrInside はそのパス自身か配下の未保存の編集を検出する', async () => {
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await openTwoFiles(result)
      expect(result.current.hasDirtyTabAtOrInside('/project/src/index.ts')).toBe(true)
      expect(result.current.hasDirtyTabAtOrInside('/project/src')).toBe(true)
      expect(result.current.hasDirtyTabAtOrInside('/project/other.ts')).toBe(false)
    })

    it('hasDirtyTabAtOrInside は未保存の編集が無いタブでは false を返す', async () => {
      // f.content !== f.savedContent の判定を外して isPathAtOrInside だけの判定に
      // 弱めても、上の「未保存の編集を検出する」テストは dirty なタブしか見ていない
      // ため気づけない。開いているが編集していない(クリーンな)タブで検出する
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
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
      expect(result.current.hasDirtyTabAtOrInside('/project/src/index.ts')).toBe(false)
      expect(result.current.hasDirtyTabAtOrInside('/project/src')).toBe(false)
    })

    it('closeTabsAtOrInside: アクティブなタブを閉じると残りのタブへアクティブが移る', async () => {
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await openTwoFiles(result)
      // openTwoFiles は package.json を最後に選択するため、それがアクティブになっている
      expect(result.current.activeFilePath).toBe('/project/package.json')

      act(() => result.current.closeTabsAtOrInside('/project/package.json'))

      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/index.ts'])
      expect(result.current.activeFilePath).toBe('/project/src/index.ts')
    })

    it('closeTabsAtOrInside: アクティブなタブを閉じると saveError がクリアされる', async () => {
      // resetForFileChange(clearStaleSaveState を伴う)を呼ばずに閉じるだけだと、
      // 別ファイルの保存失敗で立った saveError が古いまま残り続けてしまう
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
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
      act(() => result.current.updateFileContent('編集済み'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      act(() => result.current.closeTabsAtOrInside('/project/src'))

      expect(result.current.saveError).toBeNull()
    })

    it('closeTabsAtOrInside: 非アクティブなタブを閉じても、アクティブなタブの saveError は残る', async () => {
      // wasActive 相当のゲートが無いと、無関係な非アクティブファイルを閉じただけで
      // アクティブタブの saveError まで誤ってクリアされてしまう(closeTab の
      // wasActive ゲートと同じ懸念)
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      // a.ts をアクティブに戻し、保存を失敗させて saveError を立てておく
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      // 非アクティブな b.ts だけを閉じる
      act(() => result.current.closeTabsAtOrInside('/project/src/b.ts'))

      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/a.ts'])
      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(result.current.saveError?.message).toBe('EACCES')
    })

    it('closeTabsAtOrInside: 読み込み中だったファイルを閉じたら、その結果を表示しない', async () => {
      // 選択(selectFile)がまだタブとして確定していない段階でも、保留中の読み込みを
      // 無効化しないと、ゴミ箱へ移した後に読み込みが解決してタブとして開いてしまう
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      let resolveRead: (content: string) => void = () => {}
      mockReadFileContent.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveRead = resolve
          })
      )
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const node: FileTreeNode = { name: 'index.ts', path: '/project/src/index.ts', type: 'file' }
      let readPromise: Promise<boolean> = Promise.resolve(false)
      act(() => {
        readPromise = result.current.selectFile(node)
      })

      act(() => result.current.closeTabsAtOrInside('/project/src'))

      await act(async () => {
        resolveRead('const x = 1')
        await readPromise
      })
      expect(result.current.openFile).toBeNull()
      expect(result.current.openFiles).toEqual([])
    })

    it('reloadOpenFile: アクティブなタブを取り消すと saveError がクリアされる', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
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
      act(() => result.current.updateFileContent('編集済み'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      mockReadFileContent.mockResolvedValueOnce('const a = 0 // 取り消し後')
      await act(async () => {
        await result.current.reloadOpenFile('/project/src/index.ts')
      })

      expect(result.current.saveError).toBeNull()
    })

    it('reloadOpenFile: 非アクティブなタブを取り消しても、アクティブなタブの saveError は残る', async () => {
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      // a.ts をアクティブに戻し、保存を失敗させて saveError を立てておく
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      // 非アクティブな b.ts だけを取り消す
      mockReadFileContent.mockResolvedValueOnce('b 取り消し後')
      await act(async () => {
        await result.current.reloadOpenFile('/project/src/b.ts')
      })

      expect(result.current.activeFilePath).toBe('/project/src/a.ts')
      expect(result.current.saveError?.message).toBe('EACCES')
    })

    it('reloadOpenFile: アクティブなタブの読み込みが失敗して閉じても、隣接タブへ移った後に saveError がクリアされる', async () => {
      // activePath は setOpenFilesAndFixActive を呼ぶ前(=対象タブがまだアクティブな
      // 時点)で捕まえる必要がある。呼んだ後だと、読み込み失敗でタブが閉じられて
      // activeFilePathMirrorRef が隣接タブ(b.ts)へ既に書き換わっており、
      // invalidateSaveStateOfTab が「非アクティブなタブへの操作」と誤判定して
      // resetForFileChange(clearStaleSaveState を伴う)を呼ばず、saveError が
      // 残ってしまう
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1').mockResolvedValueOnce('const b = 2')
      mockWriteFileContent.mockRejectedValue(new Error('EACCES'))
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      const fileB: FileTreeNode = { name: 'b.ts', path: '/project/src/b.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })
      await act(async () => {
        await result.current.selectFile(fileB)
      })
      // a.ts をアクティブに戻し、保存を失敗させて saveError を立てておく
      act(() => result.current.activateTab('/project/src/a.ts'))
      act(() => result.current.updateFileContent('編集済みA'))
      await act(async () => {
        await result.current.saveFile()
      })
      expect(result.current.saveError?.message).toBe('EACCES')

      // アクティブな a.ts の取り消し読み込みを失敗させる
      mockReadFileContent.mockRejectedValueOnce(new Error('ENOENT'))
      await act(async () => {
        await result.current.reloadOpenFile('/project/src/a.ts')
      })

      expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/src/b.ts'])
      expect(result.current.activeFilePath).toBe('/project/src/b.ts')
      expect(result.current.saveError).toBeNull()
    })

    it('reloadOpenFile: 保存の書き込み中に取り消しても、完了後に古い内容で savedContent が上書きされない', async () => {
      // generation を進めずに取り消すと、待たされていた古い保存が後から解決した際、
      // 取り消しで復元した savedContent を保存しようとしていた古い内容で
      // 上書きしてしまう(ディスクへも書き込まれ、復元した内容を消してしまう)
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
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
      act(() => result.current.updateFileContent('保存しようとしていた内容'))

      let resolveWrite: () => void = () => {}
      mockWriteFileContent.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve
          })
      )
      let firstSave: Promise<void> = Promise.resolve()
      act(() => {
        firstSave = result.current.saveFile()
      })
      expect(result.current.isSaving).toBe(true)

      // 保存の書き込みが完了する前に、取り消しでディスクの内容へ揃える
      mockReadFileContent.mockResolvedValueOnce('取り消し後の内容')
      await act(async () => {
        await result.current.reloadOpenFile('/project/src/index.ts')
      })
      const reloaded = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
      expect(reloaded?.content).toBe('取り消し後の内容')
      expect(reloaded?.savedContent).toBe('取り消し後の内容')

      // 待たされていた書き込みが遅れて解決しても、取り消し後の savedContent を
      // 古い保存結果で上書きしない(generation が進んでいることで無効化される)
      await act(async () => {
        resolveWrite()
        await firstSave
      })
      const afterWrite = result.current.openFiles.find((f) => f.path === '/project/src/index.ts')
      expect(afterWrite?.savedContent).toBe('取り消し後の内容')
    })

    it('reloadOpenFile の待機中に閉じて開き直しても、正当な再オープンは取り消されない', async () => {
      // reloadOpenFile は pendingReadPathRef を無効化しない(上の reloadOpenFile 実装の
      // コメント参照)。待機中にタブを閉じて同じパスを開き直した場合、その再オープンの
      // 読み込みは正当なものであり、reload の完了に巻き込まれて破棄されてはならない
      mockOpenFolder.mockResolvedValue('/project')
      mockReadDirectory.mockResolvedValue(mockTree)
      mockReadFileContent.mockResolvedValueOnce('const a = 1')
      const { result } = renderHook(() => useFileSystem({ onConfirm: () => true }))
      await act(async () => {
        await result.current.openFolder()
      })
      const fileA: FileTreeNode = { name: 'a.ts', path: '/project/src/a.ts', type: 'file' }
      await act(async () => {
        await result.current.selectFile(fileA)
      })

      let resolveReload: (content: string) => void = () => {}
      mockReadFileContent.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveReload = resolve
          })
      )
      let reloadPromise: Promise<void> = Promise.resolve()
      act(() => {
        reloadPromise = result.current.reloadOpenFile('/project/src/a.ts')
      })

      act(() => result.current.closeTab('/project/src/a.ts'))

      let resolveReopen: (content: string) => void = () => {}
      mockReadFileContent.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveReopen = resolve
          })
      )
      let reopenPromise: Promise<boolean> = Promise.resolve(false)
      act(() => {
        reopenPromise = result.current.selectFile(fileA)
      })

      await act(async () => {
        resolveReload('reload で読み込んだ内容')
        await reloadPromise
      })

      let reopened: boolean = false
      await act(async () => {
        resolveReopen('再オープンで読み込んだ内容')
        reopened = await reopenPromise
      })

      expect(reopened).toBe(true)
      const reopenedFile = result.current.openFiles.find((f) => f.path === '/project/src/a.ts')
      expect(reopenedFile?.content).toBe('再オープンで読み込んだ内容')
    })
  })

  describe('confirmDiscardAnyDirty', () => {
    // checkout 前の破棄確認(useAppState.ts の checkoutBranch ラッパー)のために
    // 公開する。closeTab 等が内部で使っている判定・確認ダイアログと同じもの

    it('dirty なタブが無ければ true を返し、確認ダイアログは呼ばない', () => {
      const onConfirm = vi.fn(() => true)
      const { result } = renderHook(() => useFileSystem({ onConfirm }))
      expect(result.current.confirmDiscardAnyDirty()).toBe(true)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('dirty なタブがあれば確認ダイアログを呼び、その結果を返す', async () => {
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
      act(() => result.current.updateFileContent('未保存の編集'))

      expect(result.current.confirmDiscardAnyDirty()).toBe(false)
      expect(onConfirm).toHaveBeenCalled()
    })
  })
})
