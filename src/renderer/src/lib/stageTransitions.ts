import type { Stage, StageEvent, StageId, Task } from '../types'

function touch(task: Task, stages: Stage[]): Task {
  return { ...task, stages, updatedAt: Date.now() }
}

function mapStage(task: Task, stageId: StageId, fn: (stage: Stage) => Stage): Stage[] {
  return task.stages.map((stage) => (stage.id === stageId ? fn(stage) : stage))
}

/**
 * 繰り返し/改訂ステージで実施を記録する。
 * events に追加し、未着手であれば in_progress に更新する（done はそのまま）。
 */
export function recordStageEvent(task: Task, stageId: StageId, event: StageEvent): Task {
  const stages = mapStage(task, stageId, (stage) => ({
    ...stage,
    status: stage.status === 'not_started' ? 'in_progress' : stage.status,
    events: [...stage.events, event]
  }))
  return touch(task, stages)
}

/**
 * ステージを完了にする。
 * event を渡した場合は既存の events をその 1 件で置き換える（once 系の 1 件化に使用）。
 * event を渡さない場合は既存の events をそのまま保持する。
 */
export function completeStage(task: Task, stageId: StageId, event?: StageEvent): Task {
  const stages = mapStage(task, stageId, (stage) => ({
    ...stage,
    status: 'done',
    events: event ? [event] : stage.events
  }))
  return touch(task, stages)
}

/**
 * ステージをスキップ状態にする。
 */
export function skipStage(task: Task, stageId: StageId): Task {
  const stages = mapStage(task, stageId, (stage) => ({ ...stage, status: 'skipped' }))
  return touch(task, stages)
}
