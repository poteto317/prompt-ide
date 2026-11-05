import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentInstructionFileId } from '@shared/agentInstructionFiles'
import type { AgentInstructionCreateResult } from '@shared/types'

/** expectedRoot は renderer が開いているフォルダ。main は許可フォルダと違えば作らずに folderChanged を返す */
export function createAgentInstructionFile(
  expectedRoot: string,
  cliKind: AgentCliKind,
  fileId: AgentInstructionFileId
): Promise<AgentInstructionCreateResult> {
  return window.api.createAgentInstructionFile(expectedRoot, cliKind, fileId)
}
