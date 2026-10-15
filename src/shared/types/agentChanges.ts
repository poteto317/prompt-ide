// エージェントの変更の確認(記録・一覧・diff・戻す・戻した操作の取り消し)の IPC の型と、一覧の行数の上限。main・preload・renderer が共有する
import type { DiscardAllResult } from './git'

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
  /**
   * runs は実行の一覧(古い順。最大 AGENT_CHANGES_MAX_RUNS 件)。undo は直前の戻す操作の取り消しの控えの要約(無ければ null)。
   * attribution は記録の区別の要約
   */
  | {
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      undo: AgentChangesUndoSummary | null
      attribution: AgentChangesAttributionSummary
    }

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
  /**
   * 行の区別(累積の一覧で main の registry が付ける。設計書「行の author」)。null は区別していない(実行の範囲の一覧・区別を始める前の記録・
   * hooks の無い記録・notRecorded の行)。main の一覧の関数はすべての行を null で作る
   */
  author: AgentChangeAuthor | null
}

/** 一覧の行の区別。user: 利用者の変更、mixed: 利用者の変更を含む(両方が変えた)、agent: エージェントの変更 */
export type AgentChangeAuthor = 'agent' | 'user' | 'mixed'

/**
 * すべて戻すの対象か(利用者の変更・利用者の変更を含む行は戻さない)。確認の一覧(renderer の agentRevertAllTargets。
 * useAgentChangesRevert がその結果を使う)と実行時の照合(main の revertAllAgentChanges)が同じ定義を使う(L-036)
 */
export function isAgentRevertAllTarget(entry: Pick<AgentChangeEntry, 'author'>): boolean {
  return entry.author !== 'user' && entry.author !== 'mixed'
}

/**
 * 記録の区別をやめた理由。main の追跡の理由(agentToolActivity の AgentHooksLostReason)に、判定の区切り・差分・今の区間の
 * 比較の失敗(checkpoint-failed)を足したもの。用途ごとに型を分け、string で受けない(L-439)
 */
export type AgentChangesAttributionLostReason =
  | 'hooks-not-confirmed'
  | 'receiver-unavailable'
  | 'claude-version-unsupported'
  | 'checkpoint-failed'

/** 記録の区別の要約(AgentChangesState・AgentChangesListResult に載せる)。since は区別を始めた時刻、hadMarks は集合が空でないか */
export type AgentChangesAttributionSummary =
  | { kind: 'tracking'; since: number | null; hadUnassignedSince: boolean }
  | {
      kind: 'lost'
      reason: AgentChangesAttributionLostReason
      lostAt: number
      hadMarks: boolean
      since: number | null
      hadUnassignedSince: boolean
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

/** 一覧の結果。recording・scope-unavailable は、実行の一覧・取り消しの控えの要約(無ければ null)・記録の区別の要約と、一覧を取った範囲を添える */
export type AgentChangesListResult =
  | { kind: 'none' }
  | ({
      kind: 'recording'
      startedAt: number
      runs: AgentChangesRun[]
      undo: AgentChangesUndoSummary | null
      attribution: AgentChangesAttributionSummary
      scope: AgentChangesScope
    } & AgentChangesList)
  | {
      kind: 'scope-unavailable'
      startedAt: number
      runs: AgentChangesRun[]
      undo: AgentChangesUndoSummary | null
      attribution: AgentChangesAttributionSummary
      scope: AgentChangesScope
      reason: AgentChangesScopeUnavailableReason
    }

/** 「すべて戻す」の確認のときに見せた一覧の 1 件。main は実行時の一覧と完全一致で照合する */
export interface AgentRevertAllEntry {
  path: string
  status: AgentChangeStatus
}

/** 取り消しの動作。rewrite: 戻す前の内容へ書き戻す、recreate: ゴミ箱へ移したファイルを作り直す、trash: 戻すときに作り直したファイルをゴミ箱へ移す */
export type AgentChangesUndoAction = 'rewrite' | 'recreate' | 'trash'

/** 戻した操作の種類(帯の文言に使う) */
export type AgentChangesUndoOperation = 'file' | 'hunk' | 'all'

/** 取り消しの控えの要約(パスの昇順。renderer は帯・確認に使う。控えの一時ディレクトリは渡さない) */
export interface AgentChangesUndoSummary {
  undoId: number
  operation: AgentChangesUndoOperation
  entries: { path: string; action: AgentChangesUndoAction }[]
}

/**
 * 取り消しの控えを取れなかった理由。directory: 追加されたフォルダを含む、unsupported-type: ファイル・リンク以外のものを含む、
 * too-large: 内容が大きすぎる、capture-failed: 戻した後の状態を控えられなかった
 */
export type AgentRevertUndoUnavailableReason =
  | 'directory'
  | 'unsupported-type'
  | 'too-large'
  | 'capture-failed'

/**
 * 戻す操作の結果に入れる控えの成否。discarded: 控えの成否によらず、戻す操作の途中で記録が捨てられた・置き換わった、または
 * アプリが終了中のため、控えを記録に付けずに消した(取り消せるとも、取り消せない理由も伝えない)
 */
export type AgentRevertUndoOutcome =
  | { kind: 'saved' }
  | { kind: 'unavailable'; reason: AgentRevertUndoUnavailableReason }
  | { kind: 'discarded' }

/** 1 ファイル・ハンクを戻した結果。undoSummary は戻した後の記録の控えの要約(無ければ null) */
export interface AgentRevertResult {
  undo: AgentRevertUndoOutcome
  undoSummary: AgentChangesUndoSummary | null
}

/** 「すべて戻す」の結果。revertedCount は戻せた件数(partial でも控えの有無によらず数える) */
export type AgentRevertAllResult = DiscardAllResult & AgentRevertResult & { revertedCount: number }

/**
 * 戻した操作の取り消しの結果。restoredPaths: 書き戻した・作り直したパス、trashedPaths: ゴミ箱へ移したパス(どちらもリポジトリ相対。
 * 末尾の / なし)。undoSummary は取り消しの後の記録の控えの要約
 */
export type AgentChangesUndoResult =
  | {
      status: 'done'
      restoredPaths: string[]
      trashedPaths: string[]
      undoSummary: AgentChangesUndoSummary | null
    }
  | {
      status: 'partial'
      message: string
      restoredPaths: string[]
      trashedPaths: string[]
      undoSummary: AgentChangesUndoSummary | null
    }
