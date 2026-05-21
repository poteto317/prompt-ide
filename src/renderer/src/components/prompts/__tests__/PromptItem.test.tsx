import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import { PREVIEW_MAX } from '../../../config/promptConfig'
import PromptItem from '../PromptItem'

const basePrompt: Prompt = {
  id: 'test-id-1',
  title: 'テストタイトル',
  content: 'テストコンテンツ',
  createdAt: 1000000,
}

describe('PromptItem', () => {
  it('タイトルが表示される', () => {
    render(<PromptItem prompt={basePrompt} onDelete={vi.fn()} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
  })

  it(`コンテンツが ${PREVIEW_MAX} 文字以内のとき全文表示される`, () => {
    render(<PromptItem prompt={basePrompt} onDelete={vi.fn()} />)
    expect(screen.getByText('テストコンテンツ')).toBeInTheDocument()
  })

  it(`コンテンツが ${PREVIEW_MAX} 文字を超えるとき省略表示される`, () => {
    const longContent = 'あ'.repeat(PREVIEW_MAX + 1)
    render(
      <PromptItem prompt={{ ...basePrompt, content: longContent }} onDelete={vi.fn()} />
    )
    expect(screen.getByText('あ'.repeat(PREVIEW_MAX) + '…')).toBeInTheDocument()
  })

  it('削除ボタンが存在する', () => {
    render(<PromptItem prompt={basePrompt} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'プロンプトを削除' })).toBeInTheDocument()
  })

  it('削除ボタンクリックで onDelete が prompt.id を引数に呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<PromptItem prompt={basePrompt} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを削除' }))
    expect(onDelete).toHaveBeenCalledOnce()
    expect(onDelete).toHaveBeenCalledWith('test-id-1')
  })
})
