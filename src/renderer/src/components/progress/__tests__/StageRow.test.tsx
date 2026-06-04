import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StageRow from '../StageRow'
import type { Stage } from '../../../types'
import type { StageDefinition } from '../../../config/stageConfig'

const repeatableDef: StageDefinition = {
  id: 'refactor',
  label: 'リファクタリング',
  kind: 'repeatable'
}
const onceDef: StageDefinition = { id: 'prCreate', label: 'PR 作成', kind: 'once' }

const handlers = {
  onRecord: vi.fn(),
  onComplete: vi.fn(),
  onReopen: vi.fn(),
  onSkip: vi.fn(),
  onAdvance: vi.fn()
}

function renderRow(stage: Stage, definition: StageDefinition, isCurrent = false) {
  return render(
    <StageRow
      stage={stage}
      definition={definition}
      index={2}
      isCurrent={isCurrent}
      isLast={false}
      {...handlers}
    />
  )
}

describe('StageRow', () => {
  it('番号付きのステージ名を表示', () => {
    renderRow({ id: 'refactor', status: 'not_started', events: [] }, repeatableDef)
    expect(screen.getByText('3. リファクタリング')).toBeInTheDocument()
  })

  it('once 種別は「(一度きり)」を表示', () => {
    renderRow({ id: 'prCreate', status: 'not_started', events: [] }, onceDef)
    expect(screen.getByText('(一度きり)')).toBeInTheDocument()
  })

  it('repeatable で履歴があれば回数バッジ ×N を表示', () => {
    renderRow(
      {
        id: 'refactor',
        status: 'in_progress',
        events: [
          { id: 'e1', occurredAt: 1 },
          { id: 'e2', occurredAt: 2 }
        ]
      },
      repeatableDef
    )
    expect(screen.getByText('×2')).toBeInTheDocument()
  })

  it('once 種別では回数バッジを表示しない', () => {
    renderRow({ id: 'prCreate', status: 'done', events: [{ id: 'e1', occurredAt: 1 }] }, onceDef)
    expect(screen.queryByText('×1')).not.toBeInTheDocument()
  })

  it('トグルで履歴を開閉できる', async () => {
    renderRow({ id: 'refactor', status: 'in_progress', events: [] }, repeatableDef)
    expect(screen.queryByText('履歴はありません')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '履歴を開く' }))
    expect(screen.getByText('履歴はありません')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '履歴を閉じる' }))
    expect(screen.queryByText('履歴はありません')).not.toBeInTheDocument()
  })

  it('現在ステージは aria-current="step" を持つ', () => {
    renderRow({ id: 'refactor', status: 'in_progress', events: [] }, repeatableDef, true)
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'step')
  })
})
