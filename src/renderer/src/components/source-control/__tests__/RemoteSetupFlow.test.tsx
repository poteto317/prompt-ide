import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../../lib/gitApi')

import * as gitApi from '../../../lib/gitApi'
import SourceControlPanel from '../SourceControlPanel'
import { useGitRemoteOperations } from '../../../hooks/useGitRemoteOperations'
import { useGitRemoteSetup } from '../../../hooks/useGitRemoteSetup'
import type {
  DiscardAllState,
  MergeStatePanelState,
  RemoteSetupPanelState,
  StashPanelState
} from '../../../types'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'

const emptyStash: StashPanelState = {
  entries: [],
  pendingOperation: null,
  error: null,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPop: vi.fn().mockResolvedValue(undefined),
  onDrop: vi.fn().mockResolvedValue(true)
}

const emptyMergeState: MergeStatePanelState = {
  inProgress: false,
  unresolvedCount: 0,
  pendingOperation: null,
  error: null,
  canComplete: false,
  onComplete: vi.fn().mockResolvedValue(undefined),
  onAbort: vi.fn().mockResolvedValue(undefined)
}

const emptyDiscardAll: DiscardAllState = {
  isDiscarding: false,
  error: null,
  onDiscardAll: vi.fn().mockResolvedValue(undefined)
}

// リモートの操作以外の Props(この結合テストでは使わない)
const otherProps = {
  gitLoading: false,
  gitError: null,
  onRefresh: vi.fn(),
  stagingPaths: new Set<string>(),
  onStage: vi.fn(),
  onDiscard: vi.fn(),
  onUnstage: vi.fn(),
  onOpenDiff: vi.fn(),
  isCommitting: false,
  onCommit: vi.fn().mockResolvedValue(true),
  lastCommitMessage: null,
  onAmend: vi.fn().mockResolvedValue(true),
  log: [],
  branches: [],
  tags: [],
  hasMoreLog: false,
  isLoadingLog: false,
  isLoadingFolder: false,
  historyError: null,
  onLoadMoreLog: vi.fn(),
  operationError: null,
  pendingBranchOperation: null,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined),
  stash: emptyStash,
  discardAll: emptyDiscardAll,
  mergeState: emptyMergeState,
  gitTag: makeGitTagPanelState(),
  branchOperationError: null
}

const configured: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false
}
const notRepo: GitStatusResult = {
  ...configured,
  isRepo: false,
  branch: null,
  hasOrigin: false,
  hasRemote: false,
  upstream: null
}
const noOrigin: GitStatusResult = {
  ...configured,
  hasOrigin: false,
  hasRemote: false,
  upstream: null
}
const noUpstream: GitStatusResult = { ...configured, upstream: null }

// refreshGitStatus が次に返すステータス。操作を解決する前に、テストが「main の処理の後の状態」に差し替える
let nextStatus: GitStatusResult = configured

// useAppState の合成(remoteSetup)と同じ形で、実物の 2 つのフックを SourceControlPanel に渡す
function Harness({ initial }: { initial: GitStatusResult }): React.JSX.Element {
  const [gitStatus, setGitStatus] = useState(initial)
  const refreshGitStatus = useCallback(async (): Promise<void> => {
    setGitStatus(nextStatus)
  }, [])
  const refreshHistory = useCallback(async (): Promise<void> => {}, [])
  const remoteOps = useGitRemoteOperations(gitStatus, refreshGitStatus, undefined, refreshHistory)
  const setup = useGitRemoteSetup(gitStatus, refreshGitStatus, refreshHistory)
  const remoteSetup: RemoteSetupPanelState = {
    ...setup,
    isSettingUpstream: remoteOps.isSettingUpstream,
    isPushing: remoteOps.isPushing,
    isPushBlocked: remoteOps.isPushBlocked,
    remoteOperationError: remoteOps.remoteOperationError,
    pushSetUpstream: remoteOps.pushSetUpstream
  }
  return (
    <SourceControlPanel
      {...otherProps}
      gitStatus={gitStatus}
      isPushing={remoteOps.isPushing}
      isPulling={remoteOps.isPulling}
      isFetching={remoteOps.isFetching}
      isPushBlocked={remoteOps.isPushBlocked}
      isPullBlocked={remoteOps.isPullBlocked}
      isRemoteOperationDisabled={remoteOps.isRemoteOperationDisabled}
      onPush={remoteOps.push}
      onPull={remoteOps.pull}
      onFetch={remoteOps.fetchRemote}
      remoteOperationError={remoteOps.remoteOperationError}
      remoteSetup={remoteSetup}
    />
  )
}

