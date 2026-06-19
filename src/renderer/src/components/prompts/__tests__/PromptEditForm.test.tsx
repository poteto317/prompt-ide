import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import PromptEditForm from '../PromptEditForm'

const basePrompt: Prompt = {
  id: 'p1',
  title: '元タイトル',
  content: '元コンテンツ',
  createdAt: 1000000
}

const defaultProps = {
  prompt: basePrompt,
  onSubmit: vi.fn(),
  onCancel: vi.fn()
}

describe('PromptEditForm', () => {
  it('対象 prompt の値が入力欄に表示される', () => {
    render(<PromptEditForm {...defaultProps} />)
    expect(screen.getByRole('textbox', { name: 'タイトルを編集' })).toHaveValue('元タイトル')
    expect(screen.getByRole('textbox', { name: '内容を編集' })).toHaveValue('元コンテンツ')
  })

  it('編集して保存すると onSubmit が trim 済みの値で呼ばれる', async () => {
    const onSubmit = vi.fn()
    render(<PromptEditForm {...defaultProps} onSubmit={onSubmit} />)
    const title = screen.getByRole('textbox', { name: 'タイトルを編集' })
    await userEvent.clear(title)
    await userEvent.type(title, '  新題  ')
    await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    expect(onSubmit).toHaveBeenCalledWith('新題', '元コンテンツ')
  })

  it('タイトルを空にすると保存ボタンが disabled になる', async () => {
    render(<PromptEditForm {...defaultProps} />)
    await userEvent.clear(screen.getByRole('textbox', { name: 'タイトルを編集' }))
    expect(screen.getByRole('button', { name: '変更を保存' })).toBeDisabled()
  })

  it('キャンセルで onCancel が呼ばれる', async () => {
    const onCancel = vi.fn()
    render(<PromptEditForm {...defaultProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: '編集をキャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
