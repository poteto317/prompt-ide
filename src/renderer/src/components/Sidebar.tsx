import PromptsPanel from './prompts/PromptsPanel'
import ExplorerPanel from './explorer/ExplorerPanel'
import SourceControlPanel from './source-control/SourceControlPanel'
import SettingsPanel from './settings/SettingsPanel'
import PanelContainer from './PanelContainer'
import { sidebarTitles } from '../config/sidebarTitles'
import type { Panel, FileTreeNode, Prompt } from '../types'
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
  onRunPrompt: (content: string) => void
  isExecuting: boolean
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefreshGitStatus: () => void
  hasKey: boolean
  apiKeyLoaded: boolean
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
  onRunPrompt,
  isExecuting,
  gitStatus,
  gitLoading,
  gitError,
  onRefreshGitStatus,
  hasKey,
  apiKeyLoaded,
  onSaveApiKey,
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
          onRun={onRunPrompt}
          isRunDisabled={isExecuting}
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
          onSave={onSaveApiKey}
        />
      </PanelContainer>
    </div>
  )
}
