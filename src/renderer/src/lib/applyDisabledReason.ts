import type { ApplyOutputState } from '../types'

// 無効の理由(ボタンの title・aria-describedby と、出力パネルのヘッダーの案内)
export const APPLY_DISABLED_REASONS = {
  noEditor: '反映先のファイルが表示されていません',
  executing: '実行中は反映できません',
  noSelection: '選択範囲がありません'
} as const

export interface ApplyDisabledReasons {
  insert: string | null
  replace: string | null
}

/**
 * 挿入・置換できない理由(null ならできる)。優先順位は エディタが無い > 実行中 > 選択範囲が無い(置換だけ)。
 * 置換の理由は挿入の理由を含む(挿入できないなら置換もできない)
 */
export function getApplyDisabledReasons({
  hasTarget,
  isExecuting,
  hasSelection
}: {
  hasTarget: boolean
  isExecuting: boolean
  hasSelection: boolean
}): ApplyDisabledReasons {
  const insert = !hasTarget
    ? APPLY_DISABLED_REASONS.noEditor
    : isExecuting
      ? APPLY_DISABLED_REASONS.executing
      : null
  const replace = insert ?? (hasSelection ? null : APPLY_DISABLED_REASONS.noSelection)
  return { insert, replace }
}

/**
 * 出力パネルのヘッダーに 1 つだけ表示する無効の理由(無効なボタンの aria-describedby の参照先)。
 * getApplyDisabledReasons では置換の理由は挿入の理由を含むが、型はそれを保証しないため、置換の理由が無い
 * ときは挿入の理由を出す。どちらかのボタンが無効なら必ず null 以外を返す(参照先の要素が必ずある)
 */
export function getShownDisabledReason(
  reasons: Pick<ApplyOutputState, 'insertDisabledReason' | 'replaceDisabledReason'>
): string | null {
  return reasons.replaceDisabledReason ?? reasons.insertDisabledReason
}
