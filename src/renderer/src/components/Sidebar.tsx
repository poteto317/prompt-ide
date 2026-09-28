import PromptsPanel from './prompts/PromptsPanel'
import ProgressPanel from './progress/ProgressPanel'
import HistoryPanel from './history/HistoryPanel'
import ExplorerPanel from './explorer/ExplorerPanel'
import SourceControlPanel from './source-control/SourceControlPanel'
import SettingsPanel from './settings/SettingsPanel'
import PanelContainer from './PanelContainer'
import { sidebarTitles } from '../config/sidebarTitles'
import type {
  PromptToolId,
  Panel,
  FileTreeNode,
  Prompt,
  Task,
  StageId,
  HistoryEntry
} from '../types'
import type { GitBranch, GitLogEntry, GitStatusResult, ModelSettings } from '@shared/types'
import { alwaysUnlocked } from '../hooks/useFileOperationLock'
import type { BranchOperationKind } from '../hooks/useGitBranchOperations'

interface Props {
  activePanel: Panel
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFilePath: string | null
  onOpenFolder: () => void
  onSelectFile: (node: FileTreeNode) => void
  error: Error | null
  gitignoreError: Error | null
  onCreateFile: (parentPath: string, name: string) => void
  onCreateDirectory: (parentPath: string, name: string) => void
  onRenameEntry: (node: FileTreeNode, newName: string) => void
  onDeleteEntry: (node: FileTreeNode) => void
  prompts: Prompt[]
  onAddPrompt: (title: string, content: string) => void
  onDeletePrompt: (id: string) => void
  onEditPrompt: (id: string, title: string, content: string, tags: string[]) => void
  onReorderPrompt: (activeId: string, overId: string) => void
  onTogglePromptPin: (id: string) => void
  onExportPrompts: () => void
  onImportPrompts: () => void
  onRunPrompt: (content: string, toolId: PromptToolId, prompt: Prompt) => void
  isExecuting: boolean
  tasks: Task[]
  onAddTask: (title: string) => void
  onDeleteTask: (id: string) => void
  onRecordEvent: (taskId: string, stageId: StageId, note?: string) => void
  onCompleteStage: (taskId: string, stageId: StageId) => void
  onReopenStage: (taskId: string, stageId: StageId) => void
  onSkipStage: (taskId: string, stageId: StageId) => void
  onAdvanceStage: (taskId: string) => void
  history: HistoryEntry[]
  onDeleteHistoryEntry: (id: string) => void
  onClearHistory: () => void
  onRerunHistoryEntry: (entry: HistoryEntry) => void
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefreshGitStatus: () => void
  stagingPaths: ReadonlySet<string>
  isLocked?: (path: string) => boolean
  isAnyLocked?: () => boolean
  onStageFile: (path: string) => void
  onUnstageFile: (path: string, renamedFrom?: string) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  gitOperationError: Error | null
  isPushing: boolean
  isPulling: boolean
  isFetching: boolean
  isPushBlocked: boolean
  isPullBlocked: boolean
  isRemoteOperationDisabled: boolean
  onPush: () => Promise<void>
  onPull: () => Promise<void>
  onFetch: () => Promise<void>
  gitRemoteOperationError: Error | null
  pendingBranchOperation: BranchOperationKind | null
  onCheckoutBranch: (branchName: string) => Promise<void>
  gitBranchOperationError: Error | null
  onOpenDiff: (path: string, staged: boolean) => void
  onAmend: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMoreLog: boolean
  isLoadingLog: boolean
  isLoadingFolder: boolean
  historyError: Error | null
  onLoadMoreLog: () => void
  onAddToGitignore: (node: FileTreeNode) => void
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSaveApiKey: (key: string) => Promise<void>
  modelSettings: ModelSettings
  modelSettingsLoaded: boolean
  onSaveModelSettings: (settings: ModelSettings) => Promise<void>
}

