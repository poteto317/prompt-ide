// 全体の指示ファイルの境界(設計書 2026-11-07 global「境界」)。パスは main が作った文字列と完全一致のときだけ全体の指示ファイルとし、
// 正規化しない(検証の値と実行の値をずらさない。L-018)。realpath した先がホームの realpath の中かを確かめる(L-016)
import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import type {
  GlobalAgentInstructionLocations,
  ResolvedGlobalAgentInstructionLocation
} from './globalAgentInstructionLocations'

/** 全体の指示ファイルの入口での拒否(ホームの外を指すリンク)。文言にパスを入れない(L-017) */
export class GlobalAgentInstructionAccessDeniedError extends Error {
  constructor() {
    super('Access denied: 全体の指示ファイル')
  }
}

export function matchGlobalAgentInstructionPath(
  locations: GlobalAgentInstructionLocations,
  filePath: unknown
): ResolvedGlobalAgentInstructionLocation | null {
  if (typeof filePath !== 'string') return null
  for (const location of AGENT_CLI_KINDS.map((kind) => locations[kind])) {
    if (location.kind === 'resolved' && location.filePath === filePath) return location
  }
  return null
}

/** realpath した先がホームの realpath と等しいか、その中か。違えば GlobalAgentInstructionAccessDeniedError。realpath の失敗はそのまま投げる */
export async function assertResolvedWithinHome(homeDir: string, path: string): Promise<string> {
  const resolved = await realpath(path)
  const resolvedHome = await realpath(homeDir)
  const prefix = resolvedHome.endsWith(sep) ? resolvedHome : resolvedHome + sep
  if (resolved !== resolvedHome && !resolved.startsWith(prefix)) {
    throw new GlobalAgentInstructionAccessDeniedError()
  }
  return resolved
}
