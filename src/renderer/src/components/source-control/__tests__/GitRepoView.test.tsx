import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { GitFileStatus } from '@shared/types'
import type { DiscardAllState, StashPanelState } from '../../../types'
import GitRepoView from '../GitRepoView'

const emptyStash: StashPanelState = {
  entries: [],
  pendingOperation: null,
  error: null,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPop: vi.fn().mockResolvedValue(undefined),
  onDrop: vi.fn().mockResolvedValue(true)
}

const emptyDiscardAll: DiscardAllState = {
  isDiscarding: false,
  error: null,
  onDiscardAll: vi.fn().mockResolvedValue(undefined)
}

const noFiles: GitFileStatus[] = []

const stagedFile: GitFileStatus = { path: 'staged.ts', index: 'A', workingDir: ' ' }
const changedFile: GitFileStatus = { path: 'changed.ts', index: ' ', workingDir: 'M' }

const baseProps = {
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
  pendingBranchOperation: null,
  onCheckoutBranch: vi.fn().mockResolvedValue(undefined),
  onCreateBranch: vi.fn().mockResolvedValue(true),
  onDeleteBranch: vi.fn().mockResolvedValue(true),
  onMergeBranch: vi.fn().mockResolvedValue(undefined),
  stash: emptyStash,
  discardAll: emptyDiscardAll
}

