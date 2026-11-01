import PromptsPanel from './prompts/PromptsPanel'
import ProgressPanel from './progress/ProgressPanel'
import HistoryPanel from './history/HistoryPanel'
import ExplorerPanel from './explorer/ExplorerPanel'
import type { ExplorerPanelProps } from './explorer/ExplorerPanel'
import SourceControlPanel from './source-control/SourceControlPanel'
import type { SourceControlPanelProps } from './source-control/SourceControlPanel'
import SettingsPanel from './settings/SettingsPanel'
import PanelContainer from './PanelContainer'
import AgentSendFeedbackAnnouncer from './agent/AgentSendFeedbackAnnouncer'
import { sidebarTitles } from '../config/sidebarTitles'
import type {
  PromptToolId,
  Panel,
  Prompt,
  Task,
  StageId,
  HistoryEntry,
  HistoryEntryActions,
  PromptRunPanelState,
  ExecutionModePanelState,
  AgentNotificationPanelState,
  AgentSendConfirmPanelState,
  AgentCliKindPanelState,
  AgentReferencesPanelState,
  PromptListModePanelState
} from '../types'
import type { ModelSettings } from '@shared/types'
import { alwaysUnlocked } from '../hooks/useFileOperationLock'

interface Props
  extends
    Omit<ExplorerPanelProps, 'onAddReference'>,
    Omit<
      SourceControlPanelProps,
      | 'branchOperationError'
      | 'onDiscard'
      | 'onRefresh'
      | 'onStage'
      | 'onUnstage'
      | 'operationError'
      | 'remoteOperationError'
    > {
  activePanel: Panel
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
  /** 履歴のエントリごとの 再実行・このセッションで再開 の押せる条件(useAgentWorkspace の getHistoryActions。省略できない。L-060) */
  getHistoryActions: (entry: HistoryEntry) => HistoryEntryActions
  /** 履歴の このセッションで再開(useAgentWorkspace の onResume。省略できない。L-060) */
  onResumeHistoryEntry: (entry: HistoryEntry) => void
  onRefreshGitStatus: () => void
  onStageFile: (path: string) => void
  onDiscardFile: (path: string) => void
  onUnstageFile: (path: string, renamedFrom?: string) => void
  gitOperationError: Error | null
  gitRemoteOperationError: Error | null
  gitBranchOperationError: Error | null
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSaveApiKey: (key: string) => Promise<void>
  modelSettings: ModelSettings
  modelSettingsLoaded: boolean
  onSaveModelSettings: (settings: ModelSettings) => Promise<void>
  /** 実行ボタンの押せる条件と送信の結果。省略時は isExecuting で押せなくする(従来どおり) */
  promptRun?: PromptRunPanelState
  /** プロンプトの実行方式の設定。省略時は設定パネルに実行方式を出さない */
  executionMode?: ExecutionModePanelState
  /** エージェントの通知の設定。省略時は設定パネルに出さない */
  agentNotification?: AgentNotificationPanelState
  /** エージェントへの送信前の確認の設定(省略できない。L-060) */
  agentSendConfirm: AgentSendConfirmPanelState
  /** 使うエージェント CLI の設定(省略できない。L-060) */
  agentCliKind: AgentCliKindPanelState
  /** エージェントへ送るプロンプトの参照(プロンプトパネルの参照の行と、エクスプローラの「参照として添える」)。エージェント CLI 方式で
   *  フォルダを開いているときだけで、それ以外は null。省略できない(L-060) */
  agentReferences: AgentReferencesPanelState | null
  /** サイドバーの幅(px)。省略時は CSS の既定 */
  width?: number
  /** プロンプト一覧の編集モード / 表示モード(プロンプトパネルのトグルの行と、`編集`・`削除` の出し分け)。省略できない(L-060) */
  promptListMode: PromptListModePanelState
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
  clone,
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
  getHistoryActions,
  onResumeHistoryEntry,
  gitStatus,
  gitLoading,
  gitError,
  onRefreshGitStatus,
  stagingPaths,
  isLocked = alwaysUnlocked,
  isAnyLocked = alwaysUnlocked,
  onStageFile,
  onDiscardFile,
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
  isSyncing,
  isSyncBlocked,
  onSync,
  gitRemoteOperationError,
  stash,
  discardAll,
  mergeState,
  gitTag,
  remoteSetup,
  agentChanges,
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
  onSaveModelSettings,
  promptRun,
  executionMode,
  agentNotification,
  agentSendConfirm,
  agentCliKind,
  agentReferences,
  promptListMode,
  width
}: Props): React.JSX.Element {
  // 送信の結果の見える文字は、見えているパネル(プロンプト・実行履歴)の 1 か所だけに出す。読み上げはパネルの外に常に置いた
  // 1 か所(AgentSendFeedbackAnnouncer)だけが担う。パネルの中に置くと、隠れたパネル(display: none)では読まれず、
  // 切り替えのたびにマウントし直して古い失敗を読み直すため
  const agentSend = promptRun?.agentSend ?? null
  return (
    <div className="sidebar" style={width === undefined ? undefined : { width }}>
      {/* ソース管理の見出しは、更新などのボタンと同じ行に並べるためパネルのツールバーが出す */}
      {activePanel !== 'source-control' && (
        <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      )}
      {agentSend !== null && <AgentSendFeedbackAnnouncer feedback={agentSend} />}
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
          clone={clone}
          onAddReference={
            agentReferences === null
              ? undefined
              : (node) => agentReferences.onAddFromExplorer(node.path)
          }
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
          isRunDisabled={promptRun?.isRunDisabled ?? isExecuting}
          runDisabledReason={promptRun?.runDisabledReason ?? null}
          agentSend={activePanel === 'prompts' ? agentSend : null}
          showToolSelector={promptRun?.showToolSelector ?? true}
          runAriaLabel={promptRun?.runAriaLabel}
          isActive={activePanel === 'prompts'}
          agentReferences={agentReferences}
          promptListMode={promptListMode}
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
          getHistoryActions={getHistoryActions}
          onResume={onResumeHistoryEntry}
          agentSend={activePanel === 'history' ? agentSend : null}
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
          onDiscard={onDiscardFile}
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
          isSyncing={isSyncing}
          isSyncBlocked={isSyncBlocked}
          onSync={onSync}
          remoteOperationError={gitRemoteOperationError}
          stash={stash}
          discardAll={discardAll}
          mergeState={mergeState}
          gitTag={gitTag}
          remoteSetup={remoteSetup}
          agentChanges={agentChanges}
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
          executionMode={executionMode}
          agentNotification={agentNotification}
          agentSendConfirm={agentSendConfirm}
          agentCliKind={agentCliKind}
        />
      </PanelContainer>
    </div>
  )
}