export default function Sidebar({
  activePanel,
  folderPath,
  fileTree,
  openFilePath,
  onOpenFolder,
  onSelectFile,
  error,
  gitignoreError,
  onCreateFile,
  onCreateDirectory,
  onRenameEntry,
  onDeleteEntry,
  prompts,
  onAddPrompt,
  onDeletePrompt,
  onEditPrompt,
  onReorderPrompt,
  onTogglePromptPin,
  onExportPrompts,
  onImportPrompts,
  onRunPrompt,
  isExecuting,
  tasks,
  onAddTask,
  onDeleteTask,
  onRecordEvent,
  onCompleteStage,
  onReopenStage,
  onSkipStage,
  onAdvanceStage,
  history,
  onDeleteHistoryEntry,
  onClearHistory,
  onRerunHistoryEntry,
  gitStatus,
  gitLoading,
  gitError,
  onRefreshGitStatus,
  stagingPaths,
  isLocked = alwaysUnlocked,
  isAnyLocked = alwaysUnlocked,
  onStageFile,
  onUnstageFile,
  isCommitting,
  onCommit,
  gitOperationError,
  isPushing,
  isPulling,
  isFetching,
  isPushBlocked,
  isPullBlocked,
  isRemoteOperationDisabled,
  onPush,
  onPull,
  onFetch,
  gitRemoteOperationError,
  pendingBranchOperation,
  onCheckoutBranch,
  gitBranchOperationError,
  onOpenDiff,
  onAmend,
  lastCommitMessage,
  log,
  branches,
  tags,
  hasMoreLog,
  isLoadingLog,
  isLoadingFolder,
  historyError,
  onLoadMoreLog,
  onAddToGitignore,
  hasKey,
  apiKeyLoaded,
  keyStoreError,
  onSaveApiKey,
  modelSettings,
  modelSettingsLoaded,
  onSaveModelSettings
}: Props): React.JSX.Element {
  return (
    <div className="sidebar">
      <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      <PanelContainer isActive={activePanel === 'explorer'}>
        <ExplorerPanel
          folderPath={folderPath}
          fileTree={fileTree}
          openFilePath={openFilePath}
          onOpenFolder={onOpenFolder}
          onSelectFile={onSelectFile}
          error={error}
          gitignoreError={gitignoreError}
          onCreateFile={onCreateFile}
          onCreateDirectory={onCreateDirectory}
          onRenameEntry={onRenameEntry}
          onDeleteEntry={onDeleteEntry}
          onAddToGitignore={onAddToGitignore}
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'prompts'}>
        <PromptsPanel
          prompts={prompts}
          onAdd={onAddPrompt}
          onDelete={onDeletePrompt}
          onEdit={onEditPrompt}
          onReorder={onReorderPrompt}
          onTogglePin={onTogglePromptPin}
          onExport={onExportPrompts}
          onImport={onImportPrompts}
          onRun={onRunPrompt}
          isRunDisabled={isExecuting}
          isActive={activePanel === 'prompts'}
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'progress'}>
        <ProgressPanel
          tasks={tasks}
          onAddTask={onAddTask}
          onDeleteTask={onDeleteTask}
          onRecordEvent={onRecordEvent}
          onCompleteStage={onCompleteStage}
          onReopenStage={onReopenStage}
          onSkipStage={onSkipStage}
          onAdvanceStage={onAdvanceStage}
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'history'}>
        <HistoryPanel
          history={history}
          onDelete={onDeleteHistoryEntry}
          onClear={onClearHistory}
          onRerun={onRerunHistoryEntry}
          isRerunDisabled={isExecuting}
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'source-control'}>
        <SourceControlPanel
          gitStatus={gitStatus}
          gitLoading={gitLoading}
          gitError={gitError}
          onRefresh={onRefreshGitStatus}
          stagingPaths={stagingPaths}
          isLocked={isLocked}
          isAnyLocked={isAnyLocked}
          onStage={onStageFile}
          onUnstage={onUnstageFile}
          onOpenDiff={onOpenDiff}
          isCommitting={isCommitting}
          onCommit={onCommit}
          isPushing={isPushing}
          isPulling={isPulling}
          isFetching={isFetching}
          isPushBlocked={isPushBlocked}
          isPullBlocked={isPullBlocked}
          isRemoteOperationDisabled={isRemoteOperationDisabled}
          onPush={onPush}
          onPull={onPull}
          onFetch={onFetch}
          remoteOperationError={gitRemoteOperationError}
          pendingBranchOperation={pendingBranchOperation}
          onCheckoutBranch={onCheckoutBranch}
          branchOperationError={gitBranchOperationError}
          lastCommitMessage={lastCommitMessage}
          onAmend={onAmend}
          log={log}
          branches={branches}
          tags={tags}
          hasMoreLog={hasMoreLog}
          isLoadingLog={isLoadingLog}
          isLoadingFolder={isLoadingFolder}
          historyError={historyError}
          onLoadMoreLog={onLoadMoreLog}
          operationError={gitOperationError}
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'settings'}>
        <SettingsPanel
          hasKey={hasKey}
          apiKeyLoaded={apiKeyLoaded}
          keyStoreError={keyStoreError}
          onSave={onSaveApiKey}
          modelSettings={modelSettings}
          modelSettingsLoaded={modelSettingsLoaded}
          onSaveModelSettings={onSaveModelSettings}
        />
      </PanelContainer>
    </div>
  )
}
