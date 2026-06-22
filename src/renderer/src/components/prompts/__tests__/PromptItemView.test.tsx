import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import type { Prompt } from '../../../types'
import { PREVIEW_MAX } from '../../../config/promptConfig'
import PromptItemView from '../PromptItemView'

const basePrompt: Prompt = {
  id: 'p1',
  title: 'テストタイトル',
  content: 'テストコンテンツ',
  createdAt: 1000000
}

const defaultProps = {
  prompt: basePrompt,
  isSortable: false,
  dragHandleProps: { attributes: {} as never, listeners: {} },
  isRunDisabled: false,
  onRun: vi.fn(),
  onEditStart: vi.fn(),
  onDelete: vi.fn(),
  onTogglePin: vi.fn()
}

describe('PromptItemView', () => {
  it('タイトルとプレビューが表示される', () => {
    render(<PromptItemView {...defaultProps} />)
    expect(screen.getByText('テストタイトル')).toBeInTheDocument()
    expect(screen.getByText('テストコンテンツ')).toBeInTheDocument()
  })

  it('長いコンテンツは省略表示される', () => {
    const longContent = 'あ'.repeat(PREVIEW_MAX + 1)
    render(<PromptItemView {...defaultProps} prompt={{ ...basePrompt, content: longContent }} />)
    expect(screen.getByText('あ'.repeat(PREVIEW_MAX) + '…')).toBeInTheDocument()
  })

  it('isSortable=true のときドラッグハンドルが表示される', () => {
    render(<PromptItemView {...defaultProps} isSortable />)
    expect(screen.getByRole('button', { name: '並び替え' })).toBeInTheDocument()
  })

  it('isSortable=false のときドラッグハンドルが表示されない', () => {
    render(<PromptItemView {...defaultProps} />)
    expect(screen.queryByRole('button', { name: '並び替え' })).not.toBeInTheDocument()
  })

  it('実行ボタンで onRun が呼ばれる', async () => {
    const onRun = vi.fn()
    render(<PromptItemView {...defaultProps} onRun={onRun} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを実行' }))
    expect(onRun).toHaveBeenCalledOnce()
  })

  it('isRunDisabled=true のとき実行ボタンが disabled', () => {
    render(<PromptItemView {...defaultProps} isRunDisabled />)
    expect(screen.getByRole('button', { name: 'プロンプトを実行' })).toBeDisabled()
  })

  it('編集ボタンで onEditStart が呼ばれる', async () => {
    const onEditStart = vi.fn()
    render(<PromptItemView {...defaultProps} onEditStart={onEditStart} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを編集' }))
    expect(onEditStart).toHaveBeenCalledOnce()
  })

  it('削除ボタンで onDelete が呼ばれる', async () => {
    const onDelete = vi.fn()
    render(<PromptItemView {...defaultProps} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: 'プロンプトを削除' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  describe('ピン留めボタン', () => {
    it('未ピンのとき aria-label が「ピン留め」で aria-pressed=false', () => {
      render(<PromptItemView {...defaultProps} prompt={{ ...basePrompt, pinned: false }} />)
      const btn = screen.getByRole('button', { name: 'ピン留め' })
      expect(btn).toHaveAttribute('aria-pressed', 'false')
    })

    it('pinned 未指定でも「ピン留め」ボタンが表示される', () => {
      render(<PromptItemView {...defaultProps} />)
      expect(screen.getByRole('button', { name: 'ピン留め' })).toBeInTheDocument()
    })

    it('ピン留め済みのとき aria-label が「ピン留めを解除」で aria-pressed=true', () => {
      render(<PromptItemView {...defaultProps} prompt={{ ...basePrompt, pinned: true }} />)
      const btn = screen.getByRole('button', { name: 'ピン留めを解除' })
      expect(btn).toHaveAttribute('aria-pressed', 'true')
    })

    it('クリックで onTogglePin が呼ばれる', async () => {
      const onTogglePin = vi.fn()
      render(<PromptItemView {...defaultProps} onTogglePin={onTogglePin} />)
      await userEvent.click(screen.getByRole('button', { name: 'ピン留め' }))
      expect(onTogglePin).toHaveBeenCalledOnce()
    })

    it('スタイリングフックのクラス（pin ボタン・title）が付与される（CSS 重なり回避の回帰ガード）', () => {
      const { container } = render(<PromptItemView {...defaultProps} />)
      // ピンボタンは常時表示・絶対配置。title 側で padding-right を効かせるため両クラスの存在を保証する
      expect(container.querySelector('.prompt-item__pin')).toBeInTheDocument()
      expect(container.querySelector('.prompt-item__title')).toBeInTheDocument()
    })
  })
})
