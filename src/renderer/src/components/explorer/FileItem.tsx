import type { FileTreeNode } from '../../types'
import { isActivationKey } from '../../lib/activationKey'

interface Props {
  node: FileTreeNode
  openFilePath: string | null
  onSelectFile: (node: FileTreeNode) => void
  onContextMenu: (e: React.MouseEvent, node: FileTreeNode) => void
  depth: number
}

const INDENT_PX = 12
// ディレクトリの行の矢印の枠(幅 16px)と gap(4px)の分。ファイル名の左端をディレクトリ名に揃える
const ICON_OFFSET_PX = 20

export default function FileItem({
  node,
  openFilePath,
  onSelectFile,
  onContextMenu,
  depth
}: Props): React.JSX.Element {
  const isActive = node.path === openFilePath

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (isActivationKey(e.key)) {
      e.preventDefault()
      onSelectFile(node)
    }
  }

  return (
    <div
      role="treeitem"
      aria-selected={isActive}
      tabIndex={0}
      className={`file-tree__item file-tree__item--file${isActive ? ' file-tree__item--active' : ''}`}
      style={{ paddingLeft: depth * INDENT_PX + ICON_OFFSET_PX }}
      onClick={() => onSelectFile(node)}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => onContextMenu(e, node)}
    >
      {node.name}
    </div>
  )
}
