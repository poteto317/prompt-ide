import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FolderChangeEvent, GitStatusResult } from '@shared/types'
import type { FileTreeNode } from '../../types'

// gitApi をまるごとモックする。App.commit.test.tsx と同じ方針
vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(() => Promise.resolve([])),
  getHeadCommitMessage: vi.fn(() => Promise.resolve(null)),
  getBranches: vi.fn(() => Promise.resolve([])),
  getTags: vi.fn(() => Promise.resolve([])),
  amendCommit: vi.fn(),
  push: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)

const cleanStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

const initialTree: FileTreeNode[] = [
  {
    name: 'lib',
    path: '/project/lib',
    type: 'directory',
    children: [{ name: 'b.ts', path: '/project/lib/b.ts', type: 'file' }]
  },
  {
    name: 'src',
    path: '/project/src',
    type: 'directory',
    children: [{ name: 'a.ts', path: '/project/src/a.ts', type: 'file' }]
  }
]

let folderListener: ((event: FolderChangeEvent) => void) | null = null

function treeItemOf(name: string): HTMLElement {
  const item = within(screen.getByRole('tree')).getByText(name).closest('[role="treeitem"]')
  if (!(item instanceof HTMLElement)) throw new Error(`treeitem が無い: ${name}`)
  return item
}

async function openFolder(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  folderListener = null
  window.api.openFolder = vi.fn().mockResolvedValue('/project')
  window.api.readDirectory = vi.fn().mockResolvedValue(structuredClone(initialTree))
  window.api.setFolderWatch = vi.fn().mockResolvedValue(undefined)
  window.api.onFolderChange = vi.fn((listener: (event: FolderChangeEvent) => void) => {
    folderListener = listener
    return () => undefined
  })
  mockGetGitStatus.mockResolvedValue(cleanStatus)
})

describe('App: 開いているフォルダの外の変更の自動の反映', () => {
  it('マウント → 監視を頼む', async () => {
    await openFolder()
    expect(window.api.setFolderWatch).toHaveBeenCalledWith(true)
  })

  it('通知 → ツリーに新しいファイルが出て、閉じていたフォルダは閉じたまま、新しいフォルダは開いて出る', async () => {
    await openFolder()
    await userEvent.click(treeItemOf('lib'))
    expect(treeItemOf('lib')).toHaveAttribute('aria-expanded', 'false')
    window.api.readDirectory = vi.fn().mockResolvedValue([
      {
        name: 'auto-dir',
        path: '/project/auto-dir',
        type: 'directory',
        children: [{ name: 'inner.txt', path: '/project/auto-dir/inner.txt', type: 'file' }]
      },
      ...structuredClone(initialTree),
      { name: 'auto.txt', path: '/project/auto.txt', type: 'file' }
    ])
    act(() => {
      folderListener?.({ treeChanged: true })
    })
    await waitFor(() =>
      expect(within(screen.getByRole('tree')).getByText('auto.txt')).toBeInTheDocument()
    )
    expect(treeItemOf('lib')).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByRole('tree')).queryByText('b.ts')).not.toBeInTheDocument()
    expect(treeItemOf('auto-dir')).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('tree')).getByText('inner.txt')).toBeInTheDocument()
  })

  it('git だけの通知 → 取り直しの間もソース管理の 更新 は淡色にならず、読み込み中... も出ず、変更が一覧に出る', async () => {
    await openFolder()
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    await waitFor(() => expect(mockGetGitStatus).toHaveBeenCalled())
    const refreshButton = document.querySelector('.source-control-panel__refresh-btn')
    if (!(refreshButton instanceof HTMLButtonElement)) throw new Error('更新 のボタンが無い')
    await waitFor(() => expect(refreshButton).toBeEnabled())
    let resolveStatus: (status: GitStatusResult) => void = () => undefined
    mockGetGitStatus.mockReturnValueOnce(
      new Promise<GitStatusResult>((resolve) => {
        resolveStatus = resolve
      })
    )
    const callsBefore = mockGetGitStatus.mock.calls.length
    act(() => {
      folderListener?.({ treeChanged: false })
    })
    await waitFor(() => expect(mockGetGitStatus.mock.calls.length).toBe(callsBefore + 1))
    expect(refreshButton).toBeEnabled()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    await act(async () => {
      resolveStatus({ ...cleanStatus, files: [{ path: 'a.txt', index: ' ', workingDir: 'M' }] })
    })
    await waitFor(() => expect(screen.getByText('a.txt')).toBeInTheDocument())
    // ツリーは読み直さない(treeChanged: false)
    expect(window.api.readDirectory).toHaveBeenCalledOnce()
  })
})