type Pending = { resolve: () => void; reject: (err: Error) => void }

// 次の 1 回の呼び出しを保留させ、解決・失敗を後から起こせるようにする
const holdNext = (setImpl: (impl: () => Promise<void>) => void): Pending => {
  const handlers: Pending = { resolve: () => {}, reject: () => {} }
  setImpl(
    () =>
      new Promise<void>((resolve, reject) => {
        handlers.resolve = () => resolve()
        handlers.reject = reject
      })
  )
  return { resolve: () => handlers.resolve(), reject: (err) => handlers.reject(err) }
}

// ブラウザは disabled になった入力欄からフォーカスを外し body に落とす。jsdom は外さず、disabled の要素の blur() も
// 無視するため、外の要素を経由して body に落とした状態を再現する
const dropFocusToBody = (): void => {
  const outside = document.createElement('input')
  document.body.appendChild(outside)
  act(() => {
    outside.focus()
    outside.blur()
  })
  outside.remove()
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks は呼び出し履歴だけを消し、mockResolvedValue などの実装は残す。前のテストの実装が
  // 後のテストへ漏れないよう、テストで実装を差し替える gitApi の関数は実装ごとリセットする
  vi.mocked(gitApi.initRepository).mockReset()
  vi.mocked(gitApi.addOrigin).mockReset()
  vi.mocked(gitApi.pushSetUpstream).mockReset()
  nextStatus = configured
})

