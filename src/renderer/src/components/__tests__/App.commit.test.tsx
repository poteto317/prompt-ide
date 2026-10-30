import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// gitApi をまるごとモックする。App.amend.test.tsx と同じ方針
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
  amendCommit: vi.fn(),
  push: vi.fn()
}))

import * as gitApi from '../../lib/gitApi'
import type { GitLogEntry } from '@shared/types'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)
const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)
const mockCommitChanges = vi.mocked(gitApi.commitChanges)
const mockPush = vi.mocked(gitApi.push)

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function openGitPanel(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
  const gitBtn = screen.getByTitle(activityBarPanels[1].title)
  await userEvent.click(gitBtn)
}

describe('App: 通常コミット完了後の履歴反映', () => {
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
      files: [{ path: 'a.ts', index: 'M', workingDir: ' ' }]
    })
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
  })

  it('コミット完了後、履歴の再取得(refreshHistory)が終わるまでコミットボタンを再有効化しない', async () => {
    // useGitOperations の isCommitting は commit() 自体(git コマンド実行)の
    // 完了時点で既に false に戻る。isCommitting だけでボタンを制御すると、
    // refreshHistory 完了前にユーザーが amend チェックを入れた場合、
    // まだ古い(直前のコミットより前の)コミットメッセージが lastCommitMessage
    // としてプリフィルされてしまう
    const beforeLog: GitLogEntry[] = [
      {
        hash: 'old1',
        parents: [],
        refs: [],
        isHead: false,
        message: '古いコミット',
        date: '2026-09-04T00:00:00Z',
        authorName: 'Alice'
      }
    ]
    mockGetLog.mockResolvedValueOnce(beforeLog)
    await openGitPanel()
    await waitFor(() => expect(screen.getByText('古いコミット')).toBeInTheDocument())

    mockCommitChanges.mockResolvedValue(undefined)
    const deferredLog = createDeferred<GitLogEntry[]>()
    mockGetLog.mockImplementationOnce(() => deferredLog.promise)

    await userEvent.type(
      screen.getByRole('textbox', { name: 'コミットメッセージ' }),
      '新しいコミット'
    )
    await userEvent.click(screen.getByRole('button', { name: 'コミット' }))
    await waitFor(() => expect(mockCommitChanges).toHaveBeenCalled())

    // 履歴の再取得が終わるまでは isCommitting 相当が true のままのはず。
    // コミット成功後メッセージ欄は空になり isDisabled はメッセージ空でも
    // true になるため、ここでは isCommitting によって駆動される
    // メッセージ欄自体の disabled 属性で判定する
    expect(screen.getByRole('textbox', { name: 'コミットメッセージ' })).toBeDisabled()

    deferredLog.resolve([
      {
        hash: 'new1',
        parents: [],
        refs: [],
        isHead: false,
        message: '新しいコミット',
        date: '2026-09-04T00:01:00Z',
        authorName: 'Alice'
      },
      beforeLog[0]
    ])

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'コミットメッセージ' })).toBeEnabled()
    )
  })
})

describe('App: ソース管理の「更新」', () => {
  const makeEntry = (hash: string, message: string): GitLogEntry => ({
    hash,
    parents: [],
    refs: [],
    isHead: false,
    message,
    date: '2026-09-04T00:00:00Z',
    authorName: 'Alice'
  })

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
      files: []
    })
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
  })

  it('Git の状態と履歴の両方を取り直す', async () => {
    mockGetLog.mockResolvedValueOnce([makeEntry('old1', '取り直す前のコミット')])
    await openGitPanel()
    await waitFor(() => expect(screen.getByText('取り直す前のコミット')).toBeInTheDocument())
    mockGetGitStatus.mockClear()

    mockGetLog.mockResolvedValueOnce([
      makeEntry('new1', '端末で作ったコミット'),
      makeEntry('old1', '取り直す前のコミット')
    ])
    await userEvent.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.getByText('端末で作ったコミット')).toBeInTheDocument())
    expect(mockGetGitStatus).toHaveBeenCalledOnce()
  })

  it('履歴の取り直しが失敗しても、Git の状態は取り直して、履歴のエラーを表示する', async () => {
    mockGetLog.mockResolvedValueOnce([makeEntry('old1', '取り直す前のコミット')])
    await openGitPanel()
    await waitFor(() => expect(screen.getByText('取り直す前のコミット')).toBeInTheDocument())
    mockGetGitStatus.mockClear()

    mockGetLog.mockRejectedValueOnce(new Error('履歴の取得に失敗しました'))
    await userEvent.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.getByText(/履歴の取得に失敗しました/)).toBeInTheDocument())
    expect(mockGetGitStatus).toHaveBeenCalledOnce()
  })
})

describe('App: コミット欄の変更の同期', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
  })

  it('コミットするものが無く ahead があるとき、主ボタンを押すとプッシュする', async () => {
    mockGetGitStatus.mockResolvedValue({
      isRepo: true,
      mergeInProgress: false,
      hasOrigin: true,
      hasRemote: true,
      upstream: 'origin/main',
      detached: false,
      branch: 'main',
      ahead: 1,
      behind: 0,
      files: []
    })
    mockPush.mockResolvedValue(undefined)
    await openGitPanel()

    // ステータスバーにも同じ名前のボタンが出るので、パネルの主ボタンに絞る
    const panel = document.querySelector('.source-control-panel') as HTMLElement
    await userEvent.click(
      await within(panel).findByRole('button', { name: '変更を同期(プル 0 件、プッシュ 1 件)' })
    )

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1))
  })
})
