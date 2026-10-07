import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { AgentChangesReviewAction } from '../../../types'
import type { AgentTerminalPanelState } from '../../../hooks/useAgentWorkspace'
import { makeFakeController } from '../../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../../__tests__/makeFakeAgentTerminal'
import { makeAgentSessionState } from '../../../__tests__/makeAgentSessionState'
import type { AgentTerminalPanelLayout } from '../../../hooks/useAgentTerminalPanel'

let controller: FakeController

function makeLayout(overrides: Partial<AgentTerminalPanelLayout> = {}): AgentTerminalPanelLayout {
  return {
    isOpen: true,
    isMaximized: false,
    open: vi.fn(),
    toggleOpen: vi.fn(),
    toggleMaximized: vi.fn(),
    ...overrides
  }
}

function renderPanel(
  overrides: Partial<AgentTerminalPanelState> = {},
  review?: AgentChangesReviewAction
): AgentTerminalPanelState {
  const state: AgentTerminalPanelState = {
    controller,
    session: makeAgentSessionState(),
    layout: makeLayout(),
    ...overrides
  }
  render(<AgentTerminalPanel state={state} review={review} />)
  return state
}

beforeEach(() => {
  controller = makeFakeController()
})

describe('AgentTerminalPanel', () => {
  it('見出し・状態(未起動)・起動・最大化を出し、開閉のボタンが本文を参照する', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /エージェント/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(body).not.toBeNull()
    expect(screen.getByText('未起動')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: '最大化' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('開閉のボタンは F6 の案内を aria-describedby で参照する', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /エージェント/ })
    expect(
      document.getElementById(toggle.getAttribute('aria-describedby') ?? '')
    ).toHaveTextContent('F6 でターミナルから抜けます')
  })

  it('フォルダが無ければ起動を押せず、理由を出して参照する', () => {
    renderPanel({
      session: makeAgentSessionState({ startDisabledReason: 'フォルダを開いてください' })
    })
    const start = screen.getByRole('button', { name: /^起動/ })
    expect(start).toBeDisabled()
    expect(document.getElementById(start.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'フォルダを開いてください'
    )
  })

  it('起動を押すと start を呼ぶ', async () => {
    const state = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /^起動/ }))
    expect(state.session.start).toHaveBeenCalledOnce()
  })

  it('起動中は終了を出し、押すと確認なしで stop を呼ぶ', async () => {
    const state = renderPanel({
      session: makeAgentSessionState({ status: 'running', sessionId: 's1' })
    })
    expect(screen.getByText('起動中')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^終了/ }))
    expect(state.session.stop).toHaveBeenCalledOnce()
  })

  it('終了した後は終了コードを出し、起動を出す', () => {
    renderPanel({
      session: makeAgentSessionState({ status: 'exited', exit: { exitCode: 1, reason: 'exited' } })
    })
    expect(screen.getByText('終了しました（終了コード 1）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
  })

  it('起動の失敗を role="alert" で出す', () => {
    renderPanel({ session: makeAgentSessionState({ error: 'claude コマンドが見つかりません。' }) })
    expect(screen.getByRole('alert')).toHaveTextContent('claude コマンドが見つかりません。')
  })

  it('閉じているときは本文を隠す(xterm は取り外さない)', () => {
    renderPanel({ layout: makeLayout({ isOpen: false }) })
    const toggle = screen.getByRole('button', { name: /エージェント/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeVisible()
    expect(controller.detach).not.toHaveBeenCalled()
  })

  // 実際のクリック(user-event)は Chromium と同じく mousedown で押したボタンにフォーカスを移す
  it('ターミナルにフォーカスがあるときに閉じると、フォーカスは開閉のボタンにあり、ターミナルの中に残らない', async () => {
    const state = renderPanel()
    const terminalArea = screen.getByRole('group', { name: 'エージェントのターミナル' })
    const inner = document.createElement('textarea')
    terminalArea.appendChild(inner)
    inner.focus()
    await userEvent.click(screen.getByRole('button', { name: /エージェント/ }))
    expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
    expect(terminalArea).not.toContainElement(document.activeElement as HTMLElement)
    expect(state.layout.toggleOpen).toHaveBeenCalledOnce()
  })

  it('最大化を元に戻すと、フォーカスは押したボタンに残り、ターミナルの中には残らない', async () => {
    const state = renderPanel({ layout: makeLayout({ isMaximized: true }) })
    const terminalArea = screen.getByRole('group', { name: 'エージェントのターミナル' })
    const inner = document.createElement('textarea')
    terminalArea.appendChild(inner)
    inner.focus()
    const restore = screen.getByRole('button', { name: '元に戻す' })
    await userEvent.click(restore)
    expect(restore).toHaveFocus()
    expect(screen.getByRole('button', { name: /エージェント/ })).not.toHaveFocus()
    expect(terminalArea).not.toContainElement(document.activeElement as HTMLElement)
    expect(state.layout.toggleMaximized).toHaveBeenCalledOnce()
  })

  it('F6 の抜け先として、開閉のボタンへフォーカスを移す関数を controller に渡す', () => {
    renderPanel()
    const handler = controller.setFocusOutHandler.mock.calls.at(-1)?.[0]
    handler?.()
    expect(screen.getByRole('button', { name: /エージェント/ })).toHaveFocus()
  })
})

describe('AgentTerminalPanel — 変更を確認', () => {
  const REVIEW = 'エージェントの変更を確認（ソース管理を開く）'

  it.each([
    ['渡されない', undefined],
    ['記録が無い', { isRecording: false, onReview: vi.fn() }]
  ])('%s ときは出さない', (_label, review) => {
    renderPanel({}, review)
    expect(screen.queryByRole('button', { name: REVIEW })).toBeNull()
  })

  it('記録がある間だけ最大化の前に出し、押すと確認へ移る', async () => {
    const onReview = vi.fn()
    renderPanel({}, { isRecording: true, onReview })
    const button = screen.getByRole('button', { name: REVIEW })
    expect(button).toHaveTextContent('変更を確認')
    expect(button.compareDocumentPosition(screen.getByRole('button', { name: '最大化' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    await userEvent.click(button)
    expect(onReview).toHaveBeenCalledOnce()
  })

  it('最大化の間に押したら、最大化を元に戻してから移る', async () => {
    const order: string[] = []
    const layout = makeLayout({
      isMaximized: true,
      toggleMaximized: vi.fn(() => void order.push('restore'))
    })
    renderPanel({ layout }, { isRecording: true, onReview: () => void order.push('review') })
    await userEvent.click(screen.getByRole('button', { name: REVIEW }))
    expect(order).toEqual(['restore', 'review'])
  })
})
