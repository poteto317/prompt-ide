import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { AgentChangesReviewAction } from '../../../types'
import type { AgentTerminalPanelState } from '../../../hooks/useAgentWorkspace'
import { makeFakeController } from '../../../__tests__/makeFakeAgentTerminal'
import type { FakeController } from '../../../__tests__/makeFakeAgentTerminal'
import {
  makeAgentSessionsState,
  makeAgentSessionTabView
} from '../../../__tests__/makeAgentSessionsState'
import type { AgentSessionTabView } from '../../../hooks/useAgentSessions'
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

// 選択中のタブ(帯の状態・起動・終了・エラーの対象)の上書き。controller は既定でテストの偽物
function makeSessions(
  selected: Partial<AgentSessionTabView> = {},
  rest: Parameters<typeof makeAgentSessionsState>[0] = {}
): AgentTerminalPanelState['sessions'] {
  return makeAgentSessionsState({ ...rest, selected: { controller, ...selected } })
}

function renderPanel(
  overrides: Partial<AgentTerminalPanelState> = {},
  review?: AgentChangesReviewAction
): AgentTerminalPanelState {
  const state: AgentTerminalPanelState = {
    sessions: makeSessions(),
    layout: makeLayout(),
    sendingSlotId: null,
    activities: new Map(),
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
      sessions: makeSessions({}, { startDisabledReason: 'フォルダを開いてください' })
    })
    const start = screen.getByRole('button', { name: /^起動/ })
    expect(start).toBeDisabled()
    expect(document.getElementById(start.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'フォルダを開いてください'
    )
  })

  it('起動を押すと選択中のタブの start を呼ぶ', async () => {
    const state = renderPanel({ sessions: makeSessions({ slotId: 'slot-2' }) })
    await userEvent.click(screen.getByRole('button', { name: /^起動/ }))
    expect(state.sessions.start).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  it('実行中は終了を出し、押すと確認なしで選択中のタブの stop を呼ぶ', async () => {
    const state = renderPanel({
      sessions: makeSessions({ slotId: 'slot-2', status: 'running' })
    })
    expect(screen.getByText('実行中')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^終了/ }))
    expect(state.sessions.stop).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  it('実行中の帯の状態は選択中のタブの活動の文言になる(unknown は従来の「実行中」)', () => {
    renderPanel({
      sessions: makeSessions({ slotId: 'slot-2', status: 'running' }),
      activities: new Map([['slot-2', 'confirm']])
    })
    expect(screen.getByText('確認待ち')).toBeInTheDocument()
    expect(screen.queryByText('実行中')).not.toBeInTheDocument()
  })

  it('実行中でないタブの帯は活動を無視する', () => {
    renderPanel({
      sessions: makeSessions({ slotId: 'slot-2', status: 'starting' }),
      activities: new Map([['slot-2', 'working']])
    })
    expect(screen.getByText('起動中')).toBeInTheDocument()
  })

  it('ターミナルには選択中のタブの controller を表示する', () => {
    const other = makeFakeController()
    renderPanel({ sessions: makeSessions({ controller: other }) })
    expect(other.attach).toHaveBeenCalled()
    expect(controller.attach).not.toHaveBeenCalled()
  })

  it('終了した後は終了コードを出し、起動を出す', () => {
    renderPanel({
      sessions: makeSessions({ status: 'exited', exit: { exitCode: 1, reason: 'exited' } })
    })
    expect(screen.getByText('終了しました（終了コード 1）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
  })

  it('起動の失敗を role="alert" で出す', () => {
    renderPanel({ sessions: makeSessions({ error: 'claude コマンドが見つかりません。' }) })
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

  describe('セッションのタブ列', () => {
    const twoTabs = (): AgentTerminalPanelState['sessions'] => {
      const a = makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', controller })
      const b = makeAgentSessionTabView({
        slotId: 'b',
        label: 'claude 2',
        controller: makeFakeController()
      })
      return makeAgentSessionsState({ tabs: [a, b], selected: a })
    }

    it('帯にタブ列が出て、+ で addTab を呼ぶ', async () => {
      const state = renderPanel({ sessions: twoTabs() })
      expect(screen.getByRole('tablist', { name: 'エージェントのセッション' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '新しいセッション' }))
      expect(state.sessions.addTab).toHaveBeenCalledTimes(1)
    })

    it('タブの aria-controls は本文を参照する', () => {
      renderPanel({ sessions: twoTabs() })
      const controls = screen.getAllByRole('tab')[0].getAttribute('aria-controls') ?? ''
      expect(document.getElementById(controls)).toHaveClass('agent-terminal-panel__body')
    })

    it('選択中のタブを × で閉じると、閉じた後に選択中になったタブへフォーカスが移る', async () => {
      const sessions = twoTabs()
      const [a, b] = sessions.tabs
      let current = sessions
      const { rerender } = render(
        <AgentTerminalPanel
          state={{
            sessions: current,
            layout: makeLayout(),
            sendingSlotId: null,
            activities: new Map()
          }}
        />
      )
      const rerenderWith = (next: typeof sessions): void => {
        current = next
        rerender(
          <AgentTerminalPanel
            state={{
              sessions: current,
              layout: makeLayout(),
              sendingSlotId: null,
              activities: new Map()
            }}
          />
        )
      }
      sessions.closeTab = vi.fn(async () => {
        rerenderWith(makeAgentSessionsState({ tabs: [b], selected: b }))
        return true
      })
      rerenderWith(sessions)
      await userEvent.click(screen.getByLabelText('claude 1 を閉じる'))
      expect(sessions.closeTab).toHaveBeenCalledWith(a.slotId)
      expect(await screen.findByRole('tab', { name: 'claude 2（未起動）' })).toHaveFocus()
    })

    it('閉じる前に、ターミナルにフォーカスがあれば開閉のボタンへ移す', async () => {
      const sessions = twoTabs()
      let focusAtClose: Element | null = null
      sessions.closeTab = vi.fn(async () => {
        focusAtClose = document.activeElement
        return false
      })
      renderPanel({ sessions })
      const view = document.querySelector('[data-agent-terminal]') as HTMLElement
      const inner = document.createElement('textarea')
      view.appendChild(inner)
      inner.focus()
      // userEvent.click は mousedown でフォーカスを × へ移すため、フォーカスを動かさない fireEvent で押す
      fireEvent.click(screen.getByLabelText('claude 1 を閉じる'))
      await waitFor(() => expect(sessions.closeTab).toHaveBeenCalled())
      expect(focusAtClose).toBe(
        screen.getByRole('button', { name: /^▾ エージェント|^エージェント/ })
      )
    })

    it('選択中でないタブの × を押して取りやめたら、選択中のタブへフォーカスを戻す', async () => {
      const sessions = twoTabs()
      sessions.closeTab = vi.fn(async () => false)
      renderPanel({ sessions })
      await userEvent.click(screen.getByLabelText('claude 2 を閉じる'))
      expect(screen.getByRole('tab', { name: 'claude 1（未起動）' })).toHaveFocus()
    })

    it('選択中のタブで Delete を押すと、そのタブを閉じる(閉じたら選択中のタブへフォーカス)', async () => {
      const sessions = twoTabs()
      const [a, b] = sessions.tabs
      const { rerender } = render(
        <AgentTerminalPanel
          state={{ sessions, layout: makeLayout(), sendingSlotId: null, activities: new Map() }}
        />
      )
      sessions.closeTab = vi.fn(async () => {
        rerender(
          <AgentTerminalPanel
            state={{
              sessions: makeAgentSessionsState({ tabs: [b], selected: b }),
              layout: makeLayout(),
              sendingSlotId: null,
              activities: new Map()
            }}
          />
        )
        return true
      })
      screen.getByRole('tab', { name: 'claude 1（未起動）' }).focus()
      await userEvent.keyboard('{Delete}')
      expect(sessions.closeTab).toHaveBeenCalledWith(a.slotId)
      expect(await screen.findByRole('tab', { name: 'claude 2（未起動）' })).toHaveFocus()
    })

    it('本文は tabpanel で、選択中のタブのボタンを aria-labelledby で参照する(閉じていても)', () => {
      renderPanel({ sessions: twoTabs(), layout: makeLayout({ isOpen: false }) })
      const body = document.querySelector('.agent-terminal-panel__body') as HTMLElement
      expect(body).toHaveAttribute('role', 'tabpanel')
      expect(body).toHaveAttribute('hidden')
      const label = document.getElementById(body.getAttribute('aria-labelledby') ?? '')
      expect(label).toBe(screen.getByRole('tab', { name: 'claude 1（未起動）' }))
    })

    it('選択中でないタブの × で closeTab が reject しても握り、選択中のタブへフォーカスを戻す', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const sessions = twoTabs()
      sessions.closeTab = vi.fn(async () => {
        throw new Error('失敗')
      })
      renderPanel({ sessions })
      await userEvent.click(screen.getByLabelText('claude 2 を閉じる'))
      await waitFor(() => expect(spy).toHaveBeenCalled())
      expect(screen.getByRole('tab', { name: 'claude 1（未起動）' })).toHaveFocus()
      spy.mockRestore()
    })

    it('選択中でないタブを閉じて消えたら、選択中のタブ(変わらない)へフォーカスが移る', async () => {
      const sessions = twoTabs()
      const [a, b] = sessions.tabs
      const { rerender } = render(
        <AgentTerminalPanel
          state={{ sessions, layout: makeLayout(), sendingSlotId: null, activities: new Map() }}
        />
      )
      sessions.closeTab = vi.fn(async () => {
        rerender(
          <AgentTerminalPanel
            state={{
              sessions: makeAgentSessionsState({ tabs: [a], selected: a }),
              layout: makeLayout(),
              sendingSlotId: null,
              activities: new Map()
            }}
          />
        )
        return true
      })
      await userEvent.click(screen.getByLabelText('claude 2 を閉じる'))
      expect(sessions.closeTab).toHaveBeenCalledWith(b.slotId)
      expect(await screen.findByRole('tab', { name: 'claude 1（未起動）' })).toHaveFocus()
    })

    it('選択中のタブが閉じる途中なら、終了・起動も × も押せない', () => {
      const a = makeAgentSessionTabView({ slotId: 'a', status: 'running', isClosing: true })
      const b = makeAgentSessionTabView({ slotId: 'b', label: 'claude 2' })
      renderPanel({ sessions: makeAgentSessionsState({ tabs: [a, b], selected: a }) })
      expect(screen.getByRole('button', { name: /^終了/ })).toBeDisabled()
      expect(screen.getByLabelText('claude 1 を閉じる')).toBeDisabled()
    })

    it('選択中のタブが閉じる途中で終了の通知が先に届いても(exited)、起動を押せない', () => {
      const a = makeAgentSessionTabView({ slotId: 'a', status: 'exited', isClosing: true })
      const b = makeAgentSessionTabView({ slotId: 'b', label: 'claude 2' })
      renderPanel({ sessions: makeAgentSessionsState({ tabs: [a, b], selected: a }) })
      expect(screen.getByRole('button', { name: /^起動/ })).toBeDisabled()
    })

    it('送信中のタブの × は押せない', () => {
      renderPanel({ sessions: twoTabs(), sendingSlotId: 'b' })
      expect(screen.getByLabelText('claude 2 を閉じる')).toBeDisabled()
    })

    it('タブを切り替えると、ターミナルの表示は選択中のタブの controller に変わる', () => {
      const sessions = twoTabs()
      const [a, b] = sessions.tabs
      const { rerender } = render(
        <AgentTerminalPanel
          state={{ sessions, layout: makeLayout(), sendingSlotId: null, activities: new Map() }}
        />
      )
      expect(a.controller.attach).toHaveBeenCalled()
      expect(b.controller.attach).not.toHaveBeenCalled()
      rerender(
        <AgentTerminalPanel
          state={{
            sessions: makeAgentSessionsState({ tabs: [a, b], selected: b }),
            layout: makeLayout(),
            sendingSlotId: null,
            activities: new Map()
          }}
        />
      )
      expect(a.controller.detach).toHaveBeenCalled()
      expect(b.controller.attach).toHaveBeenCalled()
    })

    it('2 つ目のタブを選ぶと、そのタブが aria-selected で、tabpanel もそのタブを指す', () => {
      const [a, b] = twoTabs().tabs
      renderPanel({ sessions: makeAgentSessionsState({ tabs: [a, b], selected: b }) })
      const second = screen.getByRole('tab', { name: 'claude 2（未起動）' })
      expect(second).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'claude 1（未起動）' })).toHaveAttribute(
        'aria-selected',
        'false'
      )
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', second.id)
    })
  })
})
