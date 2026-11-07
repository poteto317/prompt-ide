// 全体の指示ファイルの問い合わせの状態から、表示用の行を作る(設計書 2026-11-07 global「状態」)。「無い」と「確かめられない」を分ける(L-002)
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { GlobalAgentInstructionStatus } from '@shared/types'
import type { AgentGlobalInstructionRow, FileTreeNode } from '../types'
import {
  AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME,
  AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED,
  agentGlobalInstructionUnavailableMessage
} from './agentInstructionMessages'

/** hook が持つ問い合わせの結果。null は未問い合わせ。queryFailed は IPC 自体の拒否 */
export type AgentGlobalInstructionQueryState = {
  cliKind: AgentCliKind
  status: GlobalAgentInstructionStatus | 'queryFailed'
} | null

/** 開くためのノード。name を ~/… にして、タブでフォルダの同じ名前のファイルと区別できるようにする */
export function toGlobalInstructionNode(
  status: Extract<GlobalAgentInstructionStatus, { kind: 'exists' }>
): FileTreeNode {
  return { type: 'file', name: status.displayPath, path: status.filePath }
}

export function toAgentGlobalInstructionRow(
  state: AgentGlobalInstructionQueryState,
  cliKind: AgentCliKind
): AgentGlobalInstructionRow {
  // CLI を切り替えた直後に、前の CLI の行を出さない
  if (state === null || state.cliKind !== cliKind) return { kind: 'loading' }
  const { status } = state
  const file = AGENT_GLOBAL_INSTRUCTION_FILES[cliKind]
  if (status === 'queryFailed') {
    return { kind: 'blocked', displayPath: null, message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED }
  }
  switch (status.kind) {
    case 'exists':
      return {
        kind: 'exists',
        displayPath: status.displayPath,
        description: file.description,
        node: toGlobalInstructionNode(status)
      }
    case 'missing':
      return { kind: 'missing', displayPath: status.displayPath, description: file.description }
    case 'linkOutsideHome':
      return {
        kind: 'blocked',
        displayPath: status.displayPath,
        message: AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME
      }
    case 'failed':
      return {
        kind: 'blocked',
        displayPath: status.displayPath,
        message: AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED
      }
    case 'unavailable':
      return {
        kind: 'blocked',
        displayPath: null,
        message: agentGlobalInstructionUnavailableMessage(status.reason, file.envName)
      }
  }
}
