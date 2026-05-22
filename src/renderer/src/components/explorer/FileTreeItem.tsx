import type { FileTreeNode } from '../../types'
import DirectoryItem from './DirectoryItem'
import FileItem from './FileItem'

interface Props {
  node: FileTreeNode
  openFilePath: string | null
  onSelectFile: (node: FileTreeNode) => void
  depth: number
}

export default function FileTreeItem(props: Props) {
  return props.node.type === 'directory' ? (
    <DirectoryItem {...props} />
  ) : (
    <FileItem {...props} />
  )
}
