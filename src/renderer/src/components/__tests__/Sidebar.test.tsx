import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from '../Sidebar'
import type {
  AgentReferencesPanelState,
  DiscardAllState,
  HistoryEntry,
  HistoryEntryActions,
  MergeStatePanelState,
  StashPanelState
} from '../../types'
import { sidebarTitles } from '../../config/sidebarTitles'
import { makeGitTagPanelState } from '../../__tests__/makeGitTagPanelState'
import { makeRemoteSetupPanelState } from '../../__tests__/makeRemoteSetupPanelState'
import { makeCloneRepositoryPanelState } from '../../__tests__/makeCloneRepositoryPanelState'
import { makeAgentReferencesPanelState } from '../../__tests__/makeAgentReferencesState'
import { makePromptListModePanelState } from '../../__tests__/makePromptListModePanelState'

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

const defaultProps = {
  folderPath: null as string | null,
  fileTree: [],
  openFilePath: null as string | null,
  onOpenFolder: vi.fn(),
  onSelectFile: vi.fn(),
  onCreateFile: vi.fn(),
  onCreateDirectory: vi.fn(),
  onRenameEntry: vi.fn(),
  onDeleteEntry: vi.fn(),
  error: null as Error | null,
  gitignoreError: null as Error | null,
  prompts: [],
  onAddPrompt: vi.fn(),
  onDeletePrompt: vi.fn(),
  onEditPrompt: vi.fn(),
  onReorderPrompt: vi.fn(),
  onTogglePromptPin: vi.fn(),
  onExportPrompts: vi.fn(),
  onImportPrompts: vi.fn(),
  onRunPrompt: vi.fn(),
  isExecuting: false,
  tasks: [],
  onAddTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onRecordEvent: vi.fn(),
  onCompleteStage: vi.fn(),
  onReopenStage: vi.fn(),
  onSkipStage: vi.fn(),
  onAdvanceStage: vi.fn(),
  history: [],
  onDeleteHistoryEntry: vi.fn(),
  onClearHistory: vi.fn(),
  onRerunHistoryEntry: vi.fn(),
  getHistoryActions: vi.fn(
    (): HistoryEntryActions => ({ rerun: { disabled: false, reason: null }, resume: null })
  ),
  onResumeHistoryEntry: vi.fn(),
  gitStatus: null,
  gitLoading: false,
  gitError: null,
  onRefreshGitStatus: vi.fn(),
  stagingPaths: new Set<string>(),
  onStageFile: vi.fn(),
  onDiscardFile: vi.fn(),
  onUnstageFile: vi.fn(),
  isCommitting: false,
  onCommit: vi.fn(),
  gitOperationError: null as Error | null,
  isPushing: false,
  isPulling: false,
  isFetching: false,
  isPushBlocked: false,
  isPullBlocked: false,
  isRemoteOperationDisabled: false,
  onPush: vi.fn().mockResolvedValue(undefined),
  onPull: vi.fn().mockResolvedValue(undefined),
  onFetch: vi.fn().mockResolvedValue(undefined),
  gitRemoteOperationError: null as Error | null,
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
  clone: makeCloneRepositoryPanelState(),
  gitBranchOperationError: null as Error | null,
  onOpenDiff: vi.fn(),
  onAmend: vi.fn().mockResolvedValue(true),
  lastCommitMessage: null as string | null,
  log: [],
  branches: [],
  tags: [],
  hasMoreLog: false,
  isLoadingLog: false,
  isLoadingFolder: false,
  historyError: null as Error | null,
  onLoadMoreLog: vi.fn(),
  onAddToGitignore: vi.fn(),
  hasKey: false,
  apiKeyLoaded: true,
  keyStoreError: null as string | null,
  onSaveApiKey: vi.fn(),
  modelSettings: { modelId: 'claude-haiku-4-5' as const, maxTokens: 4096 },
  modelSettingsLoaded: true,
  onSaveModelSettings: vi.fn(),
  agentSendConfirm: { enabled: true, saveError: null, onChange: vi.fn() },
  agentCliKind: {
    kind: 'claude' as const,
    fallback: null,
    saveError: null,
    isLocked: false,
    isSwitching: false,
    lockedReason: null,
    onSelect: vi.fn()
  },
  agentReferences: null as AgentReferencesPanelState | null,
  promptListMode: makePromptListModePanelState()
}

