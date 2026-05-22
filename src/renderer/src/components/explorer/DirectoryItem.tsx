import { useState } from 'react'
import type { FileTreeNode } from '../../types'
import FileTreeItem from './FileTreeItem'

interface Props {
  node: FileTreeNode
  openFilePath: string | null
  onSelectFile: (node: FileTreeNode) => void
  depth: number
}

const INDENT_PX = 12

export default function DirectoryItem({ node, openFilePath, onSelectFile, depth }: Props) {
  const [expanded, setExpanded] = useState(true)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setExpanded((prev) => !prev)
    }
  }

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={expanded}
        tabIndex={0}
        className="file-tree__item file-tree__item--directory"
        style={{ paddingLeft: depth * INDENT_PX }}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={handleKeyDown}
      >
        <span className="file-tree__item-icon">{expanded ? '▾' : '▸'}</span>
        {node.name}
      </div>
      {expanded && (
        <div role="group">
          {node.children?.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              openFilePath={openFilePath}
              onSelectFile={onSelectFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
