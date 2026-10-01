import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Sidebar from '../Sidebar'
import type { DiscardAllState, MergeStatePanelState, StashPanelState } from '../../types'
import { sidebarTitles } from '../../config/sidebarTitles'

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
  onSaveModelSettings: vi.fn()
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
})
