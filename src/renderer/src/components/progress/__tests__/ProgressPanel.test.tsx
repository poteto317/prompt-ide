import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ProgressPanel from '../ProgressPanel'
import { createTask } from '../../../lib/taskFactory'
import type { Task } from '../../../types'

const handlers = {
  onAddTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onRecordEvent: vi.fn(),
  onCompleteStage: vi.fn(),
  onReopenStage: vi.fn(),
  onSkipStage: vi.fn(),
  onAdvanceStage: vi.fn()
}

function renderPanel(tasks: Task[]) {
  return render(<ProgressPanel tasks={tasks} {...handlers} />)
}

describe('ProgressPanel', () => {
  it('タスクが無ければ空メッセージを表示', () => {
    renderPanel([])
    expect(screen.getByText('タスクがありません')).toBeInTheDocument()
  })

  it('タスク追加フォームから onAddTask を呼ぶ', async () => {
    renderPanel([])
    await userEvent.type(screen.getByLabelText('タスク名'), '新タスク')
    await userEvent.click(screen.getByRole('button', { name: 'タスクを追加' }))
    expect(handlers.onAddTask).toHaveBeenCalledWith('新タスク')
  })

  it('選択タスクのステージステッパーを表示', () => {
    renderPanel([createTask('機能追加')])
    expect(screen.getByText('機能追加')).toBeInTheDocument()
    expect(screen.getByText('1. プラン作成')).toBeInTheDocument()
    expect(screen.getByText('8. PR マージ')).toBeInTheDocument()
  })

  it('進捗サマリを表示する', () => {
    renderPanel([createTask('a')])
    expect(screen.getByLabelText('進捗')).toHaveTextContent('進捗 0/8')
  })

  it('タスクが 1 件のときセレクタを表示しない', () => {
    renderPanel([createTask('a')])
    expect(screen.queryByLabelText('タスクを選択')).not.toBeInTheDocument()
  })

  it('タスクが複数あるとセレクタで切り替えできる', async () => {
    const a = createTask('タスクA')
    const b = createTask('タスクB')
    renderPanel([a, b])
    const select = screen.getByLabelText('タスクを選択')
    expect(select).toBeInTheDocument()
    await userEvent.selectOptions(select, b.id)
    // ヘッダーにタスクBのタイトルが表示される
    expect(
      screen.getByText('タスクB', { selector: '.progress-panel__task-title' })
    ).toBeInTheDocument()
  })

  it('複数タスクがある場合、セレクタの value は先頭タスクの id で初期化される', () => {
    const a = createTask('タスクA')
    const b = createTask('タスクB')
    renderPanel([a, b])
    // TaskSelector の value は useSelectedTask が返す selectedId（先頭タスクの id）
    expect(screen.getByLabelText('タスクを選択')).toHaveValue(a.id)
  })

  it('削除ボタンで onDeleteTask を呼ぶ', async () => {
    const a = createTask('a')
    renderPanel([a])
    await userEvent.click(screen.getByRole('button', { name: 'タスクを削除' }))
    expect(handlers.onDeleteTask).toHaveBeenCalledWith(a.id)
  })

  it('凡例を表示する', () => {
    renderPanel([createTask('a')])
    expect(screen.getByLabelText('凡例')).toBeInTheDocument()
  })
})
