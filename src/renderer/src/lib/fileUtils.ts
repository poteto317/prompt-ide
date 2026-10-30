import type { FileNode, FileTreeNode, OpenFile } from '../types'
import { detectLanguage } from './languageDetector'

/**
 * ツリーのノードがファイルか。FileTreeNode は判別可能なユニオンではないため、`node.type === 'file'` だけでは
 * node 自体は FileNode に絞り込まれない。この型ガードで絞り込む(`node as FileNode` のキャストを書かないため)
 */
export function isFileNode(node: FileTreeNode): node is FileNode {
  return node.type === 'file'
}

export function createOpenFile(node: FileNode, content: string): OpenFile {
  return {
    path: node.path,
    name: node.name,
    content,
    savedContent: content,
    language: detectLanguage(node.name)
  }
}
