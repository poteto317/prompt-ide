import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import { activityBarPanels } from '../../config/activityBarPanels'

describe('ActivityBar', () => {
  const defaultProps = {
    activePanel: 'explorer' as const,
    onPanelChange: vi.fn(),
  }

  it('activityBarPanels の件数分ボタンが描画される', () => {
    render(<ActivityBar {...defaultProps} />)
    const panelButtons = activityBarPanels.map(({ title }) => screen.getByTitle(title))
    expect(panelButtons).toHaveLength(activityBarPanels.length)
  })

  it('activePanel に対応するボタンに active クラスが付く', () => {
    render(<ActivityBar {...defaultProps} />)
    const activeButton = screen.getByTitle('エクスプローラー')
    expect(activeButton).toHaveClass('active')
  })

  it('非アクティブなボタンには active クラスがない', () => {
    render(<ActivityBar {...defaultProps} />)
    const inactiveButton = screen.getByTitle('ソース管理')
    expect(inactiveButton).not.toHaveClass('active')
  })

  it('ボタンクリックで onPanelChange が正しい panel id で呼ばれる', async () => {
    const onPanelChange = vi.fn()
    render(<ActivityBar {...defaultProps} onPanelChange={onPanelChange} />)
    await userEvent.click(screen.getByTitle('ソース管理'))
    expect(onPanelChange).toHaveBeenCalledWith('source-control')
  })

  it('各パネルボタンに title 属性がある', () => {
    render(<ActivityBar {...defaultProps} />)
    activityBarPanels.forEach(({ title }) => {
      expect(screen.getByTitle(title)).toBeInTheDocument()
    })
  })

  it('Settings ボタンが常に描画される', () => {
    render(<ActivityBar {...defaultProps} />)
    expect(screen.getByTitle('設定')).toBeInTheDocument()
  })
})