describe('Sidebar', () => {
  it('explorer: 正しいヘッダーが表示され ExplorerPanel が描画される', () => {
    render(<Sidebar activePanel="explorer" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.explorer)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'フォルダを開く' })).toBeInTheDocument()
  })

  it('source-control: 正しいヘッダーが表示される', () => {
    render(<Sidebar activePanel="source-control" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles['source-control'])).toBeInTheDocument()
  })

  it('source-control: mergeState がバナーまで届く(マージ中の件数が出る)', () => {
    render(
      <Sidebar
        activePanel="source-control"
        {...defaultProps}
        gitStatus={{
          isRepo: true,
          mergeInProgress: true,
          hasOrigin: true,
          hasRemote: true,
          upstream: 'origin/main',
          detached: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          files: []
        }}
        mergeState={{ ...emptyMergeState, inProgress: true, unresolvedCount: 4 }}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('マージ中（未解決 4 件）')
  })

  it('source-control: gitTag が履歴セクションまで届く', async () => {
    const gitTag = makeGitTagPanelState()
    render(
      <Sidebar
        activePanel="source-control"
        {...defaultProps}
        gitStatus={{
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
        }}
        gitTag={gitTag}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'タグを作成' }))
    expect(gitTag.clearError).toHaveBeenCalledOnce()
  })

  it('explorer: clone が「リポジトリを clone」とダイアログまで届く', async () => {
    const clone = makeCloneRepositoryPanelState()
    render(<Sidebar {...defaultProps} activePanel="explorer" clone={clone} />)
    await userEvent.click(screen.getByRole('button', { name: 'リポジトリを clone' }))
    expect(clone.clearError).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'リポジトリを clone' })).toBeInTheDocument()
  })

  it('source-control: remoteSetup がバナーまで届く', async () => {
    const remoteSetup = makeRemoteSetupPanelState()
    render(
      <Sidebar
        activePanel="source-control"
        {...defaultProps}
        gitStatus={{
          isRepo: true,
          mergeInProgress: false,
          hasOrigin: false,
          hasRemote: false,
          upstream: null,
          detached: false,
          branch: 'main',
          ahead: 0,
          behind: 0,
          files: []
        }}
        remoteSetup={remoteSetup}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'リモートを追加' }))
    expect(remoteSetup.clearAddOriginError).toHaveBeenCalledOnce()
  })

  it('prompts: ヘッダーが表示され PromptsPanel が描画される', () => {
    render(<Sidebar activePanel="prompts" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.prompts)).toBeInTheDocument()
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('prompts 以外のパネルに切り替えると PromptsPanel のラッパーに sidebar__panel--hidden クラスが付く', () => {
    const { rerender, container } = render(<Sidebar activePanel="prompts" {...defaultProps} />)

    rerender(<Sidebar activePanel="explorer" {...defaultProps} />)

    // explorer に切り替え: PromptsPanel のラッパーが hidden
    const panels = container.querySelectorAll('.sidebar__panel')
    const promptsWrapper = Array.from(panels).find((el) =>
      el.textContent?.includes('プロンプトがありません')
    )
    expect(promptsWrapper).toHaveClass('sidebar__panel--hidden')
    // PromptsPanel 自体は DOM に残っている
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('source-control: explorer/prompts/progress/history/settings パネルは非表示で SourceControlPanel が表示される', () => {
    const { container } = render(<Sidebar activePanel="source-control" {...defaultProps} />)
    const panels = Array.from(container.querySelectorAll('.sidebar__panel'))
    const hiddenPanels = panels.filter((p) => p.classList.contains('sidebar__panel--hidden'))
    const activePanels = panels.filter((p) => !p.classList.contains('sidebar__panel--hidden'))
    expect(hiddenPanels).toHaveLength(5)
    expect(activePanels).toHaveLength(1)
    expect(screen.getByText('フォルダを開いてください')).toBeInTheDocument()
  })

  it('progress: 正しいヘッダーが表示され ProgressPanel が描画される', () => {
    render(<Sidebar activePanel="progress" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.progress)).toBeInTheDocument()
    // tasks=[] なので ProgressPanel の空メッセージが表示される
    expect(screen.getByText('タスクがありません')).toBeInTheDocument()
  })

  it('history: 正しいヘッダーが表示され HistoryPanel が描画される', () => {
    render(<Sidebar activePanel="history" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.history)).toBeInTheDocument()
    expect(screen.getByText('履歴がありません')).toBeInTheDocument()
  })

  it('settings: 正しいヘッダーが表示され SettingsPanel が描画される', () => {
    render(<Sidebar activePanel="settings" {...defaultProps} />)
    expect(screen.getByText(sidebarTitles.settings)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '保存' })[0]).toBeInTheDocument()
  })

  it('explorer に切り替えても PromptsPanel は DOM に残る（常時マウント）', () => {
    const { rerender } = render(<Sidebar activePanel="prompts" {...defaultProps} />)
    rerender(<Sidebar activePanel="explorer" {...defaultProps} />)
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('error が渡されたとき ExplorerPanel に error.message が表示される', () => {
    render(
      <Sidebar activePanel="explorer" {...defaultProps} error={new Error('folder open failed')} />
    )
    expect(screen.getByText('folder open failed')).toBeInTheDocument()
  })

  it('prompts: onReorderPrompt を渡すと PromptsPanel 経由で並び替えハンドルが表示される', () => {
    render(
      <Sidebar
        activePanel="prompts"
        {...defaultProps}
        prompts={[{ id: 'p1', title: 'プロンプト1', content: '内容1', createdAt: 1000000 }]}
      />
    )
    expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
  })

  describe('参照(エージェントへ送るプロンプトの @ 参照)', () => {
    it('prompts: 参照の状態をプロンプトパネルの参照の行へ渡す', () => {
      render(
        <Sidebar
          activePanel="prompts"
          {...defaultProps}
          agentReferences={makeAgentReferencesPanelState()}
        />
      )
      expect(screen.getByRole('group', { name: '参照' })).toBeInTheDocument()
    })

    it('explorer: 参照の状態があれば、ファイルの「参照として添える」で onAddFromExplorer に絶対パスを渡す', async () => {
      const agentReferences = makeAgentReferencesPanelState()
      render(
        <Sidebar
          activePanel="explorer"
          {...defaultProps}
          folderPath="/p"
          fileTree={[{ name: 'a.ts', path: '/p/a.ts', type: 'file' }]}
          agentReferences={agentReferences}
        />
      )
      fireEvent.contextMenu(screen.getByText('a.ts'))
      await userEvent.click(screen.getByRole('menuitem', { name: '参照として添える' }))
      expect(agentReferences.onAddFromExplorer).toHaveBeenCalledExactlyOnceWith('/p/a.ts')
    })

    it('explorer: 参照の状態が無ければ「参照として添える」を出さない', () => {
      render(
        <Sidebar
          activePanel="explorer"
          {...defaultProps}
          folderPath="/p"
          fileTree={[{ name: 'a.ts', path: '/p/a.ts', type: 'file' }]}
        />
      )
      fireEvent.contextMenu(screen.getByText('a.ts'))
      expect(screen.queryByRole('menuitem', { name: '参照として添える' })).toBeNull()
    })
  })
})

