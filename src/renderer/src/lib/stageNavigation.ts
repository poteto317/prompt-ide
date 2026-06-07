import type { StageId, Task } from '../types'
import { STAGES } from '../config/stageConfig'
import { getStageIndex } from '../config/stageConfigUtils'

/**
 * 後続ステージから戻って対象ステージを再開する。
 * 対象は履歴があれば in_progress、無ければ not_started に戻す。
 * 対象より後続で done だったステージは「要再確認」として in_progress に落とす。
 */
export function reopenStage(task: Task, stageId: StageId): Task {
  const targetIndex = getStageIndex(stageId)
  if (targetIndex < 0) return task

  const stages = task.stages.map((stage) => {
    if (stage.id === stageId) {
      return { ...stage, status: stage.events.length > 0 ? 'in_progress' : ('not_started' as const) }
    }
    const index = getStageIndex(stage.id)
    if (index > targetIndex && stage.status === 'done') {
      return { ...stage, status: 'in_progress' as const }
    }
    return stage
  })
  return { ...task, stages, updatedAt: Date.now(), currentStageId: stageId }
}

/**
 * 現在ステージを完了扱いにして次のステージへ進める。
 * 最終ステージの場合は現在ステージを done にするのみ。
 */
export function advanceCurrentStage(task: Task): Task {
  const currentIndex = getStageIndex(task.currentStageId)
  if (currentIndex < 0) return task

  const nextStage = STAGES[currentIndex + 1]

  const stages = task.stages.map((stage) => {
    if (stage.id === task.currentStageId) {
      return stage.status === 'skipped' ? stage : { ...stage, status: 'done' as const }
    }
    if (nextStage && stage.id === nextStage.id && stage.status === 'not_started') {
      return { ...stage, status: 'in_progress' as const }
    }
    return stage
  })

  if (!nextStage) {
    return { ...task, stages, updatedAt: Date.now() }
  }

  return { ...task, stages, updatedAt: Date.now(), currentStageId: nextStage.id }
}
