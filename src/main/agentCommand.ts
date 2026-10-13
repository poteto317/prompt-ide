import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import {
  delimiter as posixDelimiter,
  isAbsolute as posixIsAbsolute,
  join as posixJoin
} from 'node:path/posix'
import {
  delimiter as win32Delimiter,
  isAbsolute as win32IsAbsolute,
  join as win32Join
} from 'node:path/win32'
import type { AgentLaunchRequest } from '@shared/types'
import { appendSearchPaths, getCliSearchPaths } from './cliSearchPaths'

// エージェントの起動のコマンドと環境変数を main で決める(設計書「セキュリティ」「PATH の継承」)。renderer からは受け取らない

/** 起動するコマンドの名前。引数は main が決めたセッションの指定(--session-id / --resume と UUID)と、hooks の設定のファイル(--settings と main が作った絶対パス)だけ。--dangerously-skip-permissions などは付けない */
export const AGENT_COMMAND_NAME = 'claude'

/** 取り除く環境変数(完全一致)。親の Claude Code のセッションの通信先と token、VS Code の端末から引き継ぐもの(確認の結果 12) */
export const REMOVED_AGENT_ENV_KEYS: readonly string[] = [
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH'
]
/** 取り除く環境変数(接頭辞)。ELECTRON_RUN_AS_NODE などが子の Electron 製のツールの挙動を変えるため */
export const REMOVED_AGENT_ENV_PREFIXES: readonly string[] = ['ELECTRON_', 'VSCODE_']

/** 実行できる通常のファイルか(テストで差し替える) */
export type ExecutableProbe = (path: string) => Promise<boolean>

