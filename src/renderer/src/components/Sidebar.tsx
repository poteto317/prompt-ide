import PromptsPanel from './prompts/PromptsPanel'
import ExplorerPanel from './explorer/ExplorerPanel'
import PanelContainer from './PanelContainer'
import { sidebarTitles } from '../config/sidebarTitles'
import type { Panel, FileTreeNode, Prompt } from '../types'

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
}: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar__header">{sidebarTitles[activePanel]}</div>
      {/*
        各パネルを常時マウントして state を維持する。
        activePanel に応じて表示/非表示のみ切り替える。
      */}
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
        <PromptsPanel prompts={prompts} onAdd={onAddPrompt} onDelete={onDeletePrompt} />
      </PanelContainer>
      <PanelContainer isActive={activePanel === 'source-control'}>
        <p className="source-control-panel__placeholder">ソース管理は未実装です</p>
      </PanelContainer>
    </div>
  )
}
