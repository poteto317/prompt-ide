import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import StageRowHeader from '../StageRowHeader'
import type { Stage } from '../../../types'
import type { StageDefinition } from '../../../config/stageConfig'

const repeatableDef: StageDefinition = {
  id: 'refactor',
  label: 'リファクタリング',
  kind: 'repeatable'
}
const onceDef: StageDefinition = { id: 'prCreate', label: 'PR 作成', kind: 'once' }

function renderHeader(
  stage: Stage,
  definition: StageDefinition,
  expanded = false,
  onToggle = vi.fn()
) {
  return render(
    <StageRowHeader
      stage={stage}
      definition={definition}
      index={2}
      expanded={expanded}
      onToggle={onToggle}
    />
  )
}

describe('StageRowHeader', () => {
  it('番号付きのステージ名を表示', () => {
    renderHeader({ id: 'refactor', status: 'not_started', events: [] }, repeatableDef)
    expect(screen.getByText('3. リファクタリング')).toBeInTheDocument()
  })

  it('ステータスに応じたアイコンラベルを表示', () => {
    renderHeader({ id: 'refactor', status: 'in_progress', events: [] }, repeatableDef)
    expect(screen.getByLabelText('進行中')).toBeInTheDocument()
  })

  it('once 種別は「(一度きり)」を表示', () => {
    renderHeader({ id: 'prCreate', status: 'not_started', events: [] }, onceDef)
    expect(screen.getByText('(一度きり)')).toBeInTheDocument()
  })

  it('repeatable で履歴があれば回数バッジ ×N を表示', () => {
    renderHeader(
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
    renderHeader({ id: 'prCreate', status: 'done', events: [{ id: 'e1', occurredAt: 1 }] }, onceDef)
    expect(screen.queryByText('×1')).not.toBeInTheDocument()
  })

  it('repeatable でも履歴が無ければ回数バッジを表示しない', () => {
    renderHeader({ id: 'refactor', status: 'not_started', events: [] }, repeatableDef)
    expect(screen.queryByText(/^×/)).not.toBeInTheDocument()
  })

  it('トグルボタンのクリックで onToggle が呼ばれる', async () => {
    const onToggle = vi.fn()
    renderHeader({ id: 'refactor', status: 'in_progress', events: [] }, repeatableDef, false, onToggle)
    await userEvent.click(screen.getByRole('button', { name: '履歴を開く' }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('expanded=true のときトグルの aria-label とアイコンが切り替わる', () => {
    renderHeader({ id: 'refactor', status: 'in_progress', events: [] }, repeatableDef, true)
    const toggle = screen.getByRole('button', { name: '履歴を閉じる' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('∧')
  })
})