describe('Sidebar: プロンプトの実行の状態の受け渡し', () => {
  const promptRun = {
    isRunDisabled: true,
    runDisabledReason: 'エージェントが起動していません（ターミナルの「起動」を押してください）',
    agentSend: { error: null, notice: null },
    showToolSelector: false,
    runAriaLabel: '実行（エージェントに送信）'
  }

  it('プロンプトパネルへ押せない理由・ツールの選択の有無を渡す', () => {
    render(<Sidebar {...defaultProps} activePanel="prompts" promptRun={promptRun} />)
    expect(screen.getByText(promptRun.runDisabledReason)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '実行ツールを選択' })).toBeNull()
  })

  it('promptRun が無ければ従来どおり(ツールの選択を出す)', () => {
    render(<Sidebar {...defaultProps} activePanel="prompts" />)
    expect(screen.getByRole('combobox', { name: '実行ツールを選択' })).toBeInTheDocument()
  })

  it('設定パネルへ実行方式を渡す', () => {
    render(
      <Sidebar
        {...defaultProps}
        activePanel="settings"
        executionMode={{
          mode: 'legacy',
          saveError: null,
          isLocked: false,
          isSwitching: false,
          onSelect: vi.fn()
        }}
      />
    )
    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  it('設定パネルへ実行方式を選べない理由を渡す', () => {
    render(
      <Sidebar
        {...defaultProps}
        activePanel="settings"
        executionMode={{
          mode: 'legacy',
          saveError: null,
          isLocked: true,
          isSwitching: false,
          lockedReason: '従来の方式で実行している間は、実行方式を切り替えられません',
          onSelect: vi.fn()
        }}
      />
    )
    expect(screen.getByRole('radio', { name: /^従来の方式/ })).toHaveAccessibleDescription(
      '従来の方式で実行している間は、実行方式を切り替えられません'
    )
  })
})

