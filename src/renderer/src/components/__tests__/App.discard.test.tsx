import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  discardChanges: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  amendCommit: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)
const mockDiscardChanges = vi.mocked(gitApi.discardChanges)
const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)

describe('App: 変更の破棄（onDiscardFile）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    window.confirm = vi.fn().mockReturnValue(true)
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
      files: [{ path: 'modified.ts', index: ' ', workingDir: 'M' }]
    })
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    mockDiscardChanges.mockResolvedValue(undefined)
  })

  it('変更一覧の破棄ボタンをクリックして確認すると discardFile が実行される', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
    )

    // Git パネルに切り替え
    const gitBtn = screen.getByTitle(activityBarPanels[1].title)
    await userEvent.click(gitBtn)

    // modified.ts が表示されるのを待つ
    await waitFor(() => expect(screen.getByText('modified.ts')).toBeInTheDocument())
    // リモート設定済みの状態で検証する(未設定のバナーが出ていない)
    expect(screen.queryByText('リモートが未設定です')).not.toBeInTheDocument()

    // 破棄ボタンをクリック
    const discardBtn = screen.getByRole('button', { name: 'modified.ts の変更を取り消し' })
    await userEvent.click(discardBtn)

    // discardChanges が呼ばれたことを確認
    await waitFor(() => {
      expect(mockDiscardChanges).toHaveBeenCalledWith('modified.ts')
    })
  })
})
