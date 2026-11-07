// 指示ファイルの節の固定の文言(設計書 2026-11-05)。main の例外の文言は画面に出さない(L-017)。
// 画面に出さない理由(folderChanged)には文言を持たせない
import type { AgentInstructionCreateShownFailureReason } from '@shared/types'

const FAILURE_MESSAGES: Record<AgentInstructionCreateShownFailureReason, string> = {
  exists:
    '同じ名前のファイルかフォルダが既にあります(大文字と小文字だけ違う名前を含みます)。ファイルツリーを確かめてください',
  outside: 'フォルダの外には作成できません',
  failed: '指示ファイルを作成できませんでした'
}

export function agentInstructionCreateFailureMessage(
  reason: AgentInstructionCreateShownFailureReason
): string {
  return FAILURE_MESSAGES[reason]
}

export const AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED =
  '作成しましたが、開けませんでした。ファイルツリーから開いてください'

/** 節の `更新` で、ファイルツリーの読み直しが拒否されたとき(例外の文言は出さない。L-017) */
export const AGENT_INSTRUCTION_REFRESH_FAILED = 'ファイルツリーを読み直せませんでした'

/** 節の小見出し(設計書 2026-11-07「文言」) */
export const AGENT_INSTRUCTION_THIS_FOLDER_HEADING = 'このフォルダ'

/** サブフォルダの開閉のボタン。件数は上限で隠した分を含む全件 */
export function agentInstructionSubfolderToggleLabel(total: number): string {
  return `サブフォルダ(${total} 件)`
}

export const AGENT_INSTRUCTION_SUBFOLDER_EMPTY = 'サブフォルダに指示ファイルはありません'

/** 上限を超えて一覧に出さなかった分 */
export function agentInstructionSubfolderHiddenLabel(count: number): string {
  return `ほか ${count} 件(ファイルツリーから開いてください)`
}

/** 節の `更新`。aria-label はソース管理のツールバーの `更新`(↻)と読み上げで区別する */
export const AGENT_INSTRUCTION_REFRESH_TEXT = '更新'
export const AGENT_INSTRUCTION_REFRESH_LABEL = '指示ファイルの一覧を更新'
export const AGENT_INSTRUCTION_REFRESH_TITLE =
  'ファイルツリーを読み直して、指示ファイルを探し直します'