describe('Sidebar: 履歴のエントリごとの操作の受け渡し', () => {
  it('getHistoryActions と onResumeHistoryEntry を履歴のパネルへ渡す(取り違え・渡し忘れを確かめる。L-060)', async () => {
    const entry: HistoryEntry = {
      id: 'h1',
      promptId: 'p1',
      promptTitle: '要約',
      promptContent: '本文',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: 1000,
      agent: {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        cliKind: 'claude',
        tabLabel: 'claude 1',
        folderPath: '/w'
      }
    }
    const onResumeHistoryEntry = vi.fn()
    const onRerunHistoryEntry = vi.fn()
    render(
      <Sidebar
        {...defaultProps}
        activePanel="history"
        history={[entry]}
        onRerunHistoryEntry={onRerunHistoryEntry}
        onResumeHistoryEntry={onResumeHistoryEntry}
        getHistoryActions={() => ({
          rerun: { disabled: true, reason: '再実行の理由' },
          resume: { disabled: false, reason: null }
        })}
      />
    )
    // 設定パネルの使うエージェント CLI の radio も DOM にあるため、履歴の項目の名前で絞る
    await userEvent.click(screen.getByRole('radio', { name: /^要約/ }))
    expect(screen.getByText('再実行の理由')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'このセッションで再開' }))
    expect(onResumeHistoryEntry).toHaveBeenCalledExactlyOnceWith(entry)
    expect(onRerunHistoryEntry).not.toHaveBeenCalled()
  })
})

describe('Sidebar: 一覧の編集モード / 表示モードの受け渡し', () => {
  it('promptListMode をプロンプトパネルのトグルと一覧へ渡す(渡し忘れ・取り違えを確かめる。L-060)', async () => {
    const onChange = vi.fn()
    render(
      <Sidebar
        activePanel="prompts"
        {...defaultProps}
        prompts={[{ id: 'p1', title: 'プロンプト1', content: '内容1', createdAt: 1000000 }]}
        promptListMode={makePromptListModePanelState({
          mode: 'view',
          saveError: 'モードの設定を保存できませんでした: 理由',
          onChange
        })}
      />
    )
    const toggle = screen.getByRole('button', { name: '編集モード' })
    expect(toggle).toHaveTextContent('編集モード: オフ')
    expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プロンプトを削除' })).not.toBeInTheDocument()
    expect(screen.getByText('モードの設定を保存できませんでした: 理由')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('edit')
  })
})