describe('GitRepoView', () => {
  it('branch 名が表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={noFiles} {...baseProps} />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('branch 名がブランチ切り替えボタン(BranchSwitcher)として描画され、クリックするとブランチ一覧が開く', async () => {
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        {...baseProps}
        branches={[
          { name: 'main', current: true },
          { name: 'feature/x', current: false }
        ]}
      />
    )
    const trigger = screen.getByRole('button', { name: 'ブランチを切り替え' })
    expect(trigger).toHaveTextContent('main')
    await userEvent.click(trigger)
    expect(screen.getByRole('radio', { name: /feature\/x/ })).toBeInTheDocument()
  })

  // コードレビュー指摘: BranchSwitcher のトリガーボタンが pendingBranchOperation のみで
  // disabled 判定しており、stage/unstage・ハンク操作・commit・pull 実行中
  // (isAnyLocked)でもクリックできてしまい、実際には isBusy() でサイレントに
  // no-op になる無反応な操作に見えていた。isBlockedByOtherOperation
  // (CommitSection に渡しているものと同じ値)を BranchSwitcher にも渡す
  it('isAnyLocked が true のとき、BranchSwitcher のトリガーボタンが disabled になる', () => {
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        {...baseProps}
        isAnyLocked={() => true}
      />
    )
    const trigger = screen.getByRole('button', {
      name: '他の操作が完了するまでブランチを切り替えられません'
    })
    expect(trigger).toBeDisabled()
  })

  it('stagingPaths が空でなく isAnyLocked が false のとき、BranchSwitcher のトリガーボタンが disabled になる', () => {
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        {...baseProps}
        stagingPaths={new Set(['a.ts'])}
      />
    )
    const trigger = screen.getByRole('button', {
      name: '他の操作が完了するまでブランチを切り替えられません'
    })
    expect(trigger).toBeDisabled()
  })

  it('branch が null のとき "(no branch)" が表示される', () => {
    render(<GitRepoView branch={null} ahead={0} behind={0} files={noFiles} {...baseProps} />)
    expect(screen.getByText('(no branch)')).toBeInTheDocument()
  })

  it('ahead > 0 のとき "↑N" が表示される', () => {
    render(<GitRepoView branch="main" ahead={3} behind={0} files={noFiles} {...baseProps} />)
    expect(screen.getByText('↑3')).toBeInTheDocument()
  })

  it('behind > 0 のとき "↓N" が表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={2} files={noFiles} {...baseProps} />)
    expect(screen.getByText('↓2')).toBeInTheDocument()
  })

  it('ahead = 0 のとき ahead インジケーターが表示されない', () => {
    const { container } = render(
      <GitRepoView branch="main" ahead={0} behind={0} files={noFiles} {...baseProps} />
    )
    expect(container.querySelector('.source-control-panel__ahead')).toBeNull()
  })

  it('behind = 0 のとき behind インジケーターが表示されない', () => {
    const { container } = render(
      <GitRepoView branch="main" ahead={0} behind={0} files={noFiles} {...baseProps} />
    )
    expect(container.querySelector('.source-control-panel__behind')).toBeNull()
  })

  it('files が空のとき「変更はありません」が表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={noFiles} {...baseProps} />)
    expect(screen.getByText('変更はありません')).toBeInTheDocument()
  })

  it('files が空でないとき「変更はありません」は表示されない', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={[stagedFile]} {...baseProps} />)
    expect(screen.queryByText('変更はありません')).not.toBeInTheDocument()
  })

  it('staged ファイルが StagedSection に委譲され「ステージ済み」セクションが表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={[stagedFile]} {...baseProps} />)
    expect(screen.getByText('ステージ済み (1)')).toBeInTheDocument()
    expect(screen.getByText('staged.ts')).toBeInTheDocument()
  })

  it('changed ファイルが ChangesSection に委譲され「変更」セクションが表示される', () => {
    render(<GitRepoView branch="main" ahead={0} behind={0} files={[changedFile]} {...baseProps} />)
    expect(screen.getByText('変更 (1)')).toBeInTheDocument()
    expect(screen.getByText('changed.ts')).toBeInTheDocument()
  })

  it('onStage/onUnstage/onCommit が ChangesSection/StagedSection/CommitSection に配線される', async () => {
    const files: GitFileStatus[] = [
      { path: 'staged.ts', index: 'M', workingDir: ' ' },
      { path: 'changed.ts', index: ' ', workingDir: 'M' }
    ]
    const onStage = vi.fn()
    const onUnstage = vi.fn()
    const onCommit = vi.fn().mockResolvedValue(true)
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={files}
        stagingPaths={new Set()}
        onStage={onStage}
        onDiscard={vi.fn()}
        onUnstage={onUnstage}
        onOpenDiff={vi.fn()}
        isCommitting={false}
        onCommit={onCommit}
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
        pendingBranchOperation={null}
        onCheckoutBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranch={vi.fn().mockResolvedValue(true)}
        onDeleteBranch={vi.fn().mockResolvedValue(true)}
        onMergeBranch={vi.fn().mockResolvedValue(undefined)}
        stash={emptyStash}
        discardAll={emptyDiscardAll}
      />
    )
    await userEvent.click(screen.getByLabelText('changed.ts をステージ'))
    expect(onStage).toHaveBeenCalledWith('changed.ts')
    await userEvent.click(screen.getByLabelText('staged.ts をアンステージ'))
    expect(onUnstage).toHaveBeenCalledWith('staged.ts', undefined)
    expect(screen.getByLabelText('コミットメッセージ')).toBeInTheDocument()
  })

  it('ChangesSection の取り消しボタンから onDiscard が呼ばれる', async () => {
    const onDiscard = vi.fn()
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        {...baseProps}
        files={[{ path: 'src/a.ts', index: ' ', workingDir: 'M' }]}
        onDiscard={onDiscard}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'src/a.ts の変更を取り消し' }))
    expect(onDiscard).toHaveBeenCalledWith('src/a.ts')
  })

  it('historyError が HistorySection に渡りエラーメッセージが表示される', () => {
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        {...baseProps}
        historyError={new Error('spawn git ENOENT')}
      />
    )
    expect(screen.getByText('spawn git ENOENT')).toBeInTheDocument()
  })

  it('CommitSection と HistorySection に必要な props が渡る', () => {
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={[]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onUnstage={vi.fn()}
        onOpenDiff={vi.fn()}
        isCommitting={false}
        onCommit={vi.fn().mockResolvedValue(true)}
        lastCommitMessage="feat: 直前のコミット"
        onAmend={vi.fn().mockResolvedValue(true)}
        log={[{ hash: 'abc1234', message: 'feat: 新機能', date: 'd', authorName: 'x' }]}
        branches={[{ name: 'main', current: true }]}
        tags={[]}
        hasMoreLog={false}
        isLoadingLog={false}
        isLoadingFolder={false}
        historyError={null}
        onLoadMoreLog={vi.fn()}
        pendingBranchOperation={null}
        onCheckoutBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranch={vi.fn().mockResolvedValue(true)}
        onDeleteBranch={vi.fn().mockResolvedValue(true)}
        onMergeBranch={vi.fn().mockResolvedValue(undefined)}
        stash={emptyStash}
        discardAll={emptyDiscardAll}
      />
    )
    expect(screen.getByText('feat: 新機能')).toBeInTheDocument()
    expect(
      screen.getByText('main', { selector: '.history-section__badge--branch-current' })
    ).toBeInTheDocument()
  })

  it('ChangesSection の onOpenDiff は staged=false で呼ばれる', async () => {
    const onOpenDiff = vi.fn()
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={[{ path: 'a.ts', index: ' ', workingDir: 'M' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onUnstage={vi.fn()}
        onOpenDiff={onOpenDiff}
        isCommitting={false}
        onCommit={vi.fn().mockResolvedValue(true)}
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
        pendingBranchOperation={null}
        onCheckoutBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranch={vi.fn().mockResolvedValue(true)}
        onDeleteBranch={vi.fn().mockResolvedValue(true)}
        onMergeBranch={vi.fn().mockResolvedValue(undefined)}
        stash={emptyStash}
        discardAll={emptyDiscardAll}
      />
    )
    await userEvent.click(screen.getByText('a.ts'))
    expect(onOpenDiff).toHaveBeenCalledWith('a.ts', false)
  })

  it('StagedSection の onOpenDiff は staged=true で呼ばれる', async () => {
    const onOpenDiff = vi.fn()
    render(
      <GitRepoView
        branch="main"
        ahead={0}
        behind={0}
        files={[{ path: 'a.ts', index: 'M', workingDir: ' ' }]}
        stagingPaths={new Set()}
        onStage={vi.fn()}
        onDiscard={vi.fn()}
        onUnstage={vi.fn()}
        onOpenDiff={onOpenDiff}
        isCommitting={false}
        onCommit={vi.fn().mockResolvedValue(true)}
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
        pendingBranchOperation={null}
        onCheckoutBranch={vi.fn().mockResolvedValue(undefined)}
        onCreateBranch={vi.fn().mockResolvedValue(true)}
        onDeleteBranch={vi.fn().mockResolvedValue(true)}
        onMergeBranch={vi.fn().mockResolvedValue(undefined)}
        stash={emptyStash}
        discardAll={emptyDiscardAll}
      />
    )
    await userEvent.click(screen.getByText('a.ts'))
    expect(onOpenDiff).toHaveBeenCalledWith('a.ts', true)
  })

  it('BranchSwitcher の削除ボタンから onDeleteBranch が呼ばれる', async () => {
    const onDeleteBranch = vi.fn().mockResolvedValue(true)
    render(
      <GitRepoView
        {...baseProps}
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        branches={[
          { name: 'main', current: true },
          { name: 'feature/x', current: false }
        ]}
        onDeleteBranch={onDeleteBranch}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
    await userEvent.click(screen.getByRole('button', { name: 'ブランチ feature/x を削除' }))
    expect(onDeleteBranch).toHaveBeenCalledWith('feature/x')
  })

  it('BranchSwitcher のマージボタンから onMergeBranch が呼ばれる', async () => {
    const onMergeBranch = vi.fn().mockResolvedValue(undefined)
    render(
      <GitRepoView
        {...baseProps}
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        branches={[
          { name: 'main', current: true },
          { name: 'feature/x', current: false }
        ]}
        onMergeBranch={onMergeBranch}
        stash={emptyStash}
        discardAll={emptyDiscardAll}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'ブランチを切り替え' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'ブランチ feature/x を現在のブランチにマージ' })
    )
    expect(onMergeBranch).toHaveBeenCalledWith('feature/x')
  })

  it('「退避」セクションを変更の下・履歴の上に表示する', () => {
    render(
      <GitRepoView
        {...baseProps}
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        stash={{ ...emptyStash, entries: [] }}
        discardAll={emptyDiscardAll}
      />
    )
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings.indexOf('退避（0）')).toBeGreaterThan(-1)
    expect(headings.indexOf('退避（0）')).toBeLessThan(headings.indexOf('履歴'))
  })

  it('退避の操作は stash の props から呼ばれる(「退避する」→ onPush)', async () => {
    const onPush = vi.fn().mockResolvedValue(undefined)
    render(
      <GitRepoView
        {...baseProps}
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        stash={{ ...emptyStash, onPush }}
        discardAll={emptyDiscardAll}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '変更を退避する' }))
    await userEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onPush).toHaveBeenCalledWith('')
  })

  // 退避・復元は lockGlobal を取る。他の操作中(isAnyLocked)は押しても no-op になるため disabled にする
  it('他の操作中(isAnyLocked)は「退避する」が disabled になる', () => {
    render(
      <GitRepoView
        {...baseProps}
        branch="main"
        ahead={0}
        behind={0}
        files={noFiles}
        isAnyLocked={() => true}
      />
    )
    expect(screen.getByRole('button', { name: '変更を退避する' })).toBeDisabled()
  })

  it('discardAll は ChangesSection まで届く(「すべて取り消す」→ onDiscardAll、error は alert に出る)', async () => {
    const onDiscardAll = vi.fn().mockResolvedValue(undefined)
    render(
      <GitRepoView
        {...baseProps}
        branch="main"
        ahead={0}
        behind={0}
        files={[changedFile]}
        discardAll={{ isDiscarding: false, error: new Error('取り消せません'), onDiscardAll }}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '変更をすべて取り消す' }))
    expect(onDiscardAll).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('取り消せません')
  })
})
