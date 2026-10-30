import { render, screen, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
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

function renderPanel(tasks: Task[]): RenderResult {
  return render(<ProgressPanel tasks={tasks} {...handlers} />)
}

// STAGES 配列の並び順に依存せず、ステージ名の表示ラベルで対象の <li> 行を一意に特定する
function stageRow(label: string): HTMLElement {
  return screen.getByText(new RegExp(label)).closest('li') as HTMLElement
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

  it('スキップボタンで onSkipStage を呼ぶ', async () => {
    const a = createTask('a')
    renderPanel([a])
    const planRow = within(stageRow('プラン作成'))
    await userEvent.click(planRow.getByRole('button', { name: 'このステージをスキップする' }))
    expect(handlers.onSkipStage).toHaveBeenCalledWith(a.id, 'plan')
  })

  it('次へ進むボタンで onAdvanceStage を呼ぶ', async () => {
    const a = createTask('a')
    renderPanel([a])
    await userEvent.click(screen.getByRole('button', { name: '次のステージへ進む' }))
    expect(handlers.onAdvanceStage).toHaveBeenCalledWith(a.id)
  })

  it('完了にするボタンで onCompleteStage を呼ぶ', async () => {
    const a = createTask('a')
    renderPanel([a])
    const prCreateRow = within(stageRow('PR 作成'))
    await userEvent.click(prCreateRow.getByRole('button', { name: '完了にする' }))
    expect(handlers.onCompleteStage).toHaveBeenCalledWith(a.id, 'prCreate')
  })

  it('再開するボタンで onReopenStage を呼ぶ', async () => {
    const a = createTask('a')
    a.stages = a.stages.map((s) => (s.id === 'commit' ? { ...s, status: 'done' } : s))
    renderPanel([a])
    await userEvent.click(screen.getByRole('button', { name: 'このステージを再開する' }))
    expect(handlers.onReopenStage).toHaveBeenCalledWith(a.id, 'commit')
  })

  it('実施を記録するボタンで onRecordEvent を呼ぶ', async () => {
    const a = createTask('a')
    renderPanel([a])
    const planRow = within(stageRow('プラン作成'))
    await userEvent.click(planRow.getByRole('button', { name: '履歴を開く' }))
    await userEvent.type(planRow.getByLabelText('実施メモ'), 'メモ内容')
    await userEvent.click(planRow.getByRole('button', { name: '実施を記録する' }))
    expect(handlers.onRecordEvent).toHaveBeenCalledWith(a.id, 'plan', 'メモ内容')
  })
})
