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

  it('編集して保存すると onSubmit が trim 済みの値とタグで呼ばれる', async () => {
    const onSubmit = vi.fn()
    render(<PromptEditForm {...defaultProps} onSubmit={onSubmit} />)
    const title = screen.getByRole('textbox', { name: 'タイトルを編集' })
    await userEvent.clear(title)
    await userEvent.type(title, '  新題  ')
    await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
    expect(onSubmit).toHaveBeenCalledWith('新題', '元コンテンツ', [])
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

  describe('タグ入力', () => {
    it('タグ入力欄が表示される', () => {
      render(<PromptEditForm {...defaultProps} />)
      expect(
        screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
      ).toBeInTheDocument()
    })

    it('Enter でタグを追加できる', async () => {
      const onSubmit = vi.fn()
      render(<PromptEditForm {...defaultProps} onSubmit={onSubmit} />)
      const tagInput = screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
      await userEvent.type(tagInput, 'React{Enter}')
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(onSubmit).toHaveBeenCalledWith('元タイトル', '元コンテンツ', ['React'])
    })

    it('重複タグは追加されない', async () => {
      const onSubmit = vi.fn()
      render(<PromptEditForm {...defaultProps} onSubmit={onSubmit} />)
      const tagInput = screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
      await userEvent.type(tagInput, 'React{Enter}')
      await userEvent.type(tagInput, 'React{Enter}')
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(onSubmit).toHaveBeenCalledWith('元タイトル', '元コンテンツ', ['React'])
    })

    it('空文字のタグは追加されない', async () => {
      const onSubmit = vi.fn()
      render(<PromptEditForm {...defaultProps} onSubmit={onSubmit} />)
      const tagInput = screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
      await userEvent.type(tagInput, '   {Enter}')
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(onSubmit).toHaveBeenCalledWith('元タイトル', '元コンテンツ', [])
    })

    it('× ボタンでタグを削除できる', async () => {
      const onSubmit = vi.fn()
      const prompt: Prompt = { ...basePrompt, tags: ['React', 'TypeScript'] }
      render(<PromptEditForm prompt={prompt} onSubmit={onSubmit} onCancel={vi.fn()} />)
      await userEvent.click(screen.getByRole('button', { name: 'タグ「React」を削除' }))
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(onSubmit).toHaveBeenCalledWith('元タイトル', '元コンテンツ', ['TypeScript'])
    })

    it('prompt に既存タグがあるとき表示される', () => {
      const prompt: Prompt = { ...basePrompt, tags: ['React', 'TypeScript'] }
      render(<PromptEditForm prompt={prompt} onSubmit={vi.fn()} onCancel={vi.fn()} />)
      expect(screen.getByText('React')).toBeInTheDocument()
      expect(screen.getByText('TypeScript')).toBeInTheDocument()
    })

    it('複数タグを追加して保存すると全て onSubmit に渡される', async () => {
      const onSubmit = vi.fn()
      render(<PromptEditForm {...defaultProps} onSubmit={onSubmit} />)
      const tagInput = screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
      await userEvent.type(tagInput, 'React{Enter}')
      await userEvent.type(tagInput, 'TypeScript{Enter}')
      await userEvent.click(screen.getByRole('button', { name: '変更を保存' }))
      expect(onSubmit).toHaveBeenCalledWith('元タイトル', '元コンテンツ', ['React', 'TypeScript'])
    })
  })
})
