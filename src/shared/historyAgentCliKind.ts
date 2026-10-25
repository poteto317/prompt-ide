import { isAgentCliKind } from './agentCliKinds'
import type { AgentCliKind } from './agentCliKinds'
import type { AgentHistoryInfo } from './types/history'

// 履歴のエントリの送り先の CLI の種類(設計書 2026-10-23「履歴への CLI の種類」)。新しい版で作った知らない種類の値も捨てずに保つため、
// 保存の形は文字列にし、AgentCliKind として使うときはここで読む(renderer の判定で文字列を種類の表のキーに直接使わない)。
// main の検証(historyUtils.ts)と renderer の判定が同じ規則を使う

/** 形の正しい種類の値(英小文字で始まり、英小文字・数字・ハイフンの 1〜32 文字)。知らない種類もこの形なら保つ */
export const HISTORY_AGENT_CLI_KIND_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

/** 段階 3a より前のエントリ(cliKind が無い)の種類。当時は claude へ送ったプロンプトだけが記録されたため(既定の種類とは別の値) */
export const LEGACY_AGENT_HISTORY_CLI_KIND: AgentCliKind = 'claude'

/** 履歴に保てる種類の値か(知らない種類を含む) */
export function isHistoryAgentCliKindValue(value: unknown): value is string {
  return typeof value === 'string' && HISTORY_AGENT_CLI_KIND_PATTERN.test(value)
}

/** 送り先の種類を、この版が知っている種類として読む。知らない種類(新しい版の種類)は null */
export function knownAgentCliKindOf(info: Pick<AgentHistoryInfo, 'cliKind'>): AgentCliKind | null {
  return isAgentCliKind(info.cliKind) ? info.cliKind : null
}
