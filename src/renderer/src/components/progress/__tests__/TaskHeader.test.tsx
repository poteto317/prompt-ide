import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TaskHeader from '../TaskHeader'
import { createTask } from '../../../lib/taskFactory'

describe('TaskHeader', () => {
  it('タスクタイトルを表示する', () => {
    render(<TaskHeader task={createTask('機能追加')} onDelete={vi.fn()} />)
    expect(
      screen.getByText('機能追加', { selector: '.progress-panel__task-title' })
    ).toBeInTheDocument()
  })

  it('done ステージ数に応じた進捗サマリを表示する', () => {
    const task = createTask('a')
    task.stages[0].status = 'done'
    task.stages[1].status = 'done'
    render(<TaskHeader task={task} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 2/8')
  })

  it('初期状態では進捗が 0/8', () => {
    render(<TaskHeader task={createTask('a')} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 0/8')
  })

  it('進捗の分母はタスク自身のステージ数を使う', () => {
    const task = createTask('a')
    // stagesを先頭3件のみに削減して、設定定数(STAGES.length=8)ではなくtask.stages.lengthを使っていることを確認
    task.stages = task.stages.slice(0, 3)
    task.stages[0].status = 'done'
    render(<TaskHeader task={task} onDelete={vi.fn()} />)
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 1/3')
  })

  it('削除ボタンで onDelete がタスク id を伴って呼ばれる', async () => {
    const task = createTask('a')
    const onDelete = vi.fn()
    render(<TaskHeader task={task} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'タスクを削除' }))
    expect(onDelete).toHaveBeenCalledWith(task.id)
  })
})
