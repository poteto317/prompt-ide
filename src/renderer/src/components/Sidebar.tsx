import PromptsPanel from './prompts/PromptsPanel'
import ProgressPanel from './progress/ProgressPanel'
import ExplorerPanel from './explorer/ExplorerPanel'
import SourceControlPanel from './source-control/SourceControlPanel'
import SettingsPanel from './settings/SettingsPanel'
import PanelContainer from './PanelContainer'
import { sidebarTitles } from '../config/sidebarTitles'
import type { Panel, FileTreeNode, Prompt, Task, StageId } from '../types'
import type { GitStatusResult } from '@shared/types'

interface Props {
  activePanel: Panel
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFilePath: string | null
  onOpenFolder: () => void
  onSelectFile: (node: FileTreeNode) => void
  error: Error | null
  prompts: Prompt[]
  onAddPrompt: (title: string, content: string) => void
  onDeletePrompt: (id: string) => void
  onEditPrompt: (id: string, title: string, content: string) => void
  onRunPrompt: (content: string) => void
  isExecuting: boolean
  tasks: Task[]
  onAddTask: (title: string) => void
  onDeleteTask: (id: string) => void
  onRecordEvent: (taskId: string, stageId: StageId, note?: string) => void
  onCompleteStage: (taskId: string, stageId: StageId) => void
  onReopenStage: (taskId: string, stageId: StageId) => void
  onSkipStage: (taskId: string, stageId: StageId) => void
  onAdvanceStage: (taskId: string) => void
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefreshGitStatus: () => void
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSaveApiKey: (key: string) => Promise<void>
}

export default function Sidebar({
  activePanel,
  folderPath,
  fileTree,
  openFilePath,
  onOpenFolder,
  onSelectFile,
  error,
  prompts,
  onAddPrompt,
  onDeletePrompt,
  onEditPrompt,
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
  gitStatus,
  gitLoading,
  gitError,
  onRefreshGitStatus,
  hasKey,
  apiKeyLoaded,
  keyStoreError,
  onSaveApiKey
}: Props) {
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
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'prompts'}>
        <PromptsPanel
          prompts={prompts}
          onAdd={onAddPrompt}
          onDelete={onDeletePrompt}
          onEdit={onEditPrompt}
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
      <PanelContainer isActive={activePanel === 'source-control'}>
        <SourceControlPanel
          gitStatus={gitStatus}
          gitLoading={gitLoading}
          gitError={gitError}
          onRefresh={onRefreshGitStatus}
        />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'settings'}>
        <SettingsPanel
          hasKey={hasKey}
          apiKeyLoaded={apiKeyLoaded}
          keyStoreError={keyStoreError}
          onSave={onSaveApiKey}
        />
      </PanelContainer>
    </div>
  )
}
