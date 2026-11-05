import { useState } from 'react'
import type {
  AgentInstructionsPanelState,
  CloneRepositoryPanelState,
  FileTreeNode
} from '../../types'
import { useContextMenu } from '../../hooks/useContextMenu'
import { buildMenuItems } from '../../lib/explorerMenuItems'
import FileTreeItem from './FileTreeItem'
import ExplorerContextMenu from './ExplorerContextMenu'
import NameInputDialog from './NameInputDialog'
import CloneRepositoryEntry from './CloneRepositoryEntry'
import AgentInstructionFilesSection from './AgentInstructionFilesSection'

export interface ExplorerPanelProps {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFilePath: string | null
  onOpenFolder: () => void
  onSelectFile: (node: FileTreeNode) => void
  error: Error | null
  /** .gitignore への追加が失敗した場合のエラー。フォルダ/ファイル読み込みの
   *  error とは別スロット(共有すると片方が他方の表示を上書きし消してしまう) */
  gitignoreError: Error | null
  onCreateFile: (parentPath: string, name: string) => void
  onCreateDirectory: (parentPath: string, name: string) => void
  onRenameEntry: (node: FileTreeNode, newName: string) => void
  onDeleteEntry: (node: FileTreeNode) => void
  onAddToGitignore: (node: FileTreeNode) => void
  /** リポジトリの clone の状態と操作(「リポジトリを clone」とダイアログ) */
  clone: CloneRepositoryPanelState
  /** 「エージェントの指示ファイル」の節(フォルダを開いているときだけ出す。省略できない。L-060) */
  agentInstructions: AgentInstructionsPanelState
  /** 右クリックの「参照として添える」(エージェント CLI 方式でフォルダを開いているときだけ渡す。ファイルにだけ出す) */
  onAddReference?: (node: FileTreeNode) => void
}

type DialogState =
  | { mode: 'createFile'; parentPath: string }
  | { mode: 'createDirectory'; parentPath: string }
  | { mode: 'rename'; node: FileTreeNode }

const DIALOG_TITLES = {
  createFile: '新規ファイル',
  createDirectory: '新規フォルダ'
} as const

export default function ExplorerPanel({
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
  onAddToGitignore,
  clone,
  agentInstructions,
  onAddReference
}: ExplorerPanelProps): React.JSX.Element {
  const { menu, openMenu, closeMenu } = useContextMenu()
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const handleDialogSubmit = (name: string): void => {
    if (dialog === null) return
    if (dialog.mode === 'createFile') {
      onCreateFile(dialog.parentPath, name)
    } else if (dialog.mode === 'createDirectory') {
      onCreateDirectory(dialog.parentPath, name)
    } else {
      onRenameEntry(dialog.node, name)
    }
    setDialog(null)
  }

  // clone の実行中はフォルダを変えさせない(成功するとフォルダが切り替わるため)。「リポジトリを clone」の入口
  // (CloneRepositoryEntry)は 2 つの分岐の同じ位置(2 番目)に置く。分岐が切り替わっても React が同じ部品として
  // 引き継ぐため、clone に成功してフォルダが開いたときも、ダイアログを閉じた後のフォーカスの戻しが保たれる
  return (
    <div className="explorer-panel">
      {error && <p className="explorer-panel__error">{error.message}</p>}
      {gitignoreError && <p className="explorer-panel__error">{gitignoreError.message}</p>}
      {folderPath === null ? (
        <>
          <button
            type="button"
            className="explorer-panel__open-btn"
            disabled={clone.isCloning}
            onClick={onOpenFolder}
          >
            フォルダを開く
          </button>
          <CloneRepositoryEntry clone={clone} />
        </>
      ) : (
        <>
          <button
            type="button"
            className="explorer-panel__change-btn"
            disabled={clone.isCloning}
            onClick={onOpenFolder}
          >
            フォルダを変更
          </button>
          <CloneRepositoryEntry clone={clone} />
          <AgentInstructionFilesSection state={agentInstructions} isBlocked={clone.isCloning} />
          <div
            role="tree"
            aria-label="ファイルツリー"
            className="file-tree"
            onContextMenu={(e) => openMenu(e, null)}
          >
            {fileTree.map((node) => (
              <FileTreeItem
                key={node.path}
                node={node}
                openFilePath={openFilePath}
                onSelectFile={onSelectFile}
                onContextMenu={openMenu}
                depth={0}
              />
            ))}
          </div>
        </>
      )}
      {menu !== null && (
        <ExplorerContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(folderPath, menu.node, {
            onCreateFile: (parentPath) => setDialog({ mode: 'createFile', parentPath }),
            onCreateDirectory: (parentPath) => setDialog({ mode: 'createDirectory', parentPath }),
            onRename: (node) => setDialog({ mode: 'rename', node }),
            onDelete: onDeleteEntry,
            onAddToGitignore,
            onAddReference
          })}
          onClose={closeMenu}
        />
      )}
      {dialog !== null && (
        <NameInputDialog
          title={
            dialog.mode === 'rename' ? `リネーム: ${dialog.node.name}` : DIALOG_TITLES[dialog.mode]
          }
          initialValue={dialog.mode === 'rename' ? dialog.node.name : ''}
          onSubmit={handleDialogSubmit}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}
