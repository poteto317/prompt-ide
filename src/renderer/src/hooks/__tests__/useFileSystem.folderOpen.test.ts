import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileSystem } from '../useFileSystem'

// フォルダを開く経路のテスト。openFolder(OS のダイアログでフォルダを選ぶ)と applyOpenedFolder(選ばれたパスを
// 開く。clone の成功の後にも使う)の、未保存の確認・走査の失敗・競合の扱いと、未保存の状態の控え
// (captureDirtySnapshot。applyOpenedFolder の再確認の基準)を見る。他の useFileSystem の挙動は useFileSystem.test.ts
const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
const mockReadDirectory = vi.mocked(fileSystemApi.readDirectory)
const mockReadFileContent = vi.mocked(fileSystemApi.readFileContent)

const projectTree: FileTreeNode[] = [{ name: 'index.ts', path: '/project/index.ts', type: 'file' }]
const otherTree: FileTreeNode[] = [{ name: 'other.ts', path: '/other/other.ts', type: 'file' }]

function treeFor(path: string): FileTreeNode[] {
  if (path === '/project') return projectTree
  if (path === '/other') return otherTree
  return []
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type Hook = { current: ReturnType<typeof useFileSystem> }

// /project を開いて index.ts をタブで開く
async function openProjectWithTab(result: Hook): Promise<void> {
  mockOpenFolder.mockResolvedValueOnce('/project')
  await act(async () => {
    await result.current.openFolder()
  })
  await act(async () => {
    await result.current.selectFile(projectTree[0])
  })
}

beforeEach(() => {
  // 持続する実装を前のテストから持ち込まない(パターン 103)。走査はパスごとに決まった木を返す
  vi.resetAllMocks()
  mockReadDirectory.mockImplementation((path: string) => Promise.resolve(treeFor(path)))
  mockReadFileContent.mockResolvedValue('const x = 1')
})

describe('openFolder', () => {
  it('未保存の確認はダイアログの前に 1 回だけ。ダイアログを取り消しても、もう一度は確認せずタブを残す', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('編集'))
    mockOpenFolder.mockResolvedValueOnce(null)
    await act(async () => {
      await result.current.openFolder()
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/project')
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/index.ts'])
  })

  it('ダイアログが返った時点の未保存の有無を基準にし、走査の後も変わらなければ確認せずにタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    const dialog = deferred<string | null>()
    mockOpenFolder.mockReturnValueOnce(dialog.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.openFolder()
    })
    // ダイアログの表示中(ネイティブのダイアログはモーダルで、実際には編集できない)に未保存にする
    act(() => result.current.updateFileContent('編集'))
    await act(async () => {
      dialog.resolve('/other')
      await opening
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles).toEqual([])
  })

  it('ダイアログの失敗は error だけを立て、folderLoadError は立てず、フォルダもそのまま', async () => {
    const { result } = renderHook(() => useFileSystem())
    await openProjectWithTab(result)
    mockOpenFolder.mockRejectedValueOnce(new Error('dialog error'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.error?.message).toBe('dialog error')
    expect(result.current.folderLoadError).toBeNull()
    expect(result.current.folderPath).toBe('/project')
    expect(mockReadDirectory).toHaveBeenCalledTimes(1)
  })

  it('走査の失敗では、選んだフォルダを確定して error と folderLoadError の両方を立てる', async () => {
    const { result } = renderHook(() => useFileSystem())
    mockOpenFolder.mockResolvedValueOnce('/other')
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    await act(async () => {
      await result.current.openFolder()
    })
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.fileTree).toEqual([])
    expect(result.current.error?.message).toBe('scan error')
    expect(result.current.folderLoadError?.message).toBe('scan error')
  })
})

// /project の 2 つ目のファイル(別のタブの編集を確かめるために開く。走査の木には含めない)
const secondFile: FileTreeNode = { name: 'b.ts', path: '/project/b.ts', type: 'file' }

