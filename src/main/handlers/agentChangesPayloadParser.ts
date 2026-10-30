import type {
  AgentChangesBeginTrigger,
  AgentChangesScope,
  AgentRevertAllEntry
} from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT, isAgentChangeStatus } from '@shared/types'
import { isPlainObject } from '@shared/typeGuards'
import { IPC_PATH_MAX_LENGTH } from './payloadValidators'

// agentChanges:* の入力の型の検証(設計書「セキュリティ」)。値の中身(許可のフォルダの中か・いまの一覧に含まれるか・パッチの
// 対象)は受け口(resolveAndAssertStatusRelativePath)と agentChangesRevert が確かめる。ここは範囲・trigger の列挙の検証、型と粗い上限だけ

/** パッチの長さの上限(UTF-16 の単位)。git apply に巨大な入力を渡さないための粗い上限(差異 2) */
export const AGENT_CHANGES_PATCH_MAX_LENGTH = 10_000_000

/** リポジトリ相対のパス。空でない文字列で、realpath に渡す前の粗い上限はフォルダのパスと同じ */
export function parseAgentChangePath(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('path は空でない文字列である必要があります')
  }
  if (value.length > IPC_PATH_MAX_LENGTH) {
    throw new Error(`path は ${IPC_PATH_MAX_LENGTH} 文字以下である必要があります`)
  }
  return value
}

export function parseAgentChangePatch(value: unknown): string {
  if (typeof value !== 'string') throw new Error('patch は文字列である必要があります')
  if (value.length > AGENT_CHANGES_PATCH_MAX_LENGTH) {
    throw new Error(`patch は ${AGENT_CHANGES_PATCH_MAX_LENGTH} 文字以下である必要があります`)
  }
  return value
}

/** 「すべて戻す」の確認の一覧。{ path, status } の配列(最大 AGENT_CHANGES_LIST_LIMIT 件)。余分なキーは詰め直して落とす */
export function parseAgentRevertAllEntries(value: unknown): AgentRevertAllEntry[] {
  if (!Array.isArray(value) || value.length > AGENT_CHANGES_LIST_LIMIT) {
    throw new Error('確認の一覧が不正です')
  }
  return value.map((entry: unknown) => {
    if (!isPlainObject(entry)) {
      throw new Error('確認の一覧が不正です')
    }
    const { path, status } = entry
    if (typeof path !== 'string' || path === '' || path.length > IPC_PATH_MAX_LENGTH) {
      throw new Error('確認の一覧が不正です')
    }
    if (!isAgentChangeStatus(status)) throw new Error('確認の一覧が不正です')
    return { path, status }
  })
}

/** 戻す系の IPC に実行の範囲が来たとき(実行ごとの表示は見るだけ。ボタンを押せなくするだけでなく main でも拒む。L-058) */
export const AGENT_CHANGES_REVERT_SCOPE_MESSAGE =
  '実行ごとの表示では戻せません。「すべて（累積）」を選んでから戻してください'

const SCOPE_INVALID_MESSAGE = '範囲(scope)が不正です'

/** 記録の開始の依頼の種類。省略・未知の値を既定に流さず例外にする(L-044) */
export function parseAgentChangesBeginTrigger(value: unknown): AgentChangesBeginTrigger {
  if (value !== 'send' && value !== 'manual') {
    throw new Error('trigger は send か manual である必要があります')
  }
  return value
}

/**
 * 一覧・diff の範囲。プレーンなオブジェクトで、キーは all なら kind だけ、run なら kind・runId だけ。runId は 1 以上の安全な整数。
 * どれかが外れたら例外(省略を all に流さない。L-044)。値は詰め直して返す
 */
export function parseAgentChangesScope(value: unknown): AgentChangesScope {
  if (!isPlainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(SCOPE_INVALID_MESSAGE)
  }
  const record = value
  const keys = Object.keys(record)
  if (record.kind === 'all' && keys.length === 1) return { kind: 'all' }
  if (
    record.kind === 'run' &&
    keys.length === 2 &&
    keys.includes('runId') &&
    typeof record.runId === 'number' &&
    Number.isSafeInteger(record.runId) &&
    record.runId >= 1
  ) {
    return { kind: 'run', runId: record.runId }
  }
  throw new Error(SCOPE_INVALID_MESSAGE)
}

/** 戻す系の範囲。累積だけを受け付ける */
export function parseRevertScope(value: unknown): { kind: 'all' } {
  const scope = parseAgentChangesScope(value)
  if (scope.kind !== 'all') throw new Error(AGENT_CHANGES_REVERT_SCOPE_MESSAGE)
  return scope
}

export const AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE = 'undoId は 1 以上の整数である必要があります'

/** 取り消しの ID(renderer から受け取るのはこれだけ。取り消すパス・控えは main が決める。L-019)。省略・未知の形は例外 */
export function parseAgentChangesUndoId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE)
  }
  return value
}
