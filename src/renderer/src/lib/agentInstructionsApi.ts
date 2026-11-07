import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFileId } from '@shared/agentInstructionFiles'
import type {
  AgentInstructionCreateResult,
  GlobalAgentInstructionCreateResult,
  GlobalAgentInstructionStatus
} from '@shared/types'

/** expectedRoot は renderer が開いているフォルダ。main は許可フォルダと違えば作らずに folderChanged を返す */
export function createAgentInstructionFile(
  expectedRoot: string,
  cliKind: AgentCliKind,
  fileId: AgentInstructionFileId
): Promise<AgentInstructionCreateResult> {
  return window.api.createAgentInstructionFile(expectedRoot, cliKind, fileId)
}

/** 全体の指示ファイルの有無。送るのは CLI の種類だけ */
export function getGlobalAgentInstructionStatus(
  cliKind: AgentCliKind
): Promise<GlobalAgentInstructionStatus> {
  return window.api.getGlobalAgentInstructionStatus(cliKind)
}

/** 全体の指示ファイルを作る。送るのは CLI の種類だけ */
export function createGlobalAgentInstructionFile(
  cliKind: AgentCliKind
): Promise<GlobalAgentInstructionCreateResult> {
  return window.api.createGlobalAgentInstructionFile(cliKind)
}
