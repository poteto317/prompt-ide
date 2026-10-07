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
  | { kind: 'recording'; startedAt: number }

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

export type AgentChangesListResult =
  | { kind: 'none' }
  | ({ kind: 'recording'; startedAt: number } & AgentChangesList)

/** 「すべて戻す」の確認のときに見せた一覧の 1 件。main は実行時の一覧と完全一致で照合する */
export interface AgentRevertAllEntry {
  path: string
  status: AgentChangeStatus
}
