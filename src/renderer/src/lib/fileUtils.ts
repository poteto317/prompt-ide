import type { FileTreeNode, OpenFile } from '../types'
import { detectLanguage } from './languageDetector'

export function createOpenFile(node: FileTreeNode, content: string): OpenFile {
  return { path: node.path, name: node.name, content, language: detectLanguage(node.name) }
}
