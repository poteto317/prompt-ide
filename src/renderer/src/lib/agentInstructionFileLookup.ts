// 指示ファイルの有無の判定(設計書 2026-11-05「有無の判定」)。パスの文字列ではなく名前で根からたどる
// (renderer の folderPath と main の realpath 済みの許可フォルダの書き方が違いうるため)。名前は完全一致(L-009)
import type { FileTreeNode } from '../types'
import { isFileNode } from './fileUtils'

export function findAgentInstructionFileNode(
  tree: readonly FileTreeNode[],
  segments: readonly string[]
): FileTreeNode | null {
  let level: readonly FileTreeNode[] = tree
  for (let index = 0; index < segments.length; index += 1) {
    const node = level.find((candidate) => candidate.name === segments[index])
    if (node === undefined) return null
    if (index === segments.length - 1) return isFileNode(node) ? node : null
    if (node.type !== 'directory') return null
    level = node.children ?? []
  }
  return null
}
