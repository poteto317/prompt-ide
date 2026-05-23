import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import PromptsPanel from '../PromptsPanel'

const defaultProps = {
  prompts: [] as Prompt[],
  onAdd: vi.fn(),
  onDelete: vi.fn(),
}

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'テストタイトル',
  content: 'テスト内容',
  createdAt: 1000000,
}

describe('PromptsPanel', () => {
  it('prompts が空のとき「プロンプトがありません」が表示される', () => {
    render(<PromptsPanel {...defaultProps} />)
    expect(screen.getByText('プロンプトがありません')).toBeInTheDocument()
  })

  it('prompts がある場合は空状態メッセージが表示されない', () => {
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
    expect(screen.queryByText('プロンプトがありません')).not.toBeInTheDocument()
  })

  it('prompts の title が表示される', () => {
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
  })

  it('AddPromptForm が常に表示される', () => {
    render(<PromptsPanel {...defaultProps} />)
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument()
  })

  it('削除ボタンクリックで onDelete が呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<PromptsPanel {...defaultProps} prompts={[samplePrompt]} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを削除' }))
    expect(onDelete).toHaveBeenCalledWith('p1')
  })
})
