'use client'
import type { StageId, Task } from '../../types'
import { useSelectedTask } from '../../hooks/useSelectedTask'
import AddTaskForm from './AddTaskForm'
import StageStepper from './StageStepper'
import StageLegend from './StageLegend'
import TaskSelector from './TaskSelector'
import TaskHeader from './TaskHeader'

interface Props {
  tasks: Task[]
  onAddTask: (title: string) => void
  onDeleteTask: (id: string) => void
  onRecordEvent: (taskId: string, stageId: StageId, note?: string) => void
  onCompleteStage: (taskId: string, stageId: StageId) => void
  onReopenStage: (taskId: string, stageId: StageId) => void
  onSkipStage: (taskId: string, stageId: StageId) => void
  onAdvanceStage: (taskId: string) => void
}

export default function ProgressPanel({
  tasks,
  onAddTask,
  onDeleteTask,
  onRecordEvent,
  onCompleteStage,
  onReopenStage,
  onSkipStage,
  onAdvanceStage
}: Props) {
  const { selectedTask, selectedId, setSelectedId } = useSelectedTask(tasks)

  return (
    <div className="progress-panel">
      {tasks.length > 1 && (
        <TaskSelector
          tasks={tasks}
          selectedId={selectedTask?.id ?? null}
          onSelect={setSelectedId}
        />
      )}

      <div className="progress-panel__body">
        {tasks.length === 0 ? (
          <p className="progress-panel__empty">タスクがありません</p>
        ) : selectedTask ? (
          <>
            <TaskHeader task={selectedTask} onDelete={onDeleteTask} />
            <StageStepper
              task={selectedTask}
              onRecord={(stageId, note) => onRecordEvent(selectedTask.id, stageId, note)}
              onComplete={(stageId) => onCompleteStage(selectedTask.id, stageId)}
              onReopen={(stageId) => onReopenStage(selectedTask.id, stageId)}
              onSkip={(stageId) => onSkipStage(selectedTask.id, stageId)}
              onAdvance={() => onAdvanceStage(selectedTask.id)}
            />
            <StageLegend />
          </>
        ) : null}
      </div>

      <AddTaskForm onAdd={onAddTask} />
    </div>
  )
}
