import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import AddPromptForm from '../AddPromptForm'

describe('AddPromptForm', () => {
  it('タイトル入力・コンテンツ入力・送信ボタンが存在する', () => {
    render(<AddPromptForm onAdd={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'タイトル' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'プロンプト内容' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument()
  })

  it('初期状態では送信ボタンが disabled', () => {
    render(<AddPromptForm onAdd={vi.fn()} />)
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('タイトルのみ入力しても送信ボタンが disabled', async () => {
    render(<AddPromptForm onAdd={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'タイトル')
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('コンテンツのみ入力しても送信ボタンが disabled', async () => {
    render(<AddPromptForm onAdd={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), '内容')
    expect(screen.getByRole('button', { name: '追加' })).toBeDisabled()
  })

  it('タイトルとコンテンツを入力すると送信ボタンが有効になる', async () => {
    render(<AddPromptForm onAdd={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'タイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), '内容')
    expect(screen.getByRole('button', { name: '追加' })).toBeEnabled()
  })

  it('フォーム送信で onAdd が正しい引数で呼ばれる', async () => {
    const onAdd = vi.fn()
    render(<AddPromptForm onAdd={onAdd} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'タイトル' }), 'マイタイトル')
    await userEvent.type(screen.getByRole('textbox', { name: 'プロンプト内容' }), 'マイコンテンツ')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onAdd).toHaveBeenCalledWith('マイタイトル', 'マイコンテンツ')
  })

  it('送信後にフォームがリセットされる', async () => {
    render(<AddPromptForm onAdd={vi.fn()} />)
    const titleInput = screen.getByRole('textbox', { name: 'タイトル' })
    const contentInput = screen.getByRole('textbox', { name: 'プロンプト内容' })
    await userEvent.type(titleInput, 'タイトル')
    await userEvent.type(contentInput, '内容')
    await userEvent.click(screen.getByRole('button', { name: '追加' }))
    expect(titleInput).toHaveValue('')
    expect(contentInput).toHaveValue('')
  })
})
