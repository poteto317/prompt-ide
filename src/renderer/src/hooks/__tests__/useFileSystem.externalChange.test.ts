import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

import * as fileSystemApi from '../../lib/fileSystemApi'
import { routeCheckedWritesToWriteFileContent } from '../../__tests__/routeCheckedWrites'
import { useFileSystem } from '../useFileSystem'

const mockRead = vi.mocked(fileSystemApi.readFileContent)
const mockWrite = vi.mocked(fileSystemApi.writeFileContent)

const nodeA: FileNode = { name: 'a.ts', path: '/project/a.ts', type: 'file' }
const nodeB: FileNode = { name: 'b.ts', path: '/project/b.ts', type: 'file' }

beforeEach(() => {
  vi.resetAllMocks()
  routeCheckedWritesToWriteFileContent()
})

async function openFiles(
  ...nodes: FileNode[]
): Promise<ReturnType<typeof renderHook<ReturnType<typeof useFileSystem>, unknown>>> {
  const hook = renderHook(() => useFileSystem())
  for (const node of nodes) {
    mockRead.mockResolvedValueOnce(`content of ${node.name}`)
    await act(async () => {
      await hook.result.current.selectFile(node)
    })
  }
  return hook
}

describe('useFileSystem: 外部変更の反映', () => {
  it('getOpenFileSnapshot は開いているタブの最新の状態を返し、開いていなければ null', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('typed'))
    expect(result.current.getOpenFileSnapshot('/project/a.ts')).toMatchObject({
      content: 'typed',
      savedContent: 'content of a.ts'
    })
    expect(result.current.getOpenFileSnapshot('/project/none.ts')).toBeNull()
  })

  it('replaceCleanTabWithDisk は未編集で控えと同じタブをディスクの内容にする', async () => {
    const { result } = await openFiles(nodeA)
    let replaced = false
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(true)
    expect(result.current.openFile).toMatchObject({
      content: 'from agent',
      savedContent: 'from agent'
    })
  })

  it('読む間に打鍵されていたら(控えと違えば)置き換えない', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('typed'))
    let replaced = true
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(false)
    expect(result.current.openFile?.content).toBe('typed')
  })

  it('編集中のタブは、控えと同じでも置き換えない(編集中の内容を自動で上書きしない)', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('typed'))
    let replaced = true
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'typed', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(false)
    expect(result.current.openFile).toMatchObject({
      content: 'typed',
      savedContent: 'content of a.ts'
    })
  })

  // 保存の世代(generation)が進むことは、進行中の保存があると置き換え自体が拒否されるため
  // (pendingSaveFor)、公開 API からは観察できない。ここでは同じ呼び出し(invalidateSaveStateOfTab)が
  // 行うアクティブなタブの saveError クリアだけを固定する
  it('置き換えたら、アクティブなタブの前回の保存エラーを消す', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('edited'))
    mockWrite.mockRejectedValueOnce(new Error('disk full'))
    await act(async () => {
      await result.current.saveFile()
    })
    // 編集を元に戻して未編集にする(前回の保存エラーは残っている)
    act(() => result.current.updateFileContent('content of a.ts'))
    expect(result.current.saveError).not.toBeNull()
    let replaced = false
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(true)
    expect(result.current.saveError).toBeNull()
  })

  it('disk が null(削除)なら未編集のタブを閉じる', async () => {
    const { result } = await openFiles(nodeA, nodeB)
    act(() => {
      result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        null
      )
    })
    expect(result.current.openFiles.map((f) => f.path)).toEqual(['/project/b.ts'])
  })

  it('保存の実行中は、未編集に戻っていても置き換えず、waitForPendingSave は保存の完了まで待つ', async () => {
    const { result } = await openFiles(nodeA)
    act(() => result.current.updateFileContent('edited'))
    let finishWrite: () => void = () => undefined
    mockWrite.mockImplementationOnce(() => new Promise<void>((resolve) => (finishWrite = resolve)))
    let saving: Promise<void> = Promise.resolve()
    act(() => {
      saving = result.current.saveFile()
    })
    // 書き込みの途中で編集を元に戻した(タブは未編集に見えるが、保存は 'edited' を書いている)
    act(() => result.current.updateFileContent('content of a.ts'))
    let waited = false
    const waiting = result.current.waitForPendingSave('/project/a.ts').then(() => {
      waited = true
    })
    let replaced = true
    act(() => {
      replaced = result.current.replaceCleanTabWithDisk(
        '/project/a.ts',
        { content: 'content of a.ts', savedContent: 'content of a.ts' },
        'from agent'
      )
    })
    expect(replaced).toBe(false)
    await Promise.resolve()
    expect(waited).toBe(false)
    await act(async () => {
      finishWrite()
      await saving
      await waiting
    })
    expect(waited).toBe(true)
  })
})
