// エージェントの変更の確認(記録・一覧・diff・戻す)の IPC の型と、一覧の行数の上限。main・preload・renderer が共有する

/** 一覧の行数の上限。超えた分は打ち切り、「すべて戻す」を使えなくする */
export const AGENT_CHANGES_LIST_LIMIT = 500

/**
 * 記録できない理由。not-repository: Git 管理外、not-toplevel: リポジトリのサブフォルダ、
 * too-many-untracked: 未追跡のファイルが多すぎる・大きすぎる、timeout: 記録の打ち切り、git-failed: git を実行できない
 */
export const AGENT_CHANGES_UNAVAILABLE_REASONS = [
  'not-repository',
  'not-toplevel',
  'too-many-untracked',
  'timeout',
  'git-failed'
] as const
export type AgentChangesUnavailableReason = (typeof AGENT_CHANGES_UNAVAILABLE_REASONS)[number]

/** 実行の区切りを保つ数(新しい方から)。超えたら一番古い実行を捨てる(累積の始点は残す) */
export const AGENT_CHANGES_MAX_RUNS = 10

/** 記録の開始の依頼の種類。send: プロンプトの「実行」の直前(記録があれば区切りを足す)、manual: 「いまから記録する」(実行に数えない) */
export type AgentChangesBeginTrigger = 'send' | 'manual'

/**
 * 実行を選べるか(main が決め、renderer は表示だけに使う)。start-not-recorded: その実行の開始の区切りを取れなかった、
 * end-not-recorded: 終わり(次の実行の開始)の区切りを取れなかった。終わりの無い実行を「今まで」に読み替えない(L-002)
 */
export type AgentChangesRunAvailability =
  | { kind: 'available' }
  | { kind: 'start-not-recorded'; reason: AgentChangesUnavailableReason }
  | { kind: 'end-not-recorded' }

/** 実行 1 つ(プロンプトを送るたびに足す)。範囲は「開始 → 次の実行の開始(最後の実行は今まで)」 */
export interface AgentChangesRun {
  /** 所有者ごとに単調に増える ID(記録をまたいで重ならない。範囲の指定に使う) */
  runId: number
  /** 記録の中の 1 からの番号(表示用) */
  number: number
  /** 開始の時刻(エポックミリ秒) */
  startedAt: number
  /** 次の実行の開始の時刻。最後の実行は null */
  endedAt: number | null
  availability: AgentChangesRunAvailability
}

/** 記録の状態(main の registry が真実の源)。startedAt は記録を始めた時刻(エポックミリ秒) */
export type AgentChangesState =
  | { kind: 'none' }
  | {
      kind: 'unavailable'
      reason: AgentChangesUnavailableReason
      /** too-many-untracked のときの未追跡のファイルの数・合計の大きさ(バイト) */
      untrackedCount?: number
      untrackedBytes?: number
    }
  /** runs は実行の一覧(古い順。最大 AGENT_CHANGES_MAX_RUNS 件) */
  | { kind: 'recording'; startedAt: number; runs: AgentChangesRun[] }

/** A: 追加、M: 変更、D: 削除、T: 種類の変更(ファイル ↔ リンク・サブモジュール) */
export const AGENT_CHANGE_STATUSES = ['A', 'M', 'D', 'T'] as const
export type AgentChangeStatus = (typeof AGENT_CHANGE_STATUSES)[number]

export function isAgentChangeStatus(value: unknown): value is AgentChangeStatus {
  return typeof value === 'string' && (AGENT_CHANGE_STATUSES as readonly string[]).includes(value)
}

/**
 * 一覧の行のパス(追加されたフォルダは '<dir>/')を、IPC・タブで使うリポジトリ相対のパス(末尾の '/' なし)にする。
 * 行の表記と IPC・タブの表記の変換規則をここ 1 か所に置く(main と renderer の両方が使う)
 */
export function toAgentChangeRelativePath(entryPath: string): string {
  return entryPath.replace(/\/+$/, '')
}

export interface AgentChangeEntry {
  /** リポジトリ相対のパス(git の表記)。追加されたフォルダは末尾が '/' */
  path: string
  status: AgentChangeStatus
  /** 記録の後に作られたフォルダ(中身ごと 1 行にまとめたもの) */
  isDirectory: boolean
  /** 記録の時点に記録しなかった(大きすぎて除外した)ファイルを含む。戻せない */
  notRecorded: boolean
}

/** 記録の時点と作業ツリーを比べた一覧(main の agentChangesQuery が作り、renderer が写しに持つ) */
export interface AgentChangesList {
  /** 先頭 AGENT_CHANGES_LIST_LIMIT 件(パスの順) */
  entries: AgentChangeEntry[]
  /** 打ち切る前の件数 */
  totalCount: number
  truncated: boolean
  /** 記録の時点から HEAD が変わったか */
  headChanged: boolean
}

/** 一覧・diff の範囲。all: 累積(始点から)、run: 実行 1 つ(runId は AgentChangesRun.runId) */
export type AgentChangesScope = { kind: 'all' } | { kind: 'run'; runId: number }

/** 範囲の一覧を出せない理由(写しが古い)。run-missing: 実行が一覧に無い、start-not-recorded・end-not-recorded: 区切りを取れなかった */
export type AgentChangesScopeUnavailableReason =
  | 'run-missing'
  | 'start-not-recorded'
  | 'end-not-recorded'

/** 2 つの範囲が同じか(renderer が結果の範囲と今の範囲を照合する。L-037・L-040) */
export function isSameAgentChangesScope(a: AgentChangesScope, b: AgentChangesScope): boolean {
  return a.kind === 'all' ? b.kind === 'all' : b.kind === 'run' && a.runId === b.runId
}

/** 一覧の結果。recording・scope-unavailable は、実行の一覧と、一覧を取った範囲を添える */
export type AgentChangesListResult =
  | { kind: 'none' }
  | ({
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      scope: AgentChangesScope
    } & AgentChangesList)
  | {
      kind: 'scope-unavailable'
      startedAt: number
      runs: AgentChangesRun[]
      scope: AgentChangesScope
      reason: AgentChangesScopeUnavailableReason
    }

/** 「すべて戻す」の確認のときに見せた一覧の 1 件。main は実行時の一覧と完全一致で照合する */
export interface AgentRevertAllEntry {
  path: string
  status: AgentChangeStatus
}
