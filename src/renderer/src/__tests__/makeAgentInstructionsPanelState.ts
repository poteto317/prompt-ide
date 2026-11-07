import { vi } from 'vitest'
import {
  AGENT_INSTRUCTION_FILES,
  agentInstructionRelativePath
} from '@shared/agentInstructionFiles'
import type { AgentInstructionsPanelState } from '../types'

/** テスト用の指示ファイルの節の状態。既定は claude の 3 行がすべて無い・作成中でない・文言なし・サブフォルダは 0 件・全体の指示ファイルは無い */
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
  subfolderRows: [],
  subfolderTotal: 0,
  subfolderNote: null,
  openSubfolderFile: vi.fn<AgentInstructionsPanelState['openSubfolderFile']>(),
  isRefreshing: false,
  refresh: vi.fn<AgentInstructionsPanelState['refresh']>().mockResolvedValue(undefined),
  globalRow: {
    kind: 'missing',
    displayPath: '~/.claude/CLAUDE.md',
    description: '個人の指示(全部のプロジェクトに効きます)'
  },
  openGlobal: vi.fn<AgentInstructionsPanelState['openGlobal']>(),
  createGlobal: vi.fn<AgentInstructionsPanelState['createGlobal']>().mockResolvedValue(undefined),
  ...overrides
})
