import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AddTaskForm from '../AddTaskForm'

describe('AddTaskForm', () => {
  it('タスク名入力欄が表示される', () => {
    render(<AddTaskForm onAdd={vi.fn()} />)
    expect(screen.getByLabelText('タスク名')).toBeInTheDocument()
  })

  it('初期状態でボタンが disabled', () => {
    render(<AddTaskForm onAdd={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'タスクを追加' })).toBeDisabled()
  })

  it('文字を入力するとボタンが enabled になる', async () => {
    render(<AddTaskForm onAdd={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('タスク名'), 'タスク')
    expect(screen.getByRole('button', { name: 'タスクを追加' })).toBeEnabled()
  })

  it('空白のみでは disabled のまま', async () => {
    render(<AddTaskForm onAdd={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('タスク名'), '   ')
    expect(screen.getByRole('button', { name: 'タスクを追加' })).toBeDisabled()
  })

  it('タスク名を入力してボタンをクリックすると onAdd が trim 値で呼ばれる', async () => {
    const onAdd = vi.fn()
    render(<AddTaskForm onAdd={onAdd} />)
    await userEvent.type(screen.getByLabelText('タスク名'), '  新タスク  ')
    await userEvent.click(screen.getByRole('button', { name: 'タスクを追加' }))
    expect(onAdd).toHaveBeenCalledWith('新タスク')
  })

  it('Enter キーでフォーム送信できる', async () => {
    const onAdd = vi.fn()
    render(<AddTaskForm onAdd={onAdd} />)
    await userEvent.type(screen.getByLabelText('タスク名'), 'キーボード入力{Enter}')
    expect(onAdd).toHaveBeenCalledWith('キーボード入力')
  })

  it('送信後に入力欄がクリアされる', async () => {
    render(<AddTaskForm onAdd={vi.fn()} />)
    const input = screen.getByLabelText('タスク名')
    await userEvent.type(input, 'タスク')
    await userEvent.click(screen.getByRole('button', { name: 'タスクを追加' }))
    expect(input).toHaveValue('')
  })

  it('送信後にボタンが再び disabled に戻る', async () => {
    render(<AddTaskForm onAdd={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('タスク名'), 'タスク')
    await userEvent.click(screen.getByRole('button', { name: 'タスクを追加' }))
    expect(screen.getByRole('button', { name: 'タスクを追加' })).toBeDisabled()
  })

  it('空欄のままボタンをクリックしても onAdd が呼ばれない', async () => {
    const onAdd = vi.fn()
    render(<AddTaskForm onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: 'タスクを追加' }))
    expect(onAdd).not.toHaveBeenCalled()
  })
})
