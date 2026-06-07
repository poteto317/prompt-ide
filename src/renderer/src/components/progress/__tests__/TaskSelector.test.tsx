import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TaskSelector from '../TaskSelector'
import { createTask } from '../../../lib/taskFactory'

describe('TaskSelector', () => {
  it('全タスクを option として表示する', () => {
    const a = createTask('タスクA')
    const b = createTask('タスクB')
    render(<TaskSelector tasks={[a, b]} selectedId={a.id} onSelect={vi.fn()} />)
    expect(screen.getByRole('option', { name: 'タスクA' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'タスクB' })).toBeInTheDocument()
  })

  it('selectedId が select の value に反映される', () => {
    const a = createTask('タスクA')
    const b = createTask('タスクB')
    render(<TaskSelector tasks={[a, b]} selectedId={b.id} onSelect={vi.fn()} />)
    expect(screen.getByLabelText('タスクを選択')).toHaveValue(b.id)
  })

  it('選択変更で onSelect が選択 id を伴って呼ばれる', async () => {
    const a = createTask('タスクA')
    const b = createTask('タスクB')
    const onSelect = vi.fn()
    render(<TaskSelector tasks={[a, b]} selectedId={a.id} onSelect={onSelect} />)
    await userEvent.selectOptions(screen.getByLabelText('タスクを選択'), b.id)
    expect(onSelect).toHaveBeenCalledWith(b.id)
  })

  it('selectedId が null の場合は先頭 option が選択される（ネイティブ挙動）', () => {
    const a = createTask('タスクA')
    const b = createTask('タスクB')
    render(<TaskSelector tasks={[a, b]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByLabelText('タスクを選択')).toHaveValue(a.id)
  })
})
