import type {
  AgentChangesUndoAction,
  AgentChangesUndoOperation,
  AgentChangesUndoResult,
  AgentChangesUndoSummary,
  AgentRevertUndoOutcome,
  AgentRevertUndoUnavailableReason
} from '@shared/types'
import { listPathsForMessage } from './discardBatch'

// 戻した操作の取り消しの控えの型・文言と、控え・実行の結果の純粋な変換(設計書「戻した操作の取り消し(main)」)。
// ファイルの読み書き(控えを取る・照合する・書き戻す)は agentChangesUndo に置く。registry・受け口・一覧の要約は
// この型と変換だけを使い、ファイルの操作に依存しない

export const AGENT_UNDO_PREPARE_FAILED_MESSAGE =
  '取り消しの準備に失敗したため、戻すのを中止しました'
export const AGENT_UNDO_STALE_MESSAGE = '取り消せる操作が変わりました。一覧を更新してください'
export const AGENT_UNDO_CHANGED_MESSAGE = '戻した後に変わったファイルがあるため、取り消せません'
export const AGENT_UNDO_SAVED_MISSING_MESSAGE = '取り消しの控えが見つからないため、取り消せません'
/** 控えの準備(戻す前の状態の読み込み・控えの一時ディレクトリへの書き込み)に失敗したときの、戻す操作を中止する文言 */
export function undoPrepareFailedMessage(path: string): string {
  return `${AGENT_UNDO_PREPARE_FAILED_MESSAGE}: ${path}`
}
/** 作り直したファイルをゴミ箱へ移せなかったときの失敗の文言(書き換えの失敗の理由になる) */
export const AGENT_UNDO_TRASH_FAILED_MESSAGE = 'ゴミ箱へ移動できませんでした'

/** 戻す直前の状態。savedName は控えの一時ディレクトリの中の連番のファイル名(パスを名前に使わない)。mode は mode & 0o777 */
export type AgentChangesUndoBefore =
  | { kind: 'absent' }
  | { kind: 'file'; savedName: string; mode: number }
  | { kind: 'symlink'; target: string }

/** 戻した直後の指紋 */
export type AgentChangesUndoAfter =
  | { kind: 'absent' }
  | { kind: 'file'; size: number; sha256: string; mode: number }
  | { kind: 'symlink'; target: string }

export interface AgentChangesUndoItem {
  /** リポジトリ相対(末尾の / なし) */
  path: string
  before: AgentChangesUndoBefore
  after: AgentChangesUndoAfter
}

/** 記録に持つ取り消しの控え(0 か 1 つ) */
export interface AgentChangesUndo {
  undoId: number
  operation: AgentChangesUndoOperation
  dir: string
  /** パスの昇順 */
  items: AgentChangesUndoItem[]
}

export type AgentChangesUndoCapture =
  | { kind: 'saved'; dir: string; items: AgentChangesUndoItem[] }
  | { kind: 'unavailable'; reason: AgentRevertUndoUnavailableReason }

export type AgentChangesUndoExecution =
  /** 何も書き換えずに拒否した。keepUndo は控えを残すか(読み込みの失敗だけ) */
  | { kind: 'rejected'; message: string; keepUndo: boolean }
  /**
   * 書き換えを始めた後、1 件も済まずに止まった(作業ツリーは変わっていない)。keepUndo は控えを残すか(書く直前に読み込めない・
   * 書き換えの失敗なら残す。書く直前の照合が合わない(戻した後に変わった)なら捨てる)
   */
  | { kind: 'failed'; message: string; keepUndo: boolean }
  | { kind: 'done'; restoredPaths: string[]; trashedPaths: string[] }
  | { kind: 'partial'; message: string; restoredPaths: string[]; trashedPaths: string[] }

/** 取り消しの前の全件の照合の結果(パスはパスの昇順の控えの順) */
export interface AgentChangesUndoPrecheck {
  /** 戻した直後の指紋と合わないパス */
  mismatched: string[]
  /** 読み込めなかったパスと理由 */
  unreadable: { path: string; reason: string }[]
  /** 控えのファイルが控えの一時ディレクトリから消えているパス */
  savedMissing: string[]
}

/** 取り消しの動作を before・after の肯定の根拠で決める(L-006) */
export function undoActionOf(
  item: Pick<AgentChangesUndoItem, 'before' | 'after'>
): AgentChangesUndoAction {
  if (item.before.kind === 'absent') return 'trash'
  if (item.after.kind === 'absent') return 'recreate'
  return 'rewrite'
}

/** renderer に渡す要約(控えの一時ディレクトリ・指紋は渡さない) */
export function summarizeAgentChangesUndo(
  undo: AgentChangesUndo | null
): AgentChangesUndoSummary | null {
  if (undo === null) return null
  return {
    undoId: undo.undoId,
    operation: undo.operation,
    entries: undo.items.map((item) => ({ path: item.path, action: undoActionOf(item) }))
  }
}

