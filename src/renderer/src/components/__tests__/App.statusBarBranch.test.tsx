import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComponentProps } from 'react'

// isSyncing が立つ間は isSyncBlocked も立つため、ボタンの disabled だけでは isSyncing の配線を区別できない。
// 本物を描画したまま、渡された props を記録する
const syncButtonProps = vi.hoisted(() => vi.fn())
vi.mock('../StatusBarSyncButton', async (importOriginal) => {
  const { default: Actual } = await importOriginal<typeof import('../StatusBarSyncButton')>()
  return {
    default: (props: ComponentProps<typeof Actual>) => {
      syncButtonProps(props)
      return <Actual {...props} />
    }
  }
})

// gitApi をまるごとモックする。App.commit.test.tsx と同じ方針
vi.mock('../../lib/gitApi', () => ({
  getGitStatus: vi.fn(),
  getLog: vi.fn(),
  getHeadCommitMessage: vi.fn(() => Promise.resolve(null)),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  mergeBranch: vi.fn(),
  pull: vi.fn(),
  push: vi.fn(),
  stageFile: vi.fn()
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
const mockCreateBranch = vi.mocked(gitApi.createBranch)
const mockDeleteBranch = vi.mocked(gitApi.deleteBranch)
const mockMergeBranch = vi.mocked(gitApi.mergeBranch)
const mockPull = vi.mocked(gitApi.pull)
const mockPush = vi.mocked(gitApi.push)
const mockStageFile = vi.mocked(gitApi.stageFile)

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

function getSourceControlPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('.source-control-panel')
  if (panel === null) throw new Error('ソース管理のパネルが見つかりません')
  return panel
}

async function openFolder(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
}

async function openBranchPicker(): Promise<void> {
  await userEvent.click(
    await within(getStatusBar()).findByRole('button', { name: 'ブランチを切り替え' })
  )
}

const DELETE_BUTTON = { name: 'ブランチ feature/x を削除' }
const MERGE_BUTTON = { name: 'ブランチ feature/x を現在のブランチにマージ' }

async function createBranchNamed(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('option', { name: '＋ 新しいブランチを作成…' }))
  await userEvent.type(screen.getByRole('textbox', { name: '名前' }), name)
  await userEvent.click(screen.getByRole('button', { name: 'OK' }))
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
    window.confirm = vi.fn().mockReturnValue(true)
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

  // パネルのブランチ欄で固定していた、他の操作中(isAnyLocked)に押せなくする判定
  it('他の操作の実行中(プル)は、ブランチの項目を押せなくして理由を伝える', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, behind: 1 })
    mockPull.mockReturnValue(new Promise(() => {}))
    await openFolder()
    await userEvent.click(
      await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    )
    expect(
      await within(getStatusBar()).findByRole('button', {
        name: '他の操作が完了するまでブランチを切り替えられません'
      })
    ).toBeDisabled()
  })

  it('ステージの実行中(stagingPaths)も、ブランチの項目を押せなくする', async () => {
    mockGetGitStatus.mockResolvedValue({
      ...repoStatus,
      files: [{ path: 'a.ts', index: ' ', workingDir: 'M' }]
    })
    mockStageFile.mockReturnValue(new Promise(() => {}))
    await openFolder()
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    await userEvent.click(await screen.findByLabelText('a.ts をステージ'))
    expect(
      await within(getStatusBar()).findByRole('button', {
        name: '他の操作が完了するまでブランチを切り替えられません'
      })
    ).toBeDisabled()
  })

  it('ソース管理のパネルにはブランチの欄を出さない', async () => {
    await openFolder()
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    await screen.findByRole('textbox', { name: 'コミットメッセージ' })
    expect(document.querySelector('.source-control-panel__branch')).toBeNull()
    expect(
      within(document.querySelector('.source-control-panel') as HTMLElement).queryByRole('button', {
        name: 'ブランチを切り替え'
      })
    ).not.toBeInTheDocument()
  })

  it('一覧の作成の項目から useAppState の createBranch を通して作成する', async () => {
    mockCreateBranch.mockResolvedValue(undefined)
    await openFolder()
    await openBranchPicker()
    await createBranchNamed('feature/new')
    await waitFor(() => expect(mockCreateBranch).toHaveBeenCalledWith('feature/new'))
  })

  it('作成に失敗するとステータスバーにメッセージを出す', async () => {
    mockCreateBranch.mockRejectedValue(new Error('作成に失敗しました'))
    await openFolder()
    await openBranchPicker()
    await createBranchNamed('feature/new')
    expect(await within(getStatusBar()).findByRole('alert')).toHaveTextContent('作成に失敗しました')
  })

  it('行の削除のボタンは確認の後に deleteBranch を呼ぶ', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: true })
    await openFolder()
    await openBranchPicker()
    await userEvent.click(await screen.findByRole('button', DELETE_BUTTON))
    expect(window.confirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockDeleteBranch).toHaveBeenCalledWith('feature/x', false))
  })

  it('削除に失敗するとステータスバーにメッセージを出す', async () => {
    mockDeleteBranch.mockRejectedValue(new Error('削除に失敗しました'))
    await openFolder()
    await openBranchPicker()
    await userEvent.click(await screen.findByRole('button', DELETE_BUTTON))
    expect(await within(getStatusBar()).findByRole('alert')).toHaveTextContent('削除に失敗しました')
  })

  it('行のマージのボタンは確認の後に mergeBranch を呼ぶ', async () => {
    mockMergeBranch.mockResolvedValue({ status: 'merged' })
    await openFolder()
    await openBranchPicker()
    await userEvent.click(await screen.findByRole('button', MERGE_BUTTON))
    await waitFor(() => expect(mockMergeBranch).toHaveBeenCalledWith('feature/x'))
  })

  it('マージに失敗するとステータスバーにメッセージを出す', async () => {
    mockMergeBranch.mockRejectedValue(new Error('マージに失敗しました'))
    await openFolder()
    await openBranchPicker()
    await userEvent.click(await screen.findByRole('button', MERGE_BUTTON))
    expect(await within(getStatusBar()).findByRole('alert')).toHaveTextContent(
      'マージに失敗しました'
    )
  })

  it('マージは未保存の確認つきの useAppState の mergeBranch を通す', async () => {
    window.api.readDirectory = vi
      .fn()
      .mockResolvedValue([{ name: 'a.ts', path: '/project/a.ts', type: 'file' }])
    window.api.readFile = vi.fn().mockResolvedValue('line1')
    window.confirm = vi.fn().mockReturnValue(false)
    await openFolder()
    await userEvent.click(await within(await screen.findByRole('tree')).findByText('a.ts'))
    fireEvent.change(await screen.findByTestId('monaco-editor-textarea'), {
      target: { value: 'typed' }
    })
    await openBranchPicker()
    await userEvent.click(await screen.findByRole('button', MERGE_BUTTON))
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('保存されていない変更')
    expect(mockMergeBranch).not.toHaveBeenCalled()
  })

  it('ahead・behind があれば同期のボタンを出し、押すと syncChanges を通してプルとプッシュをする', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, ahead: 1, behind: 2 })
    mockPull.mockResolvedValue({ conflicted: false })
    mockPush.mockResolvedValue(undefined)
    await openFolder()
    const button = await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    expect(button).toHaveTextContent('↓2 ↑1')
    await userEvent.click(button)
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
    expect(mockPull).toHaveBeenCalledTimes(1)
  })

  it('同期の実行中は同期のボタンを押せず、isSyncing をステータスバーへ渡す', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, ahead: 1 })
    mockPush.mockReturnValue(new Promise(() => {}))
    await openFolder()
    const button = await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    expect(syncButtonProps).toHaveBeenLastCalledWith(expect.objectContaining({ isSyncing: false }))
    await userEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    expect(syncButtonProps).toHaveBeenLastCalledWith(expect.objectContaining({ isSyncing: true }))
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    expect(
      await within(getSourceControlPanel()).findByRole('button', { name: '同期中...' })
    ).toBeDisabled()
  })

  it('パネルのプッシュの実行中は、同期のボタンを押せない', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, ahead: 1 })
    mockPush.mockReturnValue(new Promise(() => {}))
    await openFolder()
    const button = await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    expect(button).toBeEnabled()
    await userEvent.click(screen.getByTitle(activityBarPanels[1].title))
    await userEvent.click(await screen.findByRole('button', { name: 'その他の操作' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'プッシュ' }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
    expect(button).toBeDisabled()
    expect(
      within(getSourceControlPanel()).getByRole('button', { name: /^変更を同期/ })
    ).toBeDisabled()
  })

  it('マージ中は、同期のボタンを押せない', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, ahead: 1, mergeInProgress: true })
    await openFolder()
    expect(
      await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    ).toBeDisabled()
  })

  it('同期の失敗をステータスバーに出す(別のパネルを開いていても分かる)', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, ahead: 1 })
    mockPush.mockRejectedValue(new Error('プッシュに失敗しました'))
    await openFolder()
    await userEvent.click(
      await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    )
    expect(await within(getStatusBar()).findByRole('alert')).toHaveTextContent(
      'プッシュに失敗しました'
    )
  })

  it('ブランチの失敗と同期の失敗を、別の項目として両方出す', async () => {
    mockGetGitStatus.mockResolvedValue({ ...repoStatus, ahead: 1 })
    mockPush.mockRejectedValue(new Error('プッシュに失敗しました'))
    mockCheckoutBranch.mockRejectedValue(new Error('checkout に失敗しました'))
    await openFolder()
    await userEvent.click(
      await within(getStatusBar()).findByRole('button', { name: /^変更を同期/ })
    )
    await within(getStatusBar()).findByRole('alert')
    await openBranchPicker()
    await userEvent.click(await screen.findByRole('option', { name: /feature\/x/ }))
    await waitFor(() =>
      expect(
        within(getStatusBar())
          .getAllByRole('alert')
          .map((alert) => alert.textContent)
      ).toEqual(['checkout に失敗しました', 'プッシュに失敗しました'])
    )
  })
})
