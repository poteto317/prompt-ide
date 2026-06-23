import { isValidPrompt, sanitizePrompt } from './promptUtils'
import { PROMPT_EXPORT_KIND } from '@shared/types'
import type { Prompt, PromptExport } from '@shared/types'

/** プロンプト配列をエクスポート用エンベロープに包む（sanitize 済みで格納）。 */
export function buildExport(prompts: Prompt[]): PromptExport {
  return {
    kind: PROMPT_EXPORT_KIND,
    version: 1,
    exportedAt: Date.now(),
    prompts: prompts.map(sanitizePrompt),
  }
}

/** エンベロープ形式・素の配列形式の両方を受理し、不正要素を除外して返す。パース不能時は空配列。 */
export function parseImport(raw: string): Prompt[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const list = extractPromptList(parsed)
  return list.filter(isValidPrompt).map(sanitizePrompt)
}

function extractPromptList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as Record<string, unknown>).kind === PROMPT_EXPORT_KIND &&
    Array.isArray((parsed as Record<string, unknown>).prompts)
  ) {
    return (parsed as { prompts: unknown[] }).prompts
  }
  return []
}
