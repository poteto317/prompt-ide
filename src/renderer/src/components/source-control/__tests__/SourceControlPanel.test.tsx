import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import type { DiscardAllState, MergeStatePanelState, StashPanelState } from '../../../types'
import SourceControlPanel from '../SourceControlPanel'
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

const baseProps = {
  gitStatus: null as GitStatusResult | null,
  gitLoading: false,
  gitError: null as Error | null,
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
  historyError: null as Error | null,
  onLoadMoreLog: vi.fn(),
  operationError: null as Error | null,
  isPushing: false,
  isPulling: false,
  isFetching: false,
  isPushBlocked: false,
  isPullBlocked: false,
  isRemoteOperationDisabled: false,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPull: vi.fn().mockResolvedValue(undefined),
  onFetch: vi.fn().mockResolvedValue(undefined),
  remoteOperationError: null as Error | null,
  pendingBranchOperation: null,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined),
  stash: emptyStash,
  discardAll: emptyDiscardAll,
  mergeState: emptyMergeState,
  gitTag: makeGitTagPanelState(),
  branchOperationError: null as Error | null
}

const repoStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

describe('SourceControlPanel', () => {
  it('gitStatus が null のとき「フォルダを開いてください」が表示される', () => {
    render(<SourceControlPanel {...baseProps} />)
    expect(screen.getByText('フォルダを開いてください')).toBeInTheDocument()
  })

  it('gitLoading が true のとき「読み込み中...」が表示される', () => {
    render(<SourceControlPanel {...baseProps} gitLoading={true} />)
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('gitLoading が true のとき「フォルダを開いてください」は表示されない', () => {
    render(<SourceControlPanel {...baseProps} gitLoading={true} />)
    expect(screen.queryByText('フォルダを開いてください')).not.toBeInTheDocument()
  })

  it('gitStatus を既に持っている状態での再取得中は、GitRepoView を保持したままにする', () => {
    // アンマウントすると CommitSection のローカル state(入力中のコミット
    // メッセージ・amend チェック)が破棄される。refreshGitStatus は stage/unstage/
    // commit/ファイル保存のたびに呼ばれるため、「メッセージを書いている途中に
    // ファイルを stage したら下書きが消えた」という事故になる
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} gitLoading={true} />)
    expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
  })

  it('gitStatus をまだ持っていない初回取得中だけ「読み込み中...」を表示する', () => {
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} gitLoading={true} />)
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
  })

  it('isRepo: false のとき「Git リポジトリではありません」が表示される', () => {
    const notRepo: GitStatusResult = {
      isRepo: false,
      mergeInProgress: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: []
    }
    render(<SourceControlPanel {...baseProps} gitStatus={notRepo} />)
    expect(screen.getByText('Git リポジトリではありません')).toBeInTheDocument()
  })

  it('files が空のときブランチ名と「変更はありません」が表示される', () => {
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} />)
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('変更はありません')).toBeInTheDocument()
  })

  it('ステージ済みファイルが「ステージ済み」セクションに表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'src/index.ts', index: 'M', workingDir: ' ' }]
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('ステージ済み (1)')).toBeInTheDocument()
    expect(screen.getByText('src/index.ts')).toBeInTheDocument()
  })

  it('ステージ済みファイルのステータス文字が表示される（M）', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'file.ts', index: 'A', workingDir: ' ' }]
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('変更ファイルが「変更」セクションに表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'README.md', index: ' ', workingDir: 'M' }]
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('未追跡ファイル（index="?", workingDir="?"）が「変更」セクションに U で表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [{ path: 'new-file.ts', index: '?', workingDir: '?' }]
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
    expect(screen.getByText('U')).toBeInTheDocument()
    expect(screen.getByText('new-file.ts')).toBeInTheDocument()
  })

  it('ステージ済みと変更の両セクションが同時に表示される', () => {
    const status: GitStatusResult = {
      ...repoStatus,
      files: [
        { path: 'staged.ts', index: 'A', workingDir: ' ' },
        { path: 'changed.ts', index: ' ', workingDir: 'M' }
      ]
    }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('ステージ済み (1)')).toBeInTheDocument()
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
  })

  it('ahead が正のとき「↑N」が表示される', () => {
    const status: GitStatusResult = { ...repoStatus, ahead: 3 }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('↑3')).toBeInTheDocument()
  })

  it('behind が正のとき「↓N」が表示される', () => {
    const status: GitStatusResult = { ...repoStatus, behind: 2 }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('↓2')).toBeInTheDocument()
  })

  // 更新ボタンのクリックで onRefresh が呼ばれること自体は、Panel が受け取った
  // props を SourceControlToolbar へ正しく橋渡ししているかの確認。ボタンの
  // disabled 判定など Toolbar 内部の表示ロジックは SourceControlToolbar.test.tsx
  // 側の責務であり、ここでは重複させない
  it('更新ボタンをクリックすると onRefresh が呼ばれる', async () => {
    const onRefresh = vi.fn()
    render(<SourceControlPanel {...baseProps} onRefresh={onRefresh} />)
    await userEvent.click(screen.getByRole('button', { name: '更新' }))
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('gitError が渡されたとき error.message が表示される', () => {
    render(<SourceControlPanel {...baseProps} gitError={new Error('git fatal error')} />)
    expect(screen.getByText('git fatal error')).toBeInTheDocument()
  })

  it('branch が null のとき "(no branch)" が表示される', () => {
    const status: GitStatusResult = { ...repoStatus, branch: null }
    render(<SourceControlPanel {...baseProps} gitStatus={status} />)
    expect(screen.getByText('(no branch)')).toBeInTheDocument()
  })

  it('operationError があれば表示する', () => {
    const gitStatus: GitStatusResult = {
      isRepo: true,
      mergeInProgress: false,
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: []
    }
    render(
      <SourceControlPanel
        gitStatus={gitStatus}
        gitLoading={false}
        gitError={null}
        onRefresh={vi.fn()}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
        isCommitting={false}
        onCommit={vi.fn()}
        lastCommitMessage={null}
        onAmend={vi.fn().mockResolvedValue(true)}
        log={[]}
        branches={[]}
        tags={[]}
        hasMoreLog={false}
        isLoadingLog={false}
        isLoadingFolder={false}
        historyError={null}
        onLoadMoreLog={vi.fn()}
        operationError={new Error('ステージに失敗しました')}
        isPushing={false}
        isPulling={false}
        isFetching={false}
        isPushBlocked={false}
        isPullBlocked={false}
        isRemoteOperationDisabled={false}
        onPush={vi.fn()}
        onPull={vi.fn()}
        onFetch={vi.fn()}
        remoteOperationError={null}
        pendingBranchOperation={null}
        onCheckoutBranch={vi.fn()}
        onCreateBranch={vi.fn().mockResolvedValue(true)}
        onDeleteBranch={vi.fn().mockResolvedValue(true)}
        onMergeBranch={vi.fn().mockResolvedValue(undefined)}
        stash={emptyStash}
        discardAll={emptyDiscardAll}
        mergeState={emptyMergeState}
        gitTag={makeGitTagPanelState()}
        branchOperationError={null}
      />
    )
    expect(screen.getByText('ステージに失敗しました')).toBeInTheDocument()
  })

  it('historyError が渡ると HistorySection にエラーメッセージが表示される', () => {
    render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={repoStatus}
        historyError={new Error('spawn git ENOENT')}
      />
    )
    expect(screen.getByText('spawn git ENOENT')).toBeInTheDocument()
  })

  // 更新ボタンと同じ理由(Panel → Toolbar への橋渡し確認)。disabled 判定の
  // 全パターン(gitStatus null・isRepo false・isPulling/isPushing 相互排他等)は
  // SourceControlToolbar.test.tsx 側で検証済みのため、ここでは重複させない
  it('フェッチボタンをクリックすると onFetch が呼ばれる', async () => {
    const onFetch = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} onFetch={onFetch} />)
    await userEvent.click(screen.getByRole('button', { name: 'フェッチ' }))
    expect(onFetch).toHaveBeenCalledOnce()
  })

  it('プルボタンをクリックすると onPull が呼ばれる', async () => {
    const onPull = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} onPull={onPull} />)
    await userEvent.click(screen.getByRole('button', { name: 'プル' }))
    expect(onPull).toHaveBeenCalledOnce()
  })

  it('プッシュボタンをクリックすると onPush が呼ばれる', async () => {
    const onPush = vi.fn().mockResolvedValue(undefined)
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} onPush={onPush} />)
    await userEvent.click(screen.getByRole('button', { name: 'プッシュ' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  it('remoteOperationError があれば表示する', () => {
    render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={repoStatus}
        remoteOperationError={new Error('fatal: Authentication failed')}
      />
    )
    expect(screen.getByText('fatal: Authentication failed')).toBeInTheDocument()
  })

  it('branchOperationError があれば表示する', () => {
    render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={repoStatus}
        branchOperationError={new Error('checkout failed')}
      />
    )
    expect(screen.getByText('checkout failed')).toBeInTheDocument()
  })

  it('mergeState は GitRepoView のバナーまで届く(マージ中ならバナー、そうでなければ出ない)', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <SourceControlPanel {...baseProps} gitStatus={repoStatus} mergeState={emptyMergeState} />
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    rerender(
      <SourceControlPanel
        {...baseProps}
        gitStatus={repoStatus}
        mergeState={{
          ...emptyMergeState,
          inProgress: true,
          unresolvedCount: 0,
          canComplete: true,
          onComplete
        }}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'マージ中（すべて解決済み。マージを完了できます）'
    )
    await userEvent.click(screen.getByRole('button', { name: 'マージを完了' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('gitTag は GitRepoView を経て履歴セクションまで届く', async () => {
    const gitTag = makeGitTagPanelState({ error: new Error('タグの失敗') })
    render(<SourceControlPanel {...baseProps} gitStatus={repoStatus} gitTag={gitTag} />)
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    expect(screen.getByRole('alert')).toHaveTextContent('タグの失敗')
  })
})
