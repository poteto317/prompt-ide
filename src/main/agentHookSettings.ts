import { randomBytes } from 'node:crypto'
import { rmSync as fsRmSync } from 'node:fs'
import { lstat, mkdtemp as fsMkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_HOOK_EVENT_NAMES,
  AGENT_HOOK_TOOL_EVENTS,
  AGENT_HOOK_TOOL_MATCHER,
  agentHookPathOf,
  agentHookTimeoutSecondsOf
} from './agentHookProtocol'
import type { AgentHookEventName } from './agentHookProtocol'

// claude に --settings で渡す設定のファイル(設計書「設定のファイル」「トークンの渡し方」)。トークンは起動の引数に置かず
// (ps で見える)、0700 のディレクトリの 0600 のファイルにだけ書く。ファイルの名前はトークンと無関係な乱数

export interface AgentHookHttpHook {
  type: 'http'
  url: string
  headers: { Authorization: string }
  timeout: number
}

export interface AgentHookMatcherGroup {
  matcher?: string
  hooks: AgentHookHttpHook[]
}

export interface AgentHookSettingsJson {
  hooks: Record<AgentHookEventName, AgentHookMatcherGroup[]>
}

/** 設定の JSON(純粋な関数)。onFailure・async・if は付けない(既定の「失敗しても止めない」のまま。確認の結果 6) */
export function buildAgentHookSettings({
  baseUrl,
  token
}: {
  baseUrl: string
  token: string
}): AgentHookSettingsJson {
  const entries = AGENT_HOOK_EVENT_NAMES.map(
    (event): [AgentHookEventName, AgentHookMatcherGroup[]] => {
      const hook: AgentHookHttpHook = {
        type: 'http',
        url: baseUrl + agentHookPathOf(event),
        headers: { Authorization: `Bearer ${token}` },
        timeout: agentHookTimeoutSecondsOf(event)
      }
      const group: AgentHookMatcherGroup = AGENT_HOOK_TOOL_EVENTS.includes(event)
        ? { matcher: AGENT_HOOK_TOOL_MATCHER, hooks: [hook] }
        : { hooks: [hook] }
      return [event, [group]]
    }
  )
  return {
    hooks: Object.fromEntries(entries) as Record<AgentHookEventName, AgentHookMatcherGroup[]>
  }
}

export const AGENT_HOOK_SETTINGS_DIR_PREFIX = 'prompt-ide-agent-hooks-'

const createSettingsFileName = (): string => randomBytes(16).toString('hex')

/**
 * dir に <乱数 32 桁の 16 進>.json を wx・0600 で書き、絶対パスを返す。JSON は書き込みの前に作る(文字列の連結で作らない)。
 * 書き込みの途中で失敗したら自分が作ったファイルだけを消す(EEXIST は他者のファイルなので消さない。L-004)
 */
export async function writeAgentHookSettingsFile(
  dir: string,
  settings: AgentHookSettingsJson,
  createName: () => string = createSettingsFileName
): Promise<string> {
  const text = JSON.stringify(settings)
  const path = join(dir, `${createName()}.json`)
  try {
    await writeFile(path, text, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      await rm(path, { force: true }).catch(() => undefined)
    }
    throw err
  }
  return path
}

/** 設定のファイルを消す。失敗は握ってパスだけをログに出す(ディレクトリごと will-quit で消す) */
export async function removeAgentHookSettingsFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true })
  } catch {
    console.warn('[agent-hooks] 設定のファイルを消せませんでした:', path)
  }
}

