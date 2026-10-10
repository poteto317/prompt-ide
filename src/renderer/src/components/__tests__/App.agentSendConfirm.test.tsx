import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgentWorkspaceState } from '../../__tests__/makeAgentWorkspaceState'
import { activityBarPanels } from '../../config/activityBarPanels'

const mockUseAgentWorkspace = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useAgentWorkspace', () => ({ useAgentWorkspace: mockUseAgentWorkspace }))

import App from '../../App'

const openSettingsPanel = async (): Promise<void> => {
  const config = activityBarPanels.find((p) => p.panel === 'settings')
  if (config === undefined) throw new Error('panel config not found: settings')
  await userEvent.click(screen.getByTitle(config.title))
}

describe('App: 送信前の確認の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.loadPrompts = vi.fn().mockResolvedValue([])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    mockUseAgentWorkspace.mockReturnValue(makeAgentWorkspaceState())
  })

  it('確認が閉じていればダイアログを出さない', () => {
    render(<App />)
    expect(screen.queryByRole('dialog', { name: '送信前の確認' })).toBeNull()
  })

  it('開いている確認をダイアログに描画し、送信・キャンセルを useAgentWorkspace の操作へ渡す', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({
        agentSendConfirmDialog: {
          pending: {
            text: '本文',
            slotId: 'slot-1',
            label: 'claude 1',
            promptId: 'p1',
            unsavedPaths: []
          },
          targetBlockedReason: null,
          onConfirm,
          onCancel
        }
      })
    )
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    expect(within(dialog).getByText('送り先: claude 1')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '送信' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('送り先の今の状態の理由をダイアログへ渡す', async () => {
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({
        agentSendConfirmDialog: {
          pending: {
            text: '本文',
            slotId: 'slot-1',
            label: 'claude 1',
            promptId: 'p1',
            unsavedPaths: []
          },
          targetBlockedReason:
            'エージェントが起動していません（ターミナルの「起動」を押してください）',
          onConfirm: vi.fn(),
          onCancel: vi.fn()
        }
      })
    )
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('エージェントが起動していません')
    expect(within(dialog).getByRole('button', { name: '送信' })).toBeDisabled()
  })
  // 通知の設定と型の形が同じため、App・Sidebar・SettingsPanel のどこかで取り違えても typecheck を通る。両方に違う値を与えて、
  // 送信前の確認の節が agentSendConfirmPanel の値を出し、変更をその onChange へ渡すことを確かめる
  it('送信前の確認の設定(値・保存の失敗・変更)を、通知の設定と取り違えずに設定パネルの節へ渡す', async () => {
    const onSendConfirmChange = vi.fn()
    const onNotificationChange = vi.fn()
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({
        agentNotificationPanel: { enabled: true, saveError: null, onChange: onNotificationChange },
        agentSendConfirmPanel: {
          enabled: false,
          saveError: '送信前の確認の設定を保存できませんでした',
          onChange: onSendConfirmChange
        }
      })
    )
    render(<App />)
    await openSettingsPanel()
    const checkbox = await screen.findByRole('checkbox', {
      name: 'エージェントへ送る前に、送る内容を確認する'
    })
    expect(checkbox).not.toBeChecked()
    const section = checkbox.closest('.settings-panel__section')
    if (!(section instanceof HTMLElement)) throw new Error('section not found')
    expect(within(section).getByRole('alert')).toHaveTextContent(
      '送信前の確認の設定を保存できませんでした'
    )
    await userEvent.click(checkbox)
    expect(onSendConfirmChange).toHaveBeenCalledWith(true)
    expect(onNotificationChange).not.toHaveBeenCalled()
  })

  // 上の逆向き。通知の節へ送信前の確認の値を渡し違えても(App・Sidebar・SettingsPanel のどこでも)typecheck を通るため確かめる
  it('通知の設定(値・保存の失敗・変更)を、送信前の確認の設定と取り違えずに設定パネルの節へ渡す', async () => {
    const onSendConfirmChange = vi.fn()
    const onNotificationChange = vi.fn()
    mockUseAgentWorkspace.mockReturnValue(
      makeAgentWorkspaceState({
        agentNotificationPanel: {
          enabled: false,
          saveError: '通知の設定を保存できませんでした',
          onChange: onNotificationChange
        },
        agentSendConfirmPanel: { enabled: true, saveError: null, onChange: onSendConfirmChange }
      })
    )
    render(<App />)
    await openSettingsPanel()
    const checkbox = await screen.findByRole('checkbox', {
      name: 'ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する'
    })
    expect(checkbox).not.toBeChecked()
    const section = checkbox.closest('.settings-panel__section')
    if (!(section instanceof HTMLElement)) throw new Error('section not found')
    expect(within(section).getByRole('alert')).toHaveTextContent('通知の設定を保存できませんでした')
    await userEvent.click(checkbox)
    expect(onNotificationChange).toHaveBeenCalledWith(true)
    expect(onSendConfirmChange).not.toHaveBeenCalled()
  })
})
