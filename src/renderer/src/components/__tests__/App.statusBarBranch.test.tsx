import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// gitApi をまるごとモックする。App.commit.test.tsx と同じ方針
vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  getLog: vi.fn(),
  getHeadCommitMessage: vi.fn(() => Promise.resolve(null)),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  checkoutBranch: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import type { GitBranch, GitStatusResult } from '@shared/types'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)
const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)
const mockCheckoutBranch = vi.mocked(gitApi.checkoutBranch)

const repoStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/develop',
  detached: false,
  branch: 'develop',
  ahead: 0,
  behind: 0,
  files: []
}

const branches: GitBranch[] = [
  { name: 'develop', current: true },
  { name: 'feature/x', current: false }
]

function getStatusBar(): HTMLElement {
  const statusBar = document.querySelector<HTMLElement>('.status-bar')
  if (statusBar === null) throw new Error('ステータスバーが見つかりません')
  return statusBar
}

async function openFolder(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
}

describe('App: ステータスバーのブランチ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    mockGetGitStatus.mockResolvedValue(repoStatus)
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockResolvedValue(branches)
    mockGetTags.mockResolvedValue([])
  })

  it('フォルダを開く前はブランチの項目を出さない', () => {
    render(<App />)
    expect(
      within(getStatusBar()).queryByRole('button', { name: 'ブランチを切り替え' })
    ).not.toBeInTheDocument()
  })

  it('リポジトリなら現在のブランチ名を出す', async () => {
    await openFolder()
    const button = await within(getStatusBar()).findByRole('button', {
      name: 'ブランチを切り替え'
    })
    expect(button).toHaveTextContent('develop')
    expect(button).toBeEnabled()
  })

  it('detached HEAD なら (no branch) を出す', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, detached: true, branch: 'HEAD' })
    await openFolder()
    const button = await within(getStatusBar()).findByRole('button', {
      name: 'ブランチを切り替え'
    })
    expect(button).toHaveTextContent('(no branch)')
  })

  it('isRepo が false ならブランチの項目を出さない', async () => {
    mockGetGitStatus.mockResolvedValue({
      ...repoStatus,
      isRepo: false,
      branch: null,
      upstream: null,
      hasOrigin: false,
      hasRemote: false
    })
    await openFolder()
    // 状態が画面へ届いたことを確かめてから判定する(届く前は常に出ないため、空振りになる)
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    expect(await screen.findByText('Git リポジトリではありません')).toBeInTheDocument()
    expect(
      within(getStatusBar()).queryByRole('button', { name: 'ブランチを切り替え' })
    ).not.toBeInTheDocument()
  })

  it('一覧で選ぶと useAppState の checkoutBranch を通して切り替える', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    await openFolder()
    await userEvent.click(
      await within(getStatusBar()).findByRole('button', { name: 'ブランチを切り替え' })
    )
    await userEvent.click(await screen.findByRole('option', { name: /feature\/x/ }))
    await waitFor(() => expect(mockCheckoutBranch).toHaveBeenCalledWith('feature/x'))
  })

  it('切り替えに失敗するとステータスバーにメッセージを出す', async () => {
    mockCheckoutBranch.mockRejectedValue(new Error('checkout に失敗しました'))
    await openFolder()
    await userEvent.click(
      await within(getStatusBar()).findByRole('button', { name: 'ブランチを切り替え' })
    )
    await userEvent.click(await screen.findByRole('option', { name: /feature\/x/ }))
    expect(await within(getStatusBar()).findByRole('alert')).toHaveTextContent(
      'checkout に失敗しました'
    )
  })
})
