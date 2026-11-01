import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockUseAgentWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))

import App from '../../App'

describe('App: パネルの大きさの変更の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.loadPrompts = vi.fn().mockResolvedValue([])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getPanelLayout = vi
      .fn()
      .mockResolvedValue({ sidebarWidth: 240, terminalHeightPercent: 45 })
    window.api.setPanelLayout = vi.fn().mockResolvedValue(undefined)
    mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())
  })

  it('既定でサイドバーの幅の境界が 240 で出る', async () => {
    render(<App />)
    expect(await screen.findByRole('separator', { name: 'サイドバーの幅' })).toHaveAttribute(
      'aria-valuenow',
      '240'
    )
  })

  it('保存された幅をサイドバーへ反映する', async () => {
    window.api.getPanelLayout = vi
      .fn()
      .mockResolvedValue({ sidebarWidth: 320, terminalHeightPercent: 45 })
    const { container } = render(<App />)
    await waitFor(() =>
      expect((container.querySelector('.sidebar') as HTMLElement).style.width).toBe('320px')
    )
  })

  it('矢印キーで幅を変えて保存する', async () => {
    render(<App />)
    const handle = await screen.findByRole('separator', { name: 'サイドバーの幅' })
    await waitFor(() => expect(window.api.getPanelLayout).toHaveBeenCalled())
    handle.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(handle).toHaveAttribute('aria-valuenow', '256')
    expect(window.api.setPanelLayout).toHaveBeenCalledWith({
      sidebarWidth: 256,
      terminalHeightPercent: 45
    })
  })

  it('サイドバーを閉じると境界も消える', async () => {
    render(<App />)
    await screen.findByRole('separator', { name: 'サイドバーの幅' })
    // 開いているパネルのボタンをもう一度押して閉じる
    const config = activityBarPanels[0]
    await userEvent.click(screen.getByTitle(config.title))
    await waitFor(() =>
      expect(screen.queryByRole('separator', { name: 'サイドバーの幅' })).not.toBeInTheDocument()
    )
  })

  it('ポインタの位置からサイドバーの幅を求める', async () => {
    const { container } = render(<App />)
    const handle = await screen.findByRole('separator', { name: 'サイドバーの幅' })
    Element.prototype.setPointerCapture = vi.fn()
    const main = container.querySelector('.ide-main') as HTMLElement
    vi.spyOn(main, 'getBoundingClientRect').mockReturnValue({ left: 48 } as DOMRect)
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 288 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 368 })
    expect((container.querySelector('.sidebar') as HTMLElement).style.width).toBe('320px')
  })

  it('狭いウィンドウではサイドバーの上限をエディタの領域に合わせる', async () => {
    const original = window.innerWidth
    window.innerWidth = 700
    try {
      const { container } = render(<App />)
      const handle = await screen.findByRole('separator', { name: 'サイドバーの幅' })
      expect(handle).toHaveAttribute('aria-valuemax', '300')
      Element.prototype.setPointerCapture = vi.fn()
      fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 240 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 900 })
      expect((container.querySelector('.sidebar') as HTMLElement).style.width).toBe('300px')
    } finally {
      window.innerWidth = original
    }
  })

  it('ターミナルの高さを矢印キーで変えて保存する(サイドバーの幅は変えない)', async () => {
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({ bottomPanel: 'agent-terminal' })
    )
    render(<App />)
    const handle = await screen.findByRole('separator', { name: 'ターミナルの高さ' })
    await waitFor(() => expect(window.api.getPanelLayout).toHaveBeenCalled())
    handle.focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() =>
      expect(window.api.setPanelLayout).toHaveBeenCalledExactlyOnceWith({
        sidebarWidth: 240,
        terminalHeightPercent: 47
      })
    )
  })

  it('保存された高さをターミナルの境界まで届ける', async () => {
    window.api.getPanelLayout = vi
      .fn()
      .mockResolvedValue({ sidebarWidth: 240, terminalHeightPercent: 60 })
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({ bottomPanel: 'agent-terminal' })
    )
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('separator', { name: 'ターミナルの高さ' })).toHaveAttribute(
        'aria-valuenow',
        '60'
      )
    )
  })
})