describe('applyOpenedFolder', () => {
  it('渡したパスを走査して開き、ダイアログは使わない', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(mockOpenFolder).not.toHaveBeenCalled()
    expect(mockReadDirectory).toHaveBeenCalledExactlyOnceWith('/other')
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.fileTree).toEqual(otherTree)
    expect(result.current.error).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('確認の時点から未保存の内容が変わらなければ、もう一度は確認せずにタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.openFiles).toEqual([])
    expect(result.current.folderPath).toBe('/other')
  })

  it('確認の時点で未保存が無く、その後に編集が入ったら、もう一度確認する。取り消せばフォルダだけ切り替えてタブを残す', async () => {
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    // 確認の後(clone の実行中)に編集した
    act(() => result.current.updateFileContent('clone 中の編集'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles.map((f) => f.content)).toEqual(['clone 中の編集'])
  })

  it('確認の時点で未保存があり、その後に同じタブをさらに編集したら、もう一度確認する。取り消せばタブを残す', async () => {
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('確認前の編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    // 未保存の有無は true のまま変わらないが、内容は変わった(clone の実行中の編集)
    act(() => result.current.updateFileContent('確認前の編集 + clone 中の編集'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles.map((f) => f.content)).toEqual([
      '確認前の編集 + clone 中の編集'
    ])
  })

  it('確認の時点で未保存があり、その後に別のタブを編集しても、もう一度確認する。承諾すればタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('確認前の編集'))
    await act(async () => {
      await result.current.selectFile(secondFile)
    })
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    act(() => result.current.updateFileContent('別のタブの clone 中の編集'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles).toEqual([])
  })

  it('実行中の openFolder のダイアログより後に呼ばれたら、ダイアログの結果を捨てる', async () => {
    const { result } = renderHook(() => useFileSystem())
    const dialog = deferred<string | null>()
    mockOpenFolder.mockReturnValueOnce(dialog.promise)
    let opening: Promise<void> = Promise.resolve()
    act(() => {
      opening = result.current.openFolder()
    })
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    await act(async () => {
      dialog.resolve('/project')
      await opening
    })
    expect(result.current.folderPath).toBe('/other')
    expect(mockReadDirectory).not.toHaveBeenCalledWith('/project')
  })

  it('走査の失敗では、パスを確定して error と folderLoadError を立てる', async () => {
    const { result } = renderHook(() => useFileSystem())
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.error?.message).toBe('scan error')
    expect(result.current.folderLoadError?.message).toBe('scan error')
  })

  it('走査の失敗でも、確認の時点から未保存の内容が変わらなければ、もう一度は確認せずにタブを閉じる', async () => {
    const onConfirm = vi.fn(() => true)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles).toEqual([])
    expect(result.current.error?.message).toBe('scan error')
  })

  it('走査の失敗でも、確認の後に編集が入っていれば、もう一度確認する。取り消せばタブを残す', async () => {
    const onConfirm = vi.fn(() => false)
    const { result } = renderHook(() => useFileSystem({ onConfirm }))
    await openProjectWithTab(result)
    act(() => result.current.updateFileContent('確認前の編集'))
    const dirtySnapshotAtConfirm = result.current.captureDirtySnapshot()
    act(() => result.current.updateFileContent('確認前の編集 + clone 中の編集'))
    mockReadDirectory.mockRejectedValueOnce(new Error('scan error'))
    await act(async () => {
      await result.current.applyOpenedFolder('/other', { dirtySnapshotAtConfirm })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(result.current.folderPath).toBe('/other')
    expect(result.current.openFiles.map((f) => f.content)).toEqual([
      '確認前の編集 + clone 中の編集'
    ])
    expect(result.current.error?.message).toBe('scan error')
    expect(result.current.folderLoadError?.message).toBe('scan error')
  })
})

// 未保存の状態の控え(直列化の中身は lib/dirtySnapshot の単体テストが見る)。ここは useFileSystem のタブの状態から
// 作られることを見る
describe('captureDirtySnapshot', () => {
  it('未保存の内容が同じなら同じ値を返し、編集で変わり、保存済みの内容へ戻すと元の値に戻る', async () => {
    const { result } = renderHook(() => useFileSystem())
    await openProjectWithTab(result)
    const clean = result.current.captureDirtySnapshot()
    expect(result.current.captureDirtySnapshot()).toBe(clean)
    act(() => result.current.updateFileContent('編集 1'))
    const edited1 = result.current.captureDirtySnapshot()
    expect(edited1).not.toBe(clean)
    act(() => result.current.updateFileContent('編集 2'))
    expect(result.current.captureDirtySnapshot()).not.toBe(edited1)
    act(() => result.current.updateFileContent('const x = 1'))
    expect(result.current.captureDirtySnapshot()).toBe(clean)
  })
})
