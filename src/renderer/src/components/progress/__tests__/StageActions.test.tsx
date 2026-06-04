import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StageActions from '../StageActions'
import type { Stage } from '../../../types'

function stage(status: Stage['status']): Stage {
  return { id: 'refactor', status, events: [] }
}

const handlers = {
  onComplete: vi.fn(),
  onReopen: vi.fn(),
  onSkip: vi.fn(),
  onAdvance: vi.fn()
}

describe('StageActions', () => {
  it('once 未完了: 「完了にする」を表示', () => {
    render(
      <StageActions
        stage={stage('not_started')}
        kind="once"
        isCurrent={false}
        isLast={false}
        {...handlers}
      />
    )
    expect(screen.getByRole('button', { name: '完了にする' })).toBeInTheDocument()
  })

  it('once 完了: 「未完了に戻す」を表示し onReopen を呼ぶ', async () => {
    render(
      <StageActions
        stage={stage('done')}
        kind="once"
        isCurrent={false}
        isLast={false}
        {...handlers}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '未完了に戻す' }))
    expect(handlers.onReopen).toHaveBeenCalled()
  })

  it('repeatable done: 「再開する」を表示', () => {
    render(
      <StageActions
        stage={stage('done')}
        kind="repeatable"
        isCurrent={false}
        isLast={false}
        {...handlers}
      />
    )
    expect(screen.getByRole('button', { name: 'このステージを再開する' })).toBeInTheDocument()
  })

  it('未完了・未スキップ時はスキップボタンを表示', async () => {
    render(
      <StageActions
        stage={stage('in_progress')}
        kind="repeatable"
        isCurrent={false}
        isLast={false}
        {...handlers}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'このステージをスキップする' }))
    expect(handlers.onSkip).toHaveBeenCalled()
  })

  it('現在ステージかつ最終でなければ「次へ進む」を表示', async () => {
    render(
      <StageActions
        stage={stage('in_progress')}
        kind="repeatable"
        isCurrent
        isLast={false}
        {...handlers}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: '次のステージへ進む' }))
    expect(handlers.onAdvance).toHaveBeenCalled()
  })

  it('最終ステージでは「次へ進む」を表示しない', () => {
    render(<StageActions stage={stage('in_progress')} kind="once" isCurrent isLast {...handlers} />)
    expect(screen.queryByRole('button', { name: '次のステージへ進む' })).not.toBeInTheDocument()
  })

  it('done ステージではスキップボタンを表示しない', () => {
    render(
      <StageActions
        stage={stage('done')}
        kind="repeatable"
        isCurrent={false}
        isLast={false}
        {...handlers}
      />
    )
    expect(
      screen.queryByRole('button', { name: 'このステージをスキップする' })
    ).not.toBeInTheDocument()
  })
})
