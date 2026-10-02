import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode } from '../../types'

vi.mock('../../lib/fileSystemApi')

let completionsCount = 0
let pendingSavePromise: Promise<void> | null = null

vi.mock('../useFileEditing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useFileEditing')>()
  return {
    ...actual,
    useFileEditing: (...args: Parameters<typeof actual.useFileEditing>) => {
      const res = actual.useFileEditing(...args)
      return {
        ...res,
        saveCompletionsFor: () => completionsCount++,
        pendingSaveFor: () => {
          const p = pendingSavePromise
          pendingSavePromise = null
          return p
        }
      }
    }
  }
})

import * as fileSystemApi from '../../lib/fileSystemApi'
import { useFileSystem } from '../useFileSystem'

const mockOpenFolder = vi.mocked(fileSystemApi.openFolder)
const mockReadDirectory = vi.mocked(fileSystemApi.readDirectory)
const mockReadFileContent = vi.mocked(fileSystemApi.readFileContent)

const mockTree: FileTreeNode[] = [
  {
    name: 'src',
    path: '/project/src',
    type: 'directory',
    children: [{ name: 'index.ts', path: '/project/src/index.ts', type: 'file' }]
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  completionsCount = 0
  pendingSavePromise = null
})

describe('useFileSystem conflict retry exhaustion', () => {
  it('読み込み中に保存完了が連続して競合上限(MAX_READ_RETRIES)に達した場合、エラーを設定して中断する', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const a = 1')

    const { result } = renderHook(() => useFileSystem())
    await act(async () => {
      await result.current.openFolder()
    })

    let openResult: boolean | undefined
    await act(async () => {
      openResult = await result.current.selectFile({
        name: 'index.ts',
        path: '/project/src/index.ts',
        type: 'file'
      })
    })

    expect(openResult).toBe(false)
    expect(result.current.error?.message).toBe(
      '保存と競合したため読み込めませんでした。もう一度開いてください。'
    )
    expect(result.current.openFiles).toEqual([])
  })

  it('保留中の保存がある場合は解決を待ってから読み込む', async () => {
    mockOpenFolder.mockResolvedValue('/project')
    mockReadDirectory.mockResolvedValue(mockTree)
    mockReadFileContent.mockResolvedValue('const a = 1')

    pendingSavePromise = Promise.resolve()

    const { result } = renderHook(() => useFileSystem())
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

    expect(mockReadFileContent).toHaveBeenCalledWith('/project/src/index.ts')
  })
})
