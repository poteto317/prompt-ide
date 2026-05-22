import type { FileTreeNode } from '../../types'

interface Props {
  node: FileTreeNode
  openFilePath: string | null
  onSelectFile: (node: FileTreeNode) => void
  depth: number
}

const INDENT_PX = 12
const ICON_OFFSET_PX = 16

export default function FileItem({ node, openFilePath, onSelectFile, depth }: Props) {
  const isActive = node.path === openFilePath
  return (
    <div
      role="treeitem"
      aria-selected={isActive}
      className={`file-tree__item file-tree__item--file${isActive ? ' file-tree__item--active' : ''}`}
      style={{ paddingLeft: depth * INDENT_PX + ICON_OFFSET_PX }}
      onClick={() => onSelectFile(node)}
    >
      {node.name}
    </div>
  )
}
