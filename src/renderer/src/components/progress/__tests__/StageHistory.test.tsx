import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StageHistory from '../StageHistory'
import type { Stage } from '../../../types'

function stage(events: Stage['events']): Stage {
  return { id: 'refactor', status: 'in_progress', events }
}

describe('StageHistory', () => {
  it('履歴が無ければ「履歴はありません」を表示', () => {
    render(<StageHistory stage={stage([])} kind="repeatable" onRecord={vi.fn()} />)
    expect(screen.getByText('履歴はありません')).toBeInTheDocument()
  })

  it('履歴のメモと meta を表示', () => {
    render(
      <StageHistory
        stage={stage([
          { id: 'e1', occurredAt: 1000, note: 'PromptItem を分割', meta: { commit: 'abc' } }
        ])}
        kind="repeatable"
        onRecord={vi.fn()}
      />
    )
    expect(screen.getByText('PromptItem を分割')).toBeInTheDocument()
    expect(screen.getByText('commit: abc')).toBeInTheDocument()
  })

  it('repeatable では記録フォームを表示し note 付きで onRecord を呼ぶ', async () => {
    const onRecord = vi.fn()
    render(<StageHistory stage={stage([])} kind="repeatable" onRecord={onRecord} />)
    await userEvent.type(screen.getByLabelText('実施メモ'), 'メモ内容')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith('メモ内容')
  })

  it('空メモなら undefined で onRecord を呼ぶ', async () => {
    const onRecord = vi.fn()
    render(<StageHistory stage={stage([])} kind="repeatable" onRecord={onRecord} />)
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith(undefined)
  })

  it('revisable では記録フォームを表示し note 付きで onRecord を呼ぶ', async () => {
    const onRecord = vi.fn()
    render(<StageHistory stage={stage([])} kind="revisable" onRecord={onRecord} />)
    await userEvent.type(screen.getByLabelText('実施メモ'), 'プラン見直し')
    await userEvent.click(screen.getByRole('button', { name: '実施を記録する' }))
    expect(onRecord).toHaveBeenCalledWith('プラン見直し')
  })

  it('once では記録フォームを表示しない', () => {
    render(<StageHistory stage={stage([])} kind="once" onRecord={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '実施を記録する' })).not.toBeInTheDocument()
  })
})