export const isExecutableRegularFile: ExecutableProbe = async (path) => {
  try {
    const stats = await stat(path)
    if (!stats.isFile()) return false
    if (process.platform === 'win32') return true
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface FindExecutableOptions {
  platform: NodeJS.Platform
  /** Windows の PATHEXT(例: '.COM;.EXE;.BAT;.CMD')。無ければ '.COM;.EXE;.BAT;.CMD' */
  pathExt?: string
  isExecutable: ExecutableProbe
}

/** PATH の先頭から name の実行可能なファイルを探し、最初に見つかった絶対パスを返す。見つからなければ null */
export async function findExecutableInPath(
  name: string,
  pathValue: string,
  { platform, pathExt, isExecutable }: FindExecutableOptions
): Promise<string | null> {
  const isWindows = platform === 'win32'
  const delimiter = isWindows ? win32Delimiter : posixDelimiter
  const join = isWindows ? win32Join : posixJoin
  const isAbsolute = isWindows ? win32IsAbsolute : posixIsAbsolute
  // pathExt が空文字でも既定に倒す(空だと拡張子が無くなり何も見つからない)
  const extensions = isWindows
    ? (pathExt || '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext !== '')
    : ['']
  for (const dir of pathValue.split(delimiter)) {
    // 空の要素(先頭・末尾・連続の区切り)は作業ディレクトリを意味するため探さない(作業ディレクトリのファイルを起動しない)
    if (dir === '') continue
    // 相対ディレクトリ(. や node_modules/.bin)も探さない。探索は main の cwd 基準だが pty は別の cwd で解決しうるため、file は常に絶対パスにする
    if (!isAbsolute(dir)) continue
    for (const ext of extensions) {
      const candidate = join(dir, name + ext)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return null
}

/** hooks の受け口(127.0.0.1)への要求をプロキシへ送らないための除外(トークンをプロキシへ渡さない) */
export const AGENT_NO_PROXY_HOSTS: readonly string[] = ['127.0.0.1', 'localhost']

/**
 * NO_PROXY・no_proxy の既存の値(カンマ区切り)の和集合に 127.0.0.1・localhost を足す。macOS・Linux は同じ値を両方に設定する
 * (片方だけのツールでも既存の除外が効くように)。Windows は名前の大文字小文字を区別しないため NO_PROXY 1 つにまとめる
 */
function addLoopbackNoProxy(env: Record<string, string>, platform: NodeJS.Platform): void {
  const isWindows = platform === 'win32'
  const keys = isWindows
    ? Object.keys(env).filter((key) => key.toUpperCase() === 'NO_PROXY')
    : ['NO_PROXY', 'no_proxy'].filter((key) => key in env)
  const hosts: string[] = []
  for (const key of keys) {
    for (const item of env[key].split(',')) {
      const host = item.trim()
      if (host !== '' && !hosts.includes(host)) hosts.push(host)
    }
  }
  for (const host of AGENT_NO_PROXY_HOSTS) if (!hosts.includes(host)) hosts.push(host)
  const value = hosts.join(',')
  if (isWindows) {
    for (const key of keys) delete env[key]
    env.NO_PROXY = value
    return
  }
  env.NO_PROXY = value
  env.no_proxy = value
}

/**
 * pty へ渡す環境変数(設計書「環境変数」)。base を写し、取り除く変数を除き、PATH・TERM・COLORTERM・LANG を設定し、
 * NO_PROXY・no_proxy にループバックを足す
 */
export function buildAgentEnv(
  base: NodeJS.ProcessEnv,
  pathValue: string,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  // Windows の環境変数名は大文字小文字を区別しない(Path と PATH を重複させない)。POSIX は区別する
  const normalize = platform === 'win32' ? (key: string) => key.toUpperCase() : (key: string) => key
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    const name = normalize(key)
    if (name === 'PATH') continue
    if (REMOVED_AGENT_ENV_KEYS.includes(name)) continue
    if (REMOVED_AGENT_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
    env[key] = value
  }
  env.PATH = pathValue
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  // GUI から起動すると LANG が無い(確認の結果 3)。利用者が LC_* を設定していれば上書きしない
  if (env.LANG === undefined && env.LC_ALL === undefined && env.LC_CTYPE === undefined) {
    env.LANG = 'en_US.UTF-8'
  }
  addLoopbackNoProxy(env, platform)
  return env
}

function getEnvIgnoreCase(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

export interface AgentLaunchPlan {
  /** 起動する claude の絶対パス */
  file: string
  /** 引数(空。セッションの指定と --settings は starter が buildAgentLaunchArgs で後ろに足す) */
  args: string[]
  env: Record<string, string>
}

export type AgentLaunchResolution =
  | { kind: 'ok'; plan: AgentLaunchPlan }
  | { kind: 'not-found'; shellPathUnavailable: boolean }

export interface ResolveAgentLaunchDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  readLoginShellPath: () => Promise<string | null>
  isExecutable: ExecutableProbe
}

/**
 * claude の起動の引数(設計書「起動の流れ」3、hooks の設計書「起動の引数」)。新しく起動するときは main が振った ID を --session-id で、
 * 再開は記録と照合した ID を --resume で渡す。hookSettingsPath(main が作った設定のファイルの絶対パス。L-034)があれば後ろに
 * --settings を足す。null(受け口を用意できない・claude の版が対応していると分からない)なら 2 つだけ。省略できる引数にしない(L-060)。
 * claudeSessionId は検証を通った値をそのまま使い、別の場所で読み直さない(L-018)。起動の種類を足したときに既定の --session-id へ
 * 流さないよう、kind ごとに分けて未知の kind は投げる(L-044)
 */
export function buildAgentLaunchArgs(
  launch: AgentLaunchRequest,
  claudeSessionId: string,
  hookSettingsPath: string | null
): string[] {
  const settings = hookSettingsPath === null ? [] : ['--settings', hookSettingsPath]
  switch (launch.kind) {
    case 'new':
      return ['--session-id', claudeSessionId, ...settings]
    case 'resume':
      return ['--resume', claudeSessionId, ...settings]
    default: {
      const unknownLaunch: never = launch
      throw new Error(`未知の起動の指定です: ${JSON.stringify(unknownLaunch)}`)
    }
  }
}

/**
 * 起動のコマンドと環境変数を決める。macOS・Linux はログインシェルの PATH(取得できなければ main の PATH)の後ろに
 * 既定の探索先を足した PATH で claude を探す。Windows は main の PATH と PATHEXT で探す
 */
export async function resolveAgentLaunch({
  env,
  platform,
  readLoginShellPath,
  isExecutable
}: ResolveAgentLaunchDeps): Promise<AgentLaunchResolution> {
  let pathValue: string
  let shellPathUnavailable = false
  if (platform === 'win32') {
    pathValue = getEnvIgnoreCase(env, 'PATH') ?? ''
  } else {
    const loginPath = await readLoginShellPath()
    shellPathUnavailable = loginPath === null
    pathValue = appendSearchPaths(loginPath ?? env.PATH, getCliSearchPaths(env.HOME))
  }
  const file = await findExecutableInPath(AGENT_COMMAND_NAME, pathValue, {
    platform,
    pathExt: platform === 'win32' ? getEnvIgnoreCase(env, 'PATHEXT') : undefined,
    isExecutable
  })
  if (file === null) return { kind: 'not-found', shellPathUnavailable }
  return { kind: 'ok', plan: { file, args: [], env: buildAgentEnv(env, pathValue, platform) } }
}
