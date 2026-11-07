// サブフォルダの指示ファイルの探索(設計書 2026-11-07「探索」)。ツリーに出ているものだけをたどる。除外(SKIP_DIRS)と深さ(MAX_DEPTH)は
// main がツリーを作るときに済んでいるので、ここで書き直さない。相対パスはノードの path ではなく、たどった名前からつなぐ
// (renderer の folderPath と main の realpath 済みのパスの書き方が違いうるため)。名前は完全一致(L-009)
import type { AgentInstructionSubfolderSpec } from '@shared/agentInstructionFiles'
import type { AgentInstructionSubfolderRow, FileTreeNode } from '../types'
import { isFileNode } from './fileUtils'

export const AGENT_INSTRUCTION_SUBFOLDER_LIMIT = 50

export interface AgentInstructionSubfolderLookupResult {
  /** 並べ替えて上限までに切った分 */
  rows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  total: number
}

interface Found {
  row: AgentInstructionSubfolderRow
  parentSegments: readonly string[]
  /** spec.names の中の位置(同じフォルダの中の並び) */
  nameIndex: number
}

function isSameSegments(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

/** 親フォルダを区切りごとに比べる。片方がもう片方の祖先なら祖先を先にする */
function compareParents(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const order = a[index].localeCompare(b[index])
    if (order !== 0) return order
  }
  return a.length - b.length
}

function collect(
  nodes: readonly FileTreeNode[],
  parentSegments: readonly string[],
  spec: AgentInstructionSubfolderSpec,
  excludedSegments: readonly (readonly string[])[],
  found: Found[]
): void {
  for (const node of nodes) {
    if (node.type === 'directory') {
      collect(node.children ?? [], [...parentSegments, node.name], spec, excludedSegments, found)
      continue
    }
    // 根(0 段目)の直下のファイルは「このフォルダ」の分
    if (parentSegments.length === 0 || !isFileNode(node)) continue
    const nameIndex = spec.names.findIndex((entry) => entry.name === node.name)
    if (nameIndex === -1) continue
    const segments = [...parentSegments, node.name]
    if (excludedSegments.some((excluded) => isSameSegments(excluded, segments))) continue
    found.push({
      row: {
        relativePath: segments.join('/'),
        description: spec.names[nameIndex].description,
        node
      },
      parentSegments,
      nameIndex
    })
  }
}

export function findAgentInstructionSubfolderFiles(
  tree: readonly FileTreeNode[],
  spec: AgentInstructionSubfolderSpec,
  excludedSegments: readonly (readonly string[])[],
  limit: number = AGENT_INSTRUCTION_SUBFOLDER_LIMIT
): AgentInstructionSubfolderLookupResult {
  const found: Found[] = []
  collect(tree, [], spec, excludedSegments, found)
  // 並べ方を安定させるため、全件を集めて並べてから切る
  found.sort(
    (a, b) => compareParents(a.parentSegments, b.parentSegments) || a.nameIndex - b.nameIndex
  )
  return { rows: found.slice(0, limit).map((entry) => entry.row), total: found.length }
}
