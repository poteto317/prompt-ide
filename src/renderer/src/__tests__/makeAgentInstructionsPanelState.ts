import { vi } from 'vitest'
import {
  AGENT_INSTRUCTION_FILES,
  agentInstructionRelativePath
} from '@shared/agentInstructionFiles'
import type { AgentInstructionsPanelState } from '../types'

/** テスト用の指示ファイルの節の状態。既定は claude の 3 行がすべて無い・作成中でない・文言なし */
export const makeAgentInstructionsPanelState = (
  overrides: Partial<AgentInstructionsPanelState> = {}
): AgentInstructionsPanelState => ({
  cliKind: 'claude',
  rows: AGENT_INSTRUCTION_FILES.claude.map((file) => ({
    file,
    relativePath: agentInstructionRelativePath(file),
    node: null
  })),
  isCreating: false,
  message: null,
  open: vi.fn<AgentInstructionsPanelState['open']>(),
  create: vi.fn<AgentInstructionsPanelState['create']>().mockResolvedValue(undefined),
  ...overrides
})
