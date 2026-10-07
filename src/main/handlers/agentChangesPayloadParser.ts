import type { AgentRevertAllEntry } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT, isAgentChangeStatus } from '@shared/types'
import { IPC_PATH_MAX_LENGTH } from './payloadValidators'

// agentChanges:* の入力の型の検証(設計書「セキュリティ」)。値の中身(許可のフォルダの中か・いまの一覧に含まれるか・パッチの
// 対象)は受け口(resolveAndAssertStatusRelativePath)と agentChangesRevert が確かめる。ここは型と粗い上限だけ

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
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error('確認の一覧が不正です')
    }
    const { path, status } = entry as Record<string, unknown>
    if (typeof path !== 'string' || path === '' || path.length > IPC_PATH_MAX_LENGTH) {
      throw new Error('確認の一覧が不正です')
    }
    if (!isAgentChangeStatus(status)) throw new Error('確認の一覧が不正です')
    return { path, status }
  })
}
