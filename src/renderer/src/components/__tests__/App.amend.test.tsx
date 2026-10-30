import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// gitApi をまるごとモックする。App.diffTab.test.tsx と同じ方針
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
import type { GitLogEntry } from '@shared/types'
import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'
import { toggleAmend } from '../../__tests__/sourceControlMenu'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)
const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetHeadCommitMessage = vi.mocked(gitApi.getHeadCommitMessage)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)
const mockAmendCommit = vi.mocked(gitApi.amendCommit)

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

describe('App: amend 完了後の履歴反映', () => {
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

  it('amend 完了後、履歴の再取得(refreshHistory)が終わるまで amend チェック/メッセージ欄をリセットしない', async () => {
    // amend 前の直近コミットメッセージ
    const beforeLog: GitLogEntry[] = [
      {
        hash: 'abc123',
        parents: [],
        refs: [],
        isHead: false,
        message: '直前のコミット',
        date: '2026-09-04T00:00:00Z',
        authorName: 'Alice'
      }
    ]
    mockGetLog.mockResolvedValueOnce(beforeLog)
    mockGetHeadCommitMessage.mockResolvedValueOnce('直前のコミット')
    await openGitPanel()
    await waitFor(() => expect(screen.getByText('直前のコミット')).toBeInTheDocument())

    await toggleAmend()
    expect(screen.getByRole('textbox', { name: 'コミットメッセージ' })).toHaveValue(
      '直前のコミット'
    )

    mockAmendCommit.mockResolvedValue(undefined)
    // amend 後の履歴再取得(getLog の2回目呼び出し)をこちらで制御する
    const deferredLog = createDeferred<GitLogEntry[]>()
    mockGetLog.mockImplementationOnce(() => deferredLog.promise)
    mockGetHeadCommitMessage.mockResolvedValueOnce('直前のコミット(amend後)')

    await userEvent.click(screen.getByRole('button', { name: 'コミット (amend)' }))
    await waitFor(() => expect(mockAmendCommit).toHaveBeenCalled())

    // 履歴の再取得がまだ解決していない間は、amend成功後の後始末
    // (amend の解除・メッセージクリア)が起きてはならない。
    // ここが起きてしまうと、この直後にユーザーが amend を再度オンにした場合、
    // まだ古い(amend前の)コミットメッセージがプリフィルされてしまう
    expect(screen.getByRole('textbox', { name: 'コミットメッセージ' })).toHaveValue(
      '直前のコミット'
    )
    // amendCommit 自体は既に成功しているが、履歴の再取得(refreshHistory)が
    // 完了するまではコミットボタンが再度有効化されてはいけない。有効なままだと
    // この間にユーザーが再クリックした場合、同じメッセージで二重に amend が
    // 実行されてしまう(useGitOperations の isCommitting は amend() 自体の完了時点で
    // 既に false へ戻っており、この後処理の待機時間をカバーしていない)
    expect(screen.getByRole('button', { name: 'コミット中...' })).toBeDisabled()

    deferredLog.resolve([
      {
        hash: 'def456',
        parents: [],
        refs: [],
        isHead: false,
        message: '直前のコミット(amend後)',
        date: '2026-09-04T00:01:00Z',
        authorName: 'Alice'
      }
    ])

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'コミット' })).toBeInTheDocument()
    )
    expect(screen.getByRole('textbox', { name: 'コミットメッセージ' })).toHaveValue('')
  })

  it('上流が HEAD より進んで getLog の先頭が別のコミットでも、amend の欄に HEAD のメッセージが入る', async () => {
    const makeEntry = (hash: string, message: string, isHead: boolean): GitLogEntry => ({
      hash,
      parents: [],
      refs: [],
      isHead,
      message,
      date: '2026-09-04T00:00:00Z',
      authorName: 'Alice'
    })
    mockGetLog.mockResolvedValueOnce([
      makeEntry('upstream1', '上流のコミット', false),
      makeEntry('head1', 'HEAD のコミット', true)
    ])
    mockGetHeadCommitMessage.mockResolvedValueOnce('HEAD のコミット')
    await openGitPanel()
    await waitFor(() => expect(screen.getByText('上流のコミット')).toBeInTheDocument())

    await toggleAmend()

    expect(screen.getByRole('textbox', { name: 'コミットメッセージ' })).toHaveValue(
      'HEAD のコミット'
    )
  })
})
