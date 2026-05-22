import type { FileTreeNode } from '../../types'
import FileTreeItem from './FileTreeItem'

interface Props {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFilePath: string | null
  onOpenFolder: () => void
  onSelectFile: (node: FileTreeNode) => void
  error: Error | null
}

export default function ExplorerPanel({
  folderPath,
  fileTree,
  openFilePath,
  onOpenFolder,
  onSelectFile,
  error,
}: Props) {
  return (
    <div className="explorer-panel">
      {error && <p className="explorer-panel__error">{error.message}</p>}
      {folderPath === null ? (
        <button
          type="button"
          className="explorer-panel__open-btn"
          onClick={onOpenFolder}
        >
          フォルダを開く
        </button>
      ) : (
        <div role="tree" className="file-tree">
          {fileTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              openFilePath={openFilePath}
              onSelectFile={onSelectFile}
              depth={0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
