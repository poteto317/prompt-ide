import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// gitApi をまるごとモックする。useGitStatus/useGitOperations/useGitHistory は
// いずれもこのモジュールを経由するため、実際の IPC を経由せずに diff タブの
// 開閉フローを再現できる
vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(),
  getHeadCommitMessage: vi.fn(() => Promise.resolve(null)),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  amendCommit: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)
const mockGetDiff = vi.mocked(gitApi.getDiff)
const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)
const mockStageHunk = vi.mocked(gitApi.stageHunk)

const DIFF_A = 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old-a\n+new-a\n'
const DIFF_B = 'diff --git a/b.ts b/b.ts\n@@ -1 +1 @@\n-old-b\n+new-b\n'

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function openFolderWithFiles(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
  const gitBtn = screen.getByTitle(activityBarPanels[1].title)
  await userEvent.click(gitBtn)
  await waitFor(() => expect(screen.getByText('a.ts')).toBeInTheDocument())
}

describe('App: diffタブを開く操作', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    mockGetGitStatus.mockResolvedValue({
      isRepo: true,
      mergeInProgress: false,
      hasOrigin: true,
      hasRemote: true,
      upstream: 'origin/main',
      detached: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        { path: 'a.ts', index: ' ', workingDir: 'M' },
        { path: 'b.ts', index: ' ', workingDir: 'M' }
      ]
    })
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
  })

  it('ファイルをクリックしてdiffタブを開いても無限レンダリングループにならない', async () => {
    mockGetDiff.mockResolvedValue(DIFF_A)
    await openFolderWithFiles()

    await userEvent.click(screen.getByText('a.ts'))
    await waitFor(() => expect(screen.getByText('-old-a')).toBeInTheDocument())

    const callCountAfterOpen = mockGetDiff.mock.calls.length
    // 無限ループしていれば、この待機中にも getDiff が呼ばれ続けて回数が増え続ける
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockGetDiff.mock.calls.length).toBe(callCountAfterOpen)
    expect(mockGetDiff.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('ハンクをステージすると現在アクティブなタブのdiffが更新される', async () => {
    mockGetDiff.mockResolvedValueOnce(DIFF_A)
    await openFolderWithFiles()
    await userEvent.click(screen.getByText('a.ts'))
    await waitFor(() => expect(screen.getByText('-old-a')).toBeInTheDocument())

    const UPDATED_DIFF_A = 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old-a2\n+new-a2\n'
    mockStageHunk.mockResolvedValue(undefined)
    mockGetDiff.mockResolvedValueOnce(UPDATED_DIFF_A)

    await userEvent.click(screen.getByRole('button', { name: 'このハンクをステージ' }))

    await waitFor(() => expect(screen.getByText('-old-a2')).toBeInTheDocument())
    expect(mockStageHunk).toHaveBeenCalledWith('a.ts', expect.stringContaining('@@ -1 +1 @@'))
  })

  it('タブ切替中に古いdiff取得結果が新しいタブの表示を上書きしない', async () => {
    const deferredA = createDeferred<string>()
    mockGetDiff.mockImplementationOnce(() => deferredA.promise)
    await openFolderWithFiles()

    await userEvent.click(screen.getByText('a.ts'))

    mockGetDiff.mockResolvedValueOnce(DIFF_B)
    await userEvent.click(screen.getByText('b.ts'))
    await waitFor(() => expect(screen.getByText('-old-b')).toBeInTheDocument())

    // a.ts の古い fetch が遅れて解決しても、表示は b.ts のまま上書きされない
    deferredA.resolve(DIFF_A)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('-old-a')).not.toBeInTheDocument()
    expect(screen.getByText('-old-b')).toBeInTheDocument()
  })
})
