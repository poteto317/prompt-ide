import type { AgentCliKindSetting } from '@shared/types'
import { DEFAULT_AGENT_CLI_KIND, isAgentCliKind } from '@shared/agentCliKinds'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// 使うエージェント CLI の読み書き(userData/settings.json の agentCliKind。executionModeStore と同じ形で、API キー・モデルと同じ
// ファイルにマージで書く)。main は起動のたびにここを読む(renderer の値は使わない。L-019)。読めない値は既定(claude)に戻すが、
// 黙って流さず、ログと設定の画面(fallback)で知らせる(L-044)。設定ファイルには API キーの暗号文があるため、例外の文言はログに
// 出さず、保存されていた値も先頭だけを出す(L-017)

/** 保存されていた値をログに出すときの長さの上限(JSON の文字列の先頭) */
export const AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH = 80
/** 保存の拒否の文言(値を入れない。L-017) */
const AGENT_CLI_KIND_INVALID_ERROR = '使うエージェント CLI が不正です'
const READ_FAILED_LOG = '[agentCliKind] 設定ファイルを読めないため claude を使います'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 設定ファイルから読んだ値を、ログに出せる長さの JSON にする(JSON から読んだ値なので JSON.stringify は投げない) */
function describeStoredValue(value: unknown): string {
  return String(JSON.stringify(value)).slice(0, AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH)
}

/**
 * 保存された種類と、既定に戻した理由。キーが無ければ既定(fallback は null)、知らない値なら既定(invalid-value)、
 * 設定ファイルを読めない・読んだ値が普通のオブジェクトでなければ既定(read-failed)。投げない(起動を止めない)
 */
export async function getAgentCliKindSetting(
  log: (message: string) => void = console.warn
): Promise<AgentCliKindSetting> {
  let value: unknown
  try {
    // readSettingsFile は JSON.parse の結果を型の主張だけで返す。null・配列・数・文字列の JSON でも投げないため、ここで確かめる
    const data: unknown = await readSettingsFile()
    if (!isPlainObject(data)) {
      log(READ_FAILED_LOG)
      return { kind: DEFAULT_AGENT_CLI_KIND, fallback: 'read-failed' }
    }
    value = data.agentCliKind
  } catch {
    log(READ_FAILED_LOG)
    return { kind: DEFAULT_AGENT_CLI_KIND, fallback: 'read-failed' }
  }
  if (value === undefined) return { kind: DEFAULT_AGENT_CLI_KIND, fallback: null }
  if (isAgentCliKind(value)) return { kind: value, fallback: null }
  log(
    `[agentCliKind] 保存されていた値を読めないため claude を使います: ${describeStoredValue(value)}`
  )
  return { kind: DEFAULT_AGENT_CLI_KIND, fallback: 'invalid-value' }
}

/** 検証してから保存する。知らない値は投げて書かない(claude に倒さない。L-044) */
export async function setAgentCliKind(kind: unknown): Promise<void> {
  if (!isAgentCliKind(kind)) throw new Error(AGENT_CLI_KIND_INVALID_ERROR)
  await writeSettingsFile({ agentCliKind: kind })
}
