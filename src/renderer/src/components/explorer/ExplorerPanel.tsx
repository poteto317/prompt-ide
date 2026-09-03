import { useState } from 'react'
import type { FileTreeNode } from '../../types'
import { useContextMenu } from '../../hooks/useContextMenu'
import { buildMenuItems } from '../../lib/explorerMenuItems'
import FileTreeItem from './FileTreeItem'
import ExplorerContextMenu from './ExplorerContextMenu'
import NameInputDialog from './NameInputDialog'

interface Props {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFilePath: string | null
  onOpenFolder: () => void
  onSelectFile: (node: FileTreeNode) => void
  error: Error | null
  onCreateFile: (parentPath: string, name: string) => void
  onCreateDirectory: (parentPath: string, name: string) => void
  onRenameEntry: (node: FileTreeNode, newName: string) => void
  onDeleteEntry: (node: FileTreeNode) => void
  onAddToGitignore: (node: FileTreeNode) => void
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
  onCreateFile,
  onCreateDirectory,
  onRenameEntry,
  onDeleteEntry,
  onAddToGitignore
}: Props): React.JSX.Element {
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

  return (
    <div className="explorer-panel">
      {error && <p className="explorer-panel__error">{error.message}</p>}
      {folderPath === null ? (
        <button type="button" className="explorer-panel__open-btn" onClick={onOpenFolder}>
          フォルダを開く
        </button>
      ) : (
        <>
          <button type="button" className="explorer-panel__change-btn" onClick={onOpenFolder}>
            フォルダを変更
          </button>
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
            onAddToGitignore
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
