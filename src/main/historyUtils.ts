import type { AgentHistoryInfo, HistoryEntry, HistoryStatus, PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS, isCliSessionId } from '@shared/types'
import { isObjectLike, isOneOf, isPlainObject } from '@shared/typeGuards'
import {
  LEGACY_AGENT_HISTORY_CLI_KIND,
  isHistoryAgentCliKindValue
} from '@shared/historyAgentCliKind'

const TOOL_IDS: readonly PromptToolId[] = EXECUTION_TOOLS.map((tool) => tool.id)

function isPromptToolId(value: unknown): value is PromptToolId {
  return isOneOf(TOOL_IDS, value)
}

/**
 * history.json に残っている agent の形。段階 3a より前のエントリは cliKind が無い(sanitizeHistoryEntry が claude を補う)
 */
export type StoredAgentHistoryInfo = Omit<AgentHistoryInfo, 'cliKind'> & { cliKind?: string }

/**
 * history.json に残っている(または IPC で届いた)エントリの形。isValidHistoryEntry が受け付ける型で、HistoryEntry より緩い
 * (古い形式は agent が無く、agent の cliKind も無いことがある)。sanitizeHistoryEntry で HistoryEntry に作り直してから使う
 */
export type StoredHistoryEntry = Omit<HistoryEntry, 'agent'> & {
  agent?: StoredAgentHistoryInfo | null
}

function isHistoryStatus(value: unknown): value is HistoryStatus {
  return value === 'success' || value === 'error' || value === 'sent'
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== ''

function isStoredAgentHistoryInfo(value: unknown): value is StoredAgentHistoryInfo {
  if (!isPlainObject(value)) return false
  const a = value
  return (
    isCliSessionId(a.claudeSessionId) &&
    // 段階 3a より前のエントリは cliKind が無い(正規化で claude を補う)。形の不正な値は既定に流さず不正とする(L-044)
    (a.cliKind === undefined || isHistoryAgentCliKindValue(a.cliKind)) &&
    isNonEmptyString(a.tabLabel) &&
    isNonEmptyString(a.folderPath)
  )
}

// agent は古い形式(undefined)・null・正しい形のオブジェクトだけを受け付け、agent があるときかつそのときだけ status は sent。
// 形の不正な agent を従来のエントリへ読み替えない(従来の方式で非対話の claude に再実行させる経路へ流れるため。L-044)
function hasConsistentAgent(h: Record<string, unknown>): boolean {
  if (h.agent === undefined || h.agent === null) return h.status !== 'sent'
  return isStoredAgentHistoryInfo(h.agent) && h.status === 'sent'
}

export function isValidHistoryEntry(item: unknown): item is StoredHistoryEntry {
  if (!isObjectLike(item)) return false
  const h = item
  return (
    typeof h.id === 'string' &&
    (h.promptId === null || typeof h.promptId === 'string') &&
    typeof h.promptTitle === 'string' &&
    typeof h.promptContent === 'string' &&
    (h.fileContent === null || typeof h.fileContent === 'string') &&
    isPromptToolId(h.toolId) &&
    isHistoryStatus(h.status) &&
    (h.resultText === null || typeof h.resultText === 'string') &&
    (h.errorMessage === null || typeof h.errorMessage === 'string') &&
    typeof h.executedAt === 'number' &&
    Number.isFinite(h.executedAt) &&
    hasConsistentAgent(h)
  )
}

// 保存(history:save)も同じ関数を通るため、agent をここで取り出し直さないと保存のたびに黙って消える(L-015)。
// 古い形式(agent 無し)は null にし、agent の中も 4 つのフィールドだけに作り直す(cliKind が無い段階 3a より前のエントリは claude を補う)
export function sanitizeHistoryEntry(item: StoredHistoryEntry): HistoryEntry {
  const {
    id,
    promptId,
    promptTitle,
    promptContent,
    fileContent,
    toolId,
    status,
    resultText,
    errorMessage,
    executedAt,
    agent
  } = item
  return {
    id,
    promptId,
    promptTitle,
    promptContent,
    fileContent,
    toolId,
    status,
    resultText,
    errorMessage,
    executedAt,
    agent:
      agent === undefined || agent === null
        ? null
        : {
            claudeSessionId: agent.claudeSessionId,
            // 段階 3a より前のエントリは cliKind が無い(型の外の値)。知らない種類の値はそのまま保つ(L-456・L-459)
            cliKind: agent.cliKind ?? LEGACY_AGENT_HISTORY_CLI_KIND,
            tabLabel: agent.tabLabel,
            folderPath: agent.folderPath
          }
  }
}
