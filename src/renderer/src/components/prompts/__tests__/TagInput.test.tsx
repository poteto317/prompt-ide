import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TagInput from '../TagInput'

const defaultProps = {
  tags: [] as string[],
  tagInput: '',
  onTagInputChange: vi.fn(),
  onTagInputKeyDown: vi.fn(),
  onRemoveTag: vi.fn(),
}

describe('TagInput', () => {
  it('コンテナが role="group" aria-label="タグ" を持つ', () => {
    render(<TagInput {...defaultProps} />)
    expect(screen.getByRole('group', { name: 'タグ' })).toBeInTheDocument()
  })

  it('タグ入力欄が表示される', () => {
    render(<TagInput {...defaultProps} />)
    expect(
      screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
    ).toBeInTheDocument()
  })

  it('入力欄に渡された tagInput 値が表示される', () => {
    render(<TagInput {...defaultProps} tagInput="Vue" />)
    expect(
      screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' })
    ).toHaveValue('Vue')
  })

  it('タグが表示される', () => {
    render(<TagInput {...defaultProps} tags={['React', 'TypeScript']} />)
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
  })

  it('タグなしのとき削除ボタンが表示されない', () => {
    render(<TagInput {...defaultProps} tags={[]} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('各タグに削除ボタンが表示される', () => {
    render(<TagInput {...defaultProps} tags={['React', 'TypeScript']} />)
    expect(screen.getByRole('button', { name: 'タグ「React」を削除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'タグ「TypeScript」を削除' })).toBeInTheDocument()
  })

  it('削除ボタンをクリックすると onRemoveTag が呼ばれる', async () => {
    const onRemoveTag = vi.fn()
    render(<TagInput {...defaultProps} tags={['React']} onRemoveTag={onRemoveTag} />)
    await userEvent.click(screen.getByRole('button', { name: 'タグ「React」を削除' }))
    expect(onRemoveTag).toHaveBeenCalledWith('React')
    expect(onRemoveTag).toHaveBeenCalledOnce()
  })

  it('入力変更で onTagInputChange が呼ばれる', async () => {
    const onTagInputChange = vi.fn()
    render(<TagInput {...defaultProps} onTagInputChange={onTagInputChange} />)
    await userEvent.type(
      screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' }),
      'R'
    )
    expect(onTagInputChange).toHaveBeenCalled()
  })

  it('Enter キーで onTagInputKeyDown が呼ばれる', async () => {
    const onTagInputKeyDown = vi.fn()
    render(<TagInput {...defaultProps} onTagInputKeyDown={onTagInputKeyDown} />)
    await userEvent.type(
      screen.getByRole('textbox', { name: '新しいタグを入力（Enter で確定）' }),
      '{Enter}'
    )
    expect(onTagInputKeyDown).toHaveBeenCalled()
  })
})
