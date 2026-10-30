import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockUseAgentWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))

import App from '../../App'

const openPromptsPanel = async (): Promise<void> => {
  const config = activityBarPanels.find((p) => p.panel === 'prompts')
  if (config === undefined) throw new Error('panel config not found: prompts')
  await userEvent.click(screen.getByTitle(config.title))
}

describe('App: 一覧の編集モード / 表示モードの配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.loadPrompts = vi
      .fn()
      .mockResolvedValue([
        { id: 'p1', title: 'テストタイトル', content: 'テスト内容', createdAt: 1000000 }
      ])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getPromptListMode = vi.fn().mockResolvedValue('view')
    window.api.setPromptListMode = vi.fn().mockResolvedValue(undefined)
    mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())
  })

  it('保存されたモードをプロンプトパネルまで届け、トグルの切り替えを保存する', async () => {
    render(<App />)
    await openPromptsPanel()
    await screen.findByText('テストタイトル')
    const toggle = screen.getByRole('button', { name: '編集モード' })
    // 読み込みが終わるまでは押せない。終わったら保存されていた表示モード
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveTextContent('編集モード: オフ')
    expect(screen.queryByRole('button', { name: 'プロンプトを編集' })).not.toBeInTheDocument()

    await userEvent.click(toggle)

    expect(window.api.setPromptListMode).toHaveBeenCalledExactlyOnceWith('edit')
    expect(await screen.findByRole('button', { name: 'プロンプトを編集' })).toBeInTheDocument()
    expect(toggle).toHaveTextContent('編集モード: オン')
  })
})
