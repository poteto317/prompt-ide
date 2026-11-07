// 全体の指示ファイルの場所(設計書 2026-11-07 global「場所を決める」)。main の起動時の process.env で 1 回だけ決める。
// このアプリから起動する CLI は同じ process.env を受け取る(agentCommand.ts の buildAgentEnv)ので、節に出す場所と CLI が読む場所が一致する
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { AgentGlobalInstructionFile } from '@shared/agentInstructionFiles'
import type { GlobalAgentInstructionUnavailableReason } from '@shared/types'

export interface ResolvedGlobalAgentInstructionLocation {
  kind: 'resolved'
  file: AgentGlobalInstructionFile
  /** 設定のフォルダ(正規化した絶対パス。realpath はしない) */
  dirPath: string
  /** 全体の指示ファイルの絶対パス。renderer に渡し、境界で文字列として比べる */
  filePath: string
  /** 画面に出す `~/…` の形(区切りは /) */
  displayPath: string
}

export type GlobalAgentInstructionLocation =
  | ResolvedGlobalAgentInstructionLocation
  | {
      kind: 'unavailable'
      file: AgentGlobalInstructionFile
      reason: GlobalAgentInstructionUnavailableReason
    }

export type GlobalAgentInstructionLocations = Record<AgentCliKind, GlobalAgentInstructionLocation>

/** 受け口の登録に渡す文脈(場所と、ホームの検査に使うホーム) */
export interface GlobalAgentInstructionContext {
  locations: GlobalAgentInstructionLocations
  homeDir: string
}

/** 字面でホームの中か(ホームそのものを含む)。rel が '..'・'../' で始まる・絶対パス(Windows の別のドライブ)なら外 */
export function isLexicallyInsideHome(homeDir: string, path: string): boolean {
  const rel = relative(homeDir, path)
  return !(rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
}

/**
 * 設定のフォルダがホームそのものなら、ホームの文字列に揃える。Windows の relative は大文字小文字を区別しないが resolve は変えないので、
 * `c:\users\x` と `C:\Users\x` は字面の判定ではホームそのもの・文字列の比較では別になる。作成・問い合わせはホームそのものかを
 * 文字列で比べる(globalAgentInstructionFileCreator・globalAgentInstructionStatus)ので、ここで 1 つに寄せて食い違わないようにする。
 * relative は差し替えられる(テストで path.win32.relative を渡す)
 */
export function alignDirWithHome(
  homeDir: string,
  dirPath: string,
  relativePath: (from: string, to: string) => string = relative
): string {
  return relativePath(homeDir, dirPath) === '' ? homeDir : dirPath
}

function resolveLocation(
  file: AgentGlobalInstructionFile,
  env: NodeJS.ProcessEnv,
  homeDir: string
): GlobalAgentInstructionLocation {
  const value = env[file.envName]
  let dirPath: string
  if (value === undefined || (value === '' && file.emptyEnvMeansDefault)) {
    dirPath = join(homeDir, file.defaultDirName)
  } else if (value === '' || !isAbsolute(value)) {
    // 既定に読み替えない(CLI がどこを読むか決められない。L-044)
    return { kind: 'unavailable', file, reason: 'envNotAbsolute' }
  } else {
    dirPath = resolve(value)
  }
  if (!isLexicallyInsideHome(homeDir, dirPath)) {
    return { kind: 'unavailable', file, reason: 'envOutsideHome' }
  }
  dirPath = alignDirWithHome(homeDir, dirPath)
  const filePath = join(dirPath, file.fileName)
  const displayPath = `~/${relative(homeDir, filePath).split(sep).join('/')}`
  return { kind: 'resolved', file, dirPath, filePath, displayPath }
}

export function resolveGlobalAgentInstructionLocations({
  env,
  homeDir
}: {
  env: NodeJS.ProcessEnv
  homeDir: string
}): GlobalAgentInstructionLocations {
  // CLI の種類ごとに書き下す(Object.fromEntries とキャストで型を偽らない。開発者ガイド 4)
  return {
    claude: resolveLocation(AGENT_GLOBAL_INSTRUCTION_FILES.claude, env, homeDir),
    copilot: resolveLocation(AGENT_GLOBAL_INSTRUCTION_FILES.copilot, env, homeDir)
  }
}

export function resolveGlobalAgentInstructionContext(args: {
  env: NodeJS.ProcessEnv
  homeDir: string
}): GlobalAgentInstructionContext {
  return { locations: resolveGlobalAgentInstructionLocations(args), homeDir: args.homeDir }
}
