import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ActivityBar from '../ActivityBar'
import { activityBarPanels } from '../../config/activityBarPanels'

describe('ActivityBar', () => {
  const defaultProps = {
    activePanel: 'explorer' as const,
    sidebarOpen: true,
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

  it('各パネルボタンに aria-label が設定されている', () => {
    render(<ActivityBar {...defaultProps} />)
    activityBarPanels.forEach(({ title }) => {
      expect(screen.getByRole('button', { name: title })).toBeInTheDocument()
    })
  })

  it('アクティブなボタンの aria-pressed が true', () => {
    render(<ActivityBar {...defaultProps} />)
    const activeBtn = screen.getByTitle('エクスプローラー')
    expect(activeBtn).toHaveAttribute('aria-pressed', 'true')
  })

  it('非アクティブなボタンの aria-pressed が false', () => {
    render(<ActivityBar {...defaultProps} />)
    const inactiveBtn = screen.getByTitle('ソース管理')
    expect(inactiveBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('サイドバーが閉じている場合はアクティブパネルでも aria-pressed が false', () => {
    render(<ActivityBar {...defaultProps} sidebarOpen={false} />)
    const activeBtn = screen.getByTitle('エクスプローラー')
    expect(activeBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('全ボタンに type="button" が設定されている', () => {
    render(<ActivityBar {...defaultProps} />)
    const allButtons = screen.getAllByRole('button')
    allButtons.forEach((btn) => {
      expect(btn).toHaveAttribute('type', 'button')
    })
  })

  it('設定ボタンは disabled になっている（未実装プレースホルダー）', () => {
    render(<ActivityBar {...defaultProps} />)
    expect(screen.getByTitle('設定')).toBeDisabled()
  })

  it('ボタン内のSVGアイコンに aria-hidden が設定されている', () => {
    render(<ActivityBar {...defaultProps} />)
    const svgs = document.querySelectorAll('button svg')
    expect(svgs.length).toBeGreaterThan(0)
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
