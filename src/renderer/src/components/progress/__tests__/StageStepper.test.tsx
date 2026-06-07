import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StageStepper from '../StageStepper'
import { createTask } from '../../../lib/taskFactory'
import { STAGES } from '../../../config/stageConfig'
import { completeStage } from '../../../lib/stageTransitions'

const handlers = {
  onRecord: vi.fn(),
  onComplete: vi.fn(),
  onReopen: vi.fn(),
  onSkip: vi.fn(),
  onAdvance: vi.fn()
}

describe('StageStepper', () => {
  it('全 8 ステージを listitem として描画する', () => {
    render(<StageStepper task={createTask('a')} {...handlers} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(STAGES.length)
  })

  it('現在ステージで onAdvance を委譲する', async () => {
    const onAdvance = vi.fn()
    render(<StageStepper task={createTask('a')} {...handlers} onAdvance={onAdvance} />)
    await userEvent.click(screen.getByRole('button', { name: '次のステージへ進む' }))
    expect(onAdvance).toHaveBeenCalled()
  })

  it('ステージ ID 付きで onComplete を委譲する', async () => {
    const onComplete = vi.fn()
    render(<StageStepper task={createTask('a')} {...handlers} onComplete={onComplete} />)
    // prCreate は once なので「完了にする」ボタンを持つ
    const buttons = screen.getAllByRole('button', { name: '完了にする' })
    await userEvent.click(buttons[0])
    expect(onComplete).toHaveBeenCalledWith('prCreate')
  })

  it('ステージ ID 付きで onReopen を委譲する', async () => {
    const onReopen = vi.fn()
    // prCreate を完了済みにして「未完了に戻す」ボタンが表示される状態にする
    let task = createTask('a')
    task = completeStage(task, 'prCreate')
    render(<StageStepper task={task} {...handlers} onReopen={onReopen} />)
    await userEvent.click(screen.getByRole('button', { name: '未完了に戻す' }))
    expect(onReopen).toHaveBeenCalledWith('prCreate')
  })

  it('ステージ ID 付きで onSkip を委譲する', async () => {
    const onSkip = vi.fn()
    render(<StageStepper task={createTask('a')} {...handlers} onSkip={onSkip} />)
    // plan ステージは未完了（not_started）なので「スキップ」ボタンを持つ
    const skipButtons = screen.getAllByRole('button', { name: 'このステージをスキップする' })
    await userEvent.click(skipButtons[0])
    expect(onSkip).toHaveBeenCalledWith('plan')
  })

  it('ステージ ID と note 付きで onRecord を委譲する', async () => {
    const onRecord = vi.fn()
    render(<StageStepper task={createTask('a')} {...handlers} onRecord={onRecord} />)
    // refactor（repeatable）のトグルを開いて記録する
    const toggleButtons = screen.getAllByRole('button', { name: '履歴を開く' })
    // refactor は index 2 (plan=0, implement=1, refactor=2)
    await userEvent.click(toggleButtons[2])
    await userEvent.type(screen.getByLabelText('実施メモ'), 'メモ内容')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith('refactor', 'メモ内容')
  })
})
