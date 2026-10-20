import type { AgentLaunchRequest } from '@shared/types'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'

// CLI の種類ごとの起動の表(設計書 2026-10-20「起動の表」)。コマンドの名前・引数・追加で取り除く環境変数は main だけが決め、
// renderer からは受け取らない(L-019)。引数に入れるのは、main が検証した会話の ID と main が作った設定のファイルの絶対パスだけ(L-034)。
// 能力の表(sessionResume・changeAttribution)に合わない値が渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)

export interface AgentCliLaunchSpec {
  /** 探すコマンドの名前(AGENT_CLI_PROFILES[kind].commandName) */
  commandName: string
  /** すべての CLI で取り除く一覧に足して取り除く環境変数(完全一致) */
  extraRemovedEnvKeys: readonly string[]
  /**
   * 起動の引数。claudeSessionId と hookSettingsPath は、能力の表で sessionResume・changeAttribution が true の種類だけが受け取り、
   * false の種類に値が渡ったら投げる(呼び出し側の取り違えを黙って捨てない。L-044)
   */
  buildArgs(
    launch: AgentLaunchRequest,
    claudeSessionId: string | null,
    hookSettingsPath: string | null
  ): string[]
}

/** 起動の指定の種類を足したときに既定の引数へ流さないよう、未知の kind は投げる(L-044) */
function throwUnknownLaunch(launch: never): never {
  throw new Error(`未知の起動の指定です: ${JSON.stringify(launch)}`)
}

/**
 * claude の起動の引数(MVP からの起動の引数と同じ中身。hooks の設計書「起動の引数」)。新しく起動するときは main が振った
 * ID を --session-id で、再開は記録と照合した ID を --resume で渡す。hookSettingsPath があれば後ろに --settings を足す
 */
function buildClaudeArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string | null,
  hookSettingsPath: string | null
): string[] {
  if (claudeSessionId === null) throw new Error('claude の起動には会話の ID が要ります')
  const settings = hookSettingsPath === null ? [] : ['--settings', hookSettingsPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', claudeSessionId, ...settings]
    case 'resume':
      return ['--resume', claudeSessionId, ...settings]
    default:
      return throwUnknownLaunch(launch)
  }
}

/**
 * copilot の起動の引数。引数なしで対話のセッションになる。作業ディレクトリは pty の cwd で決め、-C・--session-id・--resume・
 * --allow-*・--yolo などは付けない(設計書「copilot の引数」)。再開は starter が resume-unsupported で先に断る
 */
function buildCopilotArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string | null,
  hookSettingsPath: string | null
): string[] {
  if (claudeSessionId !== null) throw new Error('copilot の起動に会話の ID は渡せません')
  if (hookSettingsPath !== null)
    throw new Error('copilot の起動に hooks の設定のファイルは渡せません')
  switch (launch.kind) {
    case 'new':
      return []
    case 'resume':
      throw new Error('copilot はセッションの再開に対応していません')
    default:
      return throwUnknownLaunch(launch)
  }
}

export const AGENT_CLI_LAUNCH_SPECS: Record<AgentCliKind, AgentCliLaunchSpec> = {
  claude: {
    commandName: AGENT_CLI_PROFILES.claude.commandName,
    extraRemovedEnvKeys: [],
    buildArgs: buildClaudeArgs
  },
  copilot: {
    commandName: AGENT_CLI_PROFILES.copilot.commandName,
    // アプリが起動した CLI の許可を自動で全部にしない(claude に --dangerously-skip-permissions を付けないのと同じ方針)
    extraRemovedEnvKeys: ['COPILOT_ALLOW_ALL'],
    buildArgs: buildCopilotArgs
  }
}