/** 戻す操作の結果に入れる控えの成否 */
export function toAgentRevertUndoOutcome(capture: AgentChangesUndoCapture): AgentRevertUndoOutcome {
  return capture.kind === 'saved'
    ? { kind: 'saved' }
    : { kind: 'unavailable', reason: capture.reason }
}

/**
 * 全件の照合の結果から、書き換えずに拒否するかを決める(拒否しないなら null)。不一致 → 控えを捨てる、控えのファイルが無い →
 * 控えを捨てる、読み込みの失敗だけ → 控えを残す、の順に見る
 */
export function undoPrecheckRejection(
  precheck: AgentChangesUndoPrecheck
): Extract<AgentChangesUndoExecution, { kind: 'rejected' }> | null {
  const { mismatched, unreadable, savedMissing } = precheck
  if (mismatched.length > 0) {
    return {
      kind: 'rejected',
      keepUndo: false,
      message: `${AGENT_UNDO_CHANGED_MESSAGE}（${listPathsForMessage(mismatched)}）`
    }
  }
  // 控えのファイルが無ければ(長いセッションで OS の一時ディレクトリの掃除に消されたなど)、書き換えの途中で読めずに止まる前に
  // 何も書かずに拒否する。もう一度押しても戻らないため、控えを捨てる
  if (savedMissing.length > 0) {
    return {
      kind: 'rejected',
      keepUndo: false,
      message: `${AGENT_UNDO_SAVED_MISSING_MESSAGE}（${listPathsForMessage(savedMissing)}）`
    }
  }
  if (unreadable.length > 0) {
    return {
      kind: 'rejected',
      keepUndo: true,
      message: `取り消しの対象を読み込めませんでした（${listPathsForMessage(unreadable.map((u) => u.path))}）: ${unreadable[0].reason}`
    }
  }
  return null
}

/** 書き換えの途中までの進み(済んだパスと全件の数) */
export interface AgentChangesUndoProgress {
  restoredPaths: string[]
  trashedPaths: string[]
  total: number
}

/**
 * 書き換えの途中で止まったときの結果。1 件以上済んでいれば partial(detail を添える)、0 件なら failed(zeroMessage と
 * keepUndo)。restoredPaths・trashedPaths はそのまま結果に入れる
 */
export function undoStoppedExecution(
  progress: AgentChangesUndoProgress,
  detail: string,
  zeroMessage: string,
  keepUndo: boolean
): Extract<AgentChangesUndoExecution, { kind: 'partial' | 'failed' }> {
  const { restoredPaths, trashedPaths, total } = progress
  const done = restoredPaths.length + trashedPaths.length
  return done > 0
    ? {
        kind: 'partial',
        message: `取り消しが途中で失敗しました（${done} / ${total} 件を取り消し済み）: ${detail}`,
        restoredPaths,
        trashedPaths
      }
    : { kind: 'failed', message: zeroMessage, keepUndo }
}

/** 書き換えを途中で止めた理由(書く直前の照合が合わない・書く直前に読み込めない・書き換えの失敗) */
export type AgentChangesUndoStop =
  | { kind: 'changed'; path: string }
  | { kind: 'unreadable'; path: string; reason: string }
  | { kind: 'write-failed'; path: string; reason: string }

/**
 * 止めた理由から止まったときの結果を作る(設計書の 4 の表)。合わない → 0 件なら「戻した後に変わった」の拒否と同じ文言で
 * 控えを捨てる(もう一度押しても戻らない)、読み込めない・書き換えの失敗 → 0 件なら「取り消しに失敗しました: <詳細>」で
 * 控えを残す(作業ツリーは変わっておらず、一時的な失敗なら直してもう一度取り消せる)。1 件以上済んでいれば partial に詳細を添える
 */
export function undoStopExecution(
  progress: AgentChangesUndoProgress,
  stop: AgentChangesUndoStop
): Extract<AgentChangesUndoExecution, { kind: 'partial' | 'failed' }> {
  if (stop.kind === 'changed') {
    return undoStoppedExecution(
      progress,
      `${stop.path} が戻した後に変わりました`,
      `${AGENT_UNDO_CHANGED_MESSAGE}（${stop.path}）`,
      false
    )
  }
  const detail =
    stop.kind === 'unreadable'
      ? `${stop.path} を読み込めませんでした: ${stop.reason}`
      : `${stop.path}: ${stop.reason}`
  return undoStoppedExecution(progress, detail, `取り消しに失敗しました: ${detail}`, true)
}

/** 取り消しの実行の結果を renderer に返す結果にする(rejected・failed は呼び出し側が投げる) */
export function toAgentChangesUndoResult(
  execution: Extract<AgentChangesUndoExecution, { kind: 'done' | 'partial' }>
): AgentChangesUndoResult {
  switch (execution.kind) {
    case 'done':
      return {
        status: 'done',
        restoredPaths: execution.restoredPaths,
        trashedPaths: execution.trashedPaths,
        undoSummary: null
      }
    case 'partial':
      return {
        status: 'partial',
        message: execution.message,
        restoredPaths: execution.restoredPaths,
        trashedPaths: execution.trashedPaths,
        undoSummary: null
      }
  }
}
