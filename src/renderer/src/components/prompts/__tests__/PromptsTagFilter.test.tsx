import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PromptsTagFilter from '../PromptsTagFilter'

describe('PromptsTagFilter', () => {
  it('tags が空のとき何も描画しない', () => {
    const { container } = render(
      <PromptsTagFilter tags={[]} selectedTags={[]} onToggle={vi.fn()} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('tags があるときフィルターバーが描画される', () => {
    render(<PromptsTagFilter tags={['React', 'Vue']} selectedTags={[]} onToggle={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'タグで絞り込み' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'React' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Vue' })).toBeInTheDocument()
  })

  it('未選択タグの aria-pressed は false', () => {
    render(<PromptsTagFilter tags={['React']} selectedTags={[]} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'React' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('選択中タグの aria-pressed は true', () => {
    render(<PromptsTagFilter tags={['React']} selectedTags={['React']} onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'React' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('選択中タグに --active クラスが付く', () => {
    render(
      <PromptsTagFilter tags={['React', 'Vue']} selectedTags={['React']} onToggle={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: 'React' })).toHaveClass(
      'prompts-panel__tag-chip--active'
    )
    expect(screen.getByRole('button', { name: 'Vue' })).not.toHaveClass(
      'prompts-panel__tag-chip--active'
    )
  })

  it('タグをクリックすると onToggle が呼ばれる', async () => {
    const onToggle = vi.fn()
    render(<PromptsTagFilter tags={['React']} selectedTags={[]} onToggle={onToggle} />)
    await userEvent.click(screen.getByRole('button', { name: 'React' }))
    expect(onToggle).toHaveBeenCalledWith('React')
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('複数タグを連続クリックするとそれぞれ onToggle が呼ばれる', async () => {
    const onToggle = vi.fn()
    render(
      <PromptsTagFilter tags={['React', 'Vue']} selectedTags={[]} onToggle={onToggle} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'React' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vue' }))
    expect(onToggle).toHaveBeenNthCalledWith(1, 'React')
    expect(onToggle).toHaveBeenNthCalledWith(2, 'Vue')
  })
})
