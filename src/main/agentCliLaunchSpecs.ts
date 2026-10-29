import { isAbsolute } from 'node:path'
import type { AgentLaunchRequest } from '@shared/types'
import { isCliSessionId } from '@shared/types'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'

// CLI の種類ごとの起動の表(設計書 2026-10-20「起動の表」、2026-10-23「起動の引数と環境変数」)。コマンドの名前・引数・追加で取り除く・
// 足す環境変数は main だけが決め、renderer からは受け取らない(L-019)。引数に入れるのは、main が振った・記録と照合した会話の ID と、
// main が作った hooks の設定のファイル(claude)・プラグインのフォルダ(copilot)の絶対パスだけ(L-034)。能力の表(sessionResume)に
// 合わない値が渡ったら投げる
// (呼び出し側の取り違えを黙って捨てない。L-044)

export interface AgentCliLaunchSpec {
  /** 探すコマンドの名前(AGENT_CLI_PROFILES[kind].commandName) */
  commandName: string
  /** すべての CLI で取り除く一覧に足して取り除く環境変数(完全一致) */
  extraRemovedEnvKeys: readonly string[]
  /** 取り除く一覧を適用した後に足す環境変数(利用者の環境の同じ名前を上書きする。Windows は大文字小文字だけ違う名前を取り除いてから足す)。
   *  名前は大文字で書く */
  extraEnv: Readonly<Record<string, string>>
  /**
   * 起動の引数。cliSessionId は能力の表で sessionResume が true の種類だけが受け取り、false の種類に値が渡ったら投げる
   * (呼び出し側の取り違えを黙って捨てない。L-044)。hookConfigPath は claude では設定のファイル(--settings)、copilot では
   * プラグインのフォルダ(--plugin-dir)。hooks なしなら null
   */
  buildArgs(
    launch: AgentLaunchRequest,
    cliSessionId: string | null,
    hookConfigPath: string | null
  ): string[]
}

/** 起動の指定の種類を足したときに既定の引数へ流さないよう、未知の kind は投げる(L-044) */
function throwUnknownLaunch(launch: never): never {
  throw new Error(`未知の起動の指定です: ${JSON.stringify(launch)}`)
}

/**
 * claude の起動の引数(MVP からの起動の引数と同じ中身。hooks の設計書「起動の引数」)。新しく起動するときは main が振った
 * ID を --session-id で、再開は記録と照合した ID を --resume で渡す。hookConfigPath があれば後ろに --settings を足す
 */
function buildClaudeArgs(
  launch: AgentLaunchRequest,
  cliSessionId: string | null,
  hookConfigPath: string | null
): string[] {
  if (cliSessionId === null) throw new Error('claude の起動には会話の ID が要ります')
  const settings = hookConfigPath === null ? [] : ['--settings', hookConfigPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', cliSessionId, ...settings]
    case 'resume':
      return ['--resume', cliSessionId, ...settings]
    default:
      return throwUnknownLaunch(launch)
  }
}

/**
 * copilot の起動の引数(GitHub Copilot CLI 1.0.87 の記録。段階 3a)。新しく起動するときは main が振った ID を --session-id で、
 * 再開は記録と照合した ID を --resume=<ID> の 1 つの引数で渡す(--resume は値を省ける形なので、2 つに分けると ID が値として
 * 読まれない恐れがある)。再開に --session-id は使わない(copilot 側に無い ID は黙って新しい会話になる)。作業ディレクトリは
 * pty の cwd で決め、-C・--allow-*・--yolo などは付けない(保存先への自動の移動は extraEnv で止める)。hookConfigPath があれば
 * 後ろに --plugin-dir を足す(段階 3b)
 */
function buildCopilotArgs(
  launch: AgentLaunchRequest,
  cliSessionId: string | null,
  hookConfigPath: string | null
): string[] {
  if (cliSessionId === null) throw new Error('copilot の起動には会話の ID が要ります')
  // copilot の --resume は大文字小文字を区別せず、前方一致・名前でも照合し、UUID でない値は新しいセッションに落ちるので、
  // 完全な小文字の UUID v4 だけを渡す(入り口の検証に加えた最後の守り。L-007・L-034)。例外の文言は spawn-failed の detail として
  // 画面に出るので、渡された値を入れない(L-017)
  if (!isCliSessionId(cliSessionId)) {
    throw new Error('copilot の起動の会話の ID の形が正しくありません')
  }
  // main が作ったプラグインのフォルダの絶対パスしか来ない想定の最後の守り(L-034)。値を文言に入れない(L-017)
  if (hookConfigPath !== null && !isAbsolute(hookConfigPath)) {
    throw new Error('copilot の起動の hooks のフォルダのパスが正しくありません')
  }
  const pluginDir = hookConfigPath === null ? [] : ['--plugin-dir', hookConfigPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', cliSessionId, ...pluginDir]
    case 'resume':
      return [`--resume=${cliSessionId}`, ...pluginDir]
    default:
      return throwUnknownLaunch(launch)
  }
}

export const AGENT_CLI_LAUNCH_SPECS: Record<AgentCliKind, AgentCliLaunchSpec> = {
  claude: {
    commandName: AGENT_CLI_PROFILES.claude.commandName,
    extraRemovedEnvKeys: [],
    extraEnv: {},
    buildArgs: buildClaudeArgs
  },
  copilot: {
    commandName: AGENT_CLI_PROFILES.copilot.commandName,
    // アプリが起動した CLI の許可を自動で全部にしない(claude に --dangerously-skip-permissions を付けないのと同じ方針)
    extraRemovedEnvKeys: ['COPILOT_ALLOW_ALL'],
    // COPILOT_DISABLE_RESUME_AUTO_CD: 再開したときに copilot の中の作業フォルダが保存先へ移るのを止める(許可のフォルダの外で動き出さない。
    // -C と違い copilot の保存先〈workspace.yaml の cwd〉を書き換えない。設計書 2026-10-23「-C ではなく環境変数にした理由」)。
    // COPILOT_HOOK_ALLOW_LOCALHOST: 127.0.0.1 の受け口への http の hook を読ませる(無いと preToolUse を含む hooks のファイルが丸ごと
    // 捨てられる。設計書 2026-10-26)。どちらも起動の計画を起動の指定・hooks の準備の結果に依存させないため常に足す
    extraEnv: { COPILOT_DISABLE_RESUME_AUTO_CD: '1', COPILOT_HOOK_ALLOW_LOCALHOST: '1' },
    buildArgs: buildCopilotArgs
  }
}
