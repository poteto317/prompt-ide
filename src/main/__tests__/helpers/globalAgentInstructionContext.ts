import { resolveGlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'
import type { GlobalAgentInstructionContext } from '../../globalAgentInstructionLocations'

/** 既存のテスト用。全体の指示ファイルは存在しないホーム(/nonexistent-home)の下にあり、テストのパスとは一致しない */
export const NO_GLOBAL_INSTRUCTIONS: GlobalAgentInstructionContext =
  resolveGlobalAgentInstructionContext({ env: {}, homeDir: '/nonexistent-home' })