describe('リモートの管理の流れ(実物のフックと SourceControlPanel)', () => {
  it('初期化: 実行中は閉じられず、成功するとリポジトリの表示に変わり「リモートを追加」へフォーカスが移る', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.initRepository).mockImplementationOnce(impl)
    )
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    expect(gitApi.initRepository).toHaveBeenCalledWith('main')
    expect(screen.getByRole('button', { name: '初期化中...' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('初期化中です')
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ブランチ名' }), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'リポジトリを初期化' })).toBeInTheDocument()

    // act の中で解決すると、実機の「描画の後でフォーカスを移す」順序が再現しない。act の外で解決し、
    // React の通常のスケジューラで再描画させる(パターン 86)
    nextStatus = noOrigin
    pending.resolve()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'リモートを追加' })).toHaveFocus()
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('リモートが未設定です')).toBeInTheDocument()
  })

  it('初期化: 失敗はダイアログ内に alert で出て入力欄へフォーカスが戻り、再試行の実行中は alert が消える', async () => {
    const first = holdNext((impl) => vi.mocked(gitApi.initRepository).mockImplementationOnce(impl))
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    dropFocusToBody()
    nextStatus = notRepo
    await act(async () => {
      first.reject(new Error('ブランチ名として使用できない名前です: main'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ブランチ名として使用できない名前です: main'
    )
    expect(screen.getByRole('textbox', { name: 'ブランチ名' })).toHaveFocus()

    const second = holdNext((impl) => vi.mocked(gitApi.initRepository).mockImplementationOnce(impl))
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('初期化中です')
    await act(async () => {
      second.reject(new Error('ブランチ名として使用できない名前です: main'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'ブランチ名として使用できない名前です: main'
    )
  })

  // 初期化は成功したが直後のステータスの取り直しが失敗した(握りつぶされ、Git 管理外の表示のまま)場合、移す先の
  // 「リモートを追加」が無い。フォーカスを body に落とさず、開いたボタンへ戻す
  it('初期化: 成功しても取り直し後に Git 管理外のままなら、「リポジトリを初期化」へフォーカスを戻す', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.initRepository).mockImplementationOnce(impl)
    )
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    nextStatus = notRepo
    pending.resolve()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'リポジトリを初期化' })).toHaveFocus()
    )
    expect(screen.queryByRole('button', { name: 'リモートを追加' })).not.toBeInTheDocument()
  })

  it('初期化: 実行中に利用者が別の要素へ移していたら、成功してもフォーカスを奪わない', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.initRepository).mockImplementationOnce(impl)
    )
    render(<Harness initial={notRepo} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
    await userEvent.keyboard('{Enter}')
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    try {
      act(() => outside.focus())
      nextStatus = noOrigin
      pending.resolve()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      // 否定のアサーションは、遅れて走る effect がフォーカスを奪うのを見逃さないよう、描画をもう 1 回待ってから評価する
      await act(async () => {})
      expect(outside).toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  it('追加: 成功するとバナーが upstream の未設定に変わり「初回 push（upstream を設定）」へフォーカスが移る', async () => {
    vi.mocked(gitApi.addOrigin).mockResolvedValueOnce(undefined)
    render(<Harness initial={noOrigin} />)
    await userEvent.click(screen.getByRole('button', { name: 'リモートを追加' }))
    nextStatus = noUpstream
    await userEvent.type(screen.getByRole('textbox', { name: 'URL' }), '/abs/bare.git{Enter}')
    expect(gitApi.addOrigin).toHaveBeenCalledWith('/abs/bare.git')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '初回 push（upstream を設定）' })).toHaveFocus()
    )
    expect(screen.getByText('upstream が未設定です（main）')).toBeInTheDocument()
  })

  it('初回 push: 実行中はバナーとツールバーが push 中になり、成功するとバナーが消えて「プッシュ」へフォーカスが移る', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.pushSetUpstream).mockImplementationOnce(impl)
    )
    render(<Harness initial={noUpstream} />)
    await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
    expect(screen.getByRole('button', { name: 'push 中' })).toBeDisabled()
    expect(
      screen.getByText('初回 push 中です。応答が 30 秒途絶えると打ち切ります')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'プッシュ中' })).toBeDisabled()

    nextStatus = configured
    pending.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'プッシュ' })).toHaveFocus())
    expect(screen.queryByText('upstream が未設定です（main）')).not.toBeInTheDocument()
  })

  it('初回 push: 失敗はパネル上部に出て、バナーは残る', async () => {
    vi.mocked(gitApi.pushSetUpstream).mockRejectedValueOnce(
      new Error('コミットが無いため、初回 push できません。先にコミットしてください')
    )
    nextStatus = noUpstream
    render(<Harness initial={noUpstream} />)
    await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
    expect(
      await screen.findByText('コミットが無いため、初回 push できません。先にコミットしてください')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '初回 push（upstream を設定）' })).toBeEnabled()
  })

  // 実行中はボタンが disabled になりフォーカスが body に落ちる。失敗して押せるに戻ったら、ボタンへ戻す
  // (実物のフックでは、エラーが入った後に実行中が解ける順序であることも併せて確かめる。Task 7 のレビューで追加)
  it('初回 push: 失敗して実行中が解けたら、フォーカスがバナーのボタンへ戻る', async () => {
    const pending = holdNext((impl) =>
      vi.mocked(gitApi.pushSetUpstream).mockImplementationOnce(impl)
    )
    nextStatus = noUpstream
    render(<Harness initial={noUpstream} />)
    await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
    dropFocusToBody()
    pending.reject(new Error('初回 push に失敗しました: x'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '初回 push（upstream を設定）' })).toHaveFocus()
    )
    expect(screen.getByText('初回 push に失敗しました: x')).toBeInTheDocument()
  })
})