export interface AgentHookSettingsDir {
  /**
   * 最初の呼び出しで mkdtemp(0700)し、その Promise を共有する。失敗したら捨てて、次の呼び出しで作り直す。
   * 作ったディレクトリが外から消されていたら(OS の一時ディレクトリの掃除など)、作り直して新しいパスを返す。
   * 同じパスに他人の持ち物・グループや他人も書けるディレクトリ・シンボリックリンクがあっても、そこは使わずに作り直す
   * (共有の /tmp で、消えた後に同じ名前を作られると、設定のファイルを差し替えられる)。
   * removeSync の後は作らず reject する(will-quit の後に作り直したディレクトリが残らない)。mkdtemp の最中に removeSync が
   * 来たときも、できたディレクトリをその場で消して reject する
   */
  ensure(): Promise<string>
  /**
   * 以後の ensure を reject にし、作れていればディレクトリごと同期で消す(失敗は握ってパスだけをログ)。
   * 作れていなければ何も消さない(作成中のものは、できた時点で ensure が消す)
   */
  removeSync(): void
}

export interface AgentHookSettingsDirStat {
  isDirectory(): boolean
  isSymbolicLink(): boolean
  uid: number
  mode: number
}

export interface AgentHookSettingsDirOwner {
  platform: NodeJS.Platform
  /** process.getuid() の値。Windows では null */
  uid: number | null
}

/** 今のプロセスの持ち主(isOwnPrivateDirStat に渡す。copilot のプラグインのフォルダの確かめにも使う) */
export const currentAgentHookDirOwner = (): AgentHookSettingsDirOwner => ({
  platform: process.platform,
  uid: typeof process.getuid === 'function' ? process.getuid() : null
})

/**
 * lstat の結果が、そのまま設定のファイルを置いてよいディレクトリかを返す。シンボリックリンクでないディレクトリで、
 * Windows 以外では自分の持ち物かつグループ・他人の権限が無い(mode & 0o077 が 0)ものだけを使う
 */
export function isOwnPrivateDirStat(
  stat: AgentHookSettingsDirStat,
  owner: AgentHookSettingsDirOwner
): boolean {
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  if (owner.platform === 'win32') return true
  return stat.uid === owner.uid && (stat.mode & 0o077) === 0
}

export interface AgentHookSettingsDirDeps {
  mkdtemp: (prefix: string) => Promise<string>
  isPrivateDir: (path: string) => Promise<boolean>
  rmSync: (path: string, options: { recursive: true; force: true }) => void
  tmpdir: () => string
}

export function createAgentHookSettingsDir({
  mkdtemp = (prefix) => fsMkdtemp(prefix),
  isPrivateDir = (path) =>
    lstat(path).then(
      (stat) => isOwnPrivateDirStat(stat, currentAgentHookDirOwner()),
      () => false
    ),
  rmSync = fsRmSync,
  tmpdir = osTmpdir
}: Partial<AgentHookSettingsDirDeps> = {}): AgentHookSettingsDir {
  let pending: Promise<string> | null = null
  let created: string | null = null
  let closed = false
  const tryRemove = (path: string): void => {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      console.warn('[agent-hooks] 設定のディレクトリを消せませんでした:', path)
    }
  }
  const closedError = (): Error => new Error('設定のディレクトリは終了処理で閉じられています')
  const create = (): Promise<string> => {
    const attempt = mkdtemp(join(tmpdir(), AGENT_HOOK_SETTINGS_DIR_PREFIX)).then((dir) => {
      if (closed) {
        // 作っている最中に removeSync が来た。誰にも使われないので、できたディレクトリをここで消す
        tryRemove(dir)
        throw closedError()
      }
      created = dir
      return dir
    })
    pending = attempt
    attempt.catch(() => {
      if (pending === attempt) pending = null
    })
    return attempt
  }
  return {
    ensure() {
      if (closed) return Promise.reject(closedError())
      if (pending === null) return create()
      const current = pending
      return current.then(async (dir) => {
        const usable = await isPrivateDir(dir)
        if (closed) throw closedError()
        if (usable) return dir
        // 同時の呼び出しで作り直しは 1 回だけ。先に気づいた呼び出しが pending を差し替える
        if (pending === current) return create()
        return pending ?? create()
      })
    },
    removeSync() {
      closed = true
      if (created === null) return
      tryRemove(created)
    }
  }
}
