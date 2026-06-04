import type { Stage, StageKind } from '../types'

export type StageActionType = 'complete' | 'reopen' | 'skip' | 'advance'

export interface StageActionDescriptor {
  type: StageActionType
  label: string
  ariaLabel: string
}

/**
 * ステージの種別・状態・現在位置から、表示すべきアクションボタンの一覧を導出する純粋関数。
 * 表示順は complete/reopen → skip → advance。
 */
export function stageActionList(
  stage: Stage,
  kind: StageKind,
  isCurrent: boolean,
  isLast: boolean
): StageActionDescriptor[] {
  const isDone = stage.status === 'done'
  const isSkipped = stage.status === 'skipped'
  const actions: StageActionDescriptor[] = []

  if (kind === 'once') {
    actions.push(
      isDone
        ? { type: 'reopen', label: '未完了に戻す', ariaLabel: '未完了に戻す' }
        : { type: 'complete', label: '完了にする', ariaLabel: '完了にする' }
    )
  } else if (isDone) {
    actions.push({ type: 'reopen', label: '再開する', ariaLabel: 'このステージを再開する' })
  }

  if (!isDone && !isSkipped) {
    actions.push({ type: 'skip', label: 'スキップ', ariaLabel: 'このステージをスキップする' })
  }

  if (isCurrent && !isLast) {
    actions.push({ type: 'advance', label: '次へ進む', ariaLabel: '次のステージへ進む' })
  }

  return actions
}
