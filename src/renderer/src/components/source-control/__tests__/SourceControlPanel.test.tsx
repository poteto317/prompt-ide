import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import type { DiscardAllState, MergeStatePanelState, StashPanelState } from '../../../types'
import SourceControlPanel from '../SourceControlPanel'
import { makeGitTagPanelState } from '../../../__tests__/makeGitTagPanelState'
import { makeRemoteSetupPanelState } from '../../../__tests__/makeRemoteSetupPanelState'

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
  remoteSetup: makeRemoteSetupPanelState(),
  branchOperationError: null as Error | null
}

const repoStatus: GitStatusResult = {
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

describe('SourceControlPanel', () => {
  it('gitStatus.upstream を履歴へ渡す(上流のコミットの円が紫になる)', () => {
    const { container } = render(
      <SourceControlPanel
        {...baseProps}
        gitStatus={repoStatus}
        log={[
          {
            hash: 'a'.repeat(40),
            parents: [],
            refs: [{ kind: 'remote', name: 'origin/main' }],
            isHead: false,
            message: 'feat: 新機能',
            date: '2026-09-03T10:00:00+09:00',
            authorName: 'Alice'
          }
        ]}
      />
    )
    expect(container.querySelector('.history-section__graph circle')).toHaveAttribute(
      'fill',
      '#B180D7'
    )
  })

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
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false,
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
      hasOrigin: true,
      hasRemote: true,
      upstream: 'origin/main',
      detached: false,
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
        remoteSetup={makeRemoteSetupPanelState()}
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

  describe('リモートの管理', () => {
    const notRepoStatus: GitStatusResult = {
      ...repoStatus,
      isRepo: false,
      branch: null,
      hasOrigin: false,
      hasRemote: false,
      upstream: null
    }

    it('Git 管理外では「リポジトリを初期化」を出す', () => {
      render(<SourceControlPanel {...baseProps} gitStatus={notRepoStatus} />)
      expect(screen.getByText('Git リポジトリではありません')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'リポジトリを初期化' })).toBeEnabled()
    })

    // 他の Git 操作のロック中は、初期化のダイアログの「初期化」を押せない(isAnyLocked が NotRepositoryView へ届く)
    it('Git 管理外で他の操作中(isAnyLocked)は、初期化のダイアログの「初期化」が押せない', async () => {
      const { rerender } = render(<SourceControlPanel {...baseProps} gitStatus={notRepoStatus} />)
      await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
      expect(screen.getByRole('button', { name: '初期化' })).toBeEnabled()
      rerender(
        <SourceControlPanel {...baseProps} gitStatus={notRepoStatus} isAnyLocked={() => true} />
      )
      expect(screen.getByRole('button', { name: '初期化' })).toBeDisabled()
    })

    it('remoteSetup が Git 管理外の表示まで届く(リポジトリを初期化 → 前回のエラーを消す)', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      render(
        <SourceControlPanel {...baseProps} gitStatus={notRepoStatus} remoteSetup={remoteSetup} />
      )
      await userEvent.click(screen.getByRole('button', { name: 'リポジトリを初期化' }))
      expect(remoteSetup.clearInitError).toHaveBeenCalledOnce()
    })

    it('リモートが 1 つも無いリポジトリでは「リモートが未設定です」のバナーを出す', () => {
      render(
        <SourceControlPanel
          {...baseProps}
          gitStatus={{ ...repoStatus, hasOrigin: false, hasRemote: false, upstream: null }}
        />
      )
      expect(screen.getByText('リモートが未設定です')).toBeInTheDocument()
    })

    // git clone -o github など、origin 以外の名前のリモートだけを持つリポジトリ。既存の push / pull は
    // 通信できるため『リモートが未設定です』は出さない。初回 push は origin 固定で拒否されるため、upstream の
    // 無いブランチでも upstream のバナーを出さない(レビュー 8 周目)
    it.each([
      ['upstream あり', 'github/main'],
      ['upstream なし(新しいブランチ)', null]
    ])(
      'origin 以外の名前のリモートだけなら、リモートのバナーを出さない(%s)',
      (_label, upstream) => {
        render(
          <SourceControlPanel
            {...baseProps}
            gitStatus={{ ...repoStatus, hasOrigin: false, hasRemote: true, upstream }}
          />
        )
        expect(screen.queryByText('リモートが未設定です')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'リモートを追加' })).not.toBeInTheDocument()
        expect(screen.queryByText(/upstream が未設定です/)).not.toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: '初回 push（upstream を設定）' })
        ).not.toBeInTheDocument()
      }
    )

    it('upstream の無いブランチでは upstream のバナーを出し、設定済みなら出さない', () => {
      const { rerender } = render(
        <SourceControlPanel {...baseProps} gitStatus={{ ...repoStatus, upstream: null }} />
      )
      expect(screen.getByText('upstream が未設定です（main）')).toBeInTheDocument()
      rerender(<SourceControlPanel {...baseProps} gitStatus={repoStatus} />)
      expect(screen.queryByText('upstream が未設定です（main）')).not.toBeInTheDocument()
    })

    it('remoteSetup がバナーまで届く(リモートを追加 → 前回のエラーを消す)', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      render(
        <SourceControlPanel
          {...baseProps}
          gitStatus={{ ...repoStatus, hasOrigin: false, hasRemote: false, upstream: null }}
          remoteSetup={remoteSetup}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: 'リモートを追加' }))
      expect(remoteSetup.clearAddOriginError).toHaveBeenCalledOnce()
    })

    // 初回 push の成功の後は、ツールバーの「プッシュ」へ移す(パネルの中の印の付いたボタン)。要求の state は
    // このパネルの useRemoteSetupFocus が持ち、バナーへ requestFocus を渡す(移す条件はフックのテストで確かめる)
    it('バナーの初回 push に成功すると、バナーが消えた後にツールバーの「プッシュ」へフォーカスを移す', async () => {
      const remoteSetup = makeRemoteSetupPanelState()
      let resolvePush: (succeeded: boolean) => void = () => {}
      remoteSetup.pushSetUpstream = () =>
        new Promise<boolean>((resolve) => {
          resolvePush = resolve
        })
      const noUpstream = { ...repoStatus, upstream: null }
      const { rerender } = render(
        <SourceControlPanel {...baseProps} gitStatus={noUpstream} remoteSetup={remoteSetup} />
      )
      await userEvent.click(screen.getByRole('button', { name: '初回 push（upstream を設定）' }))
      // 実物では、成功の取り直しで upstream が付きバナーが消え、押したボタンにあったフォーカスは body に落ちる
      rerender(
        <SourceControlPanel {...baseProps} gitStatus={repoStatus} remoteSetup={remoteSetup} />
      )
      expect(document.body).toHaveFocus()
      await act(async () => resolvePush(true))
      expect(screen.getByRole('button', { name: 'プッシュ' })).toHaveFocus()
    })
  })
})
