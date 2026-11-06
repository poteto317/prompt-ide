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
import {
  makeAgentInterruptPanelState,
  makeAgentPermissionAnswerPanelState,
  makeAgentTerminalPanelLayout,
  makeAgentTerminalPanelState
} from '../../../__tests__/makeAgentTerminalPanelState'
import type { AgentInterruptPanelState } from '../../../hooks/useAgentInterrupt'
import type { AgentPermissionAnswerPanelState } from '../../../hooks/useAgentPermissionAnswer'
import { toAnnouncementText } from '../../../lib/announcementText'

let controller: FakeController

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
  const state = makeAgentTerminalPanelState({ sessions: makeSessions(), ...overrides })
  render(<AgentTerminalPanel state={state} review={review} />)
  return state
}

const size = { heightPercent: 60, onChange: vi.fn(), onCommit: vi.fn() }
const renderSized = (layout = makeAgentTerminalPanelLayout()): void => {
  const state = makeAgentTerminalPanelState({ sessions: makeSessions(), layout })
  render(<AgentTerminalPanel state={state} terminalSize={size} />)
}

beforeEach(() => {
  controller = makeFakeController()
  size.onChange.mockClear()
  size.onCommit.mockClear()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

describe('AgentTerminalPanel: 高さの境界', () => {
  it('境界は横向きで、小数の高さは丸めて伝える', () => {
    size.heightPercent = 60.4
    renderSized()
    const handle = screen.getByRole('separator')
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveAttribute('aria-valuenow', '60')
    size.heightPercent = 60
  })

  it('terminalSize が無ければ境界も高さの指定も出さない', () => {
    renderPanel()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    expect(
      screen
        .getByRole('region', { name: 'エージェント' })
        .style.getPropertyValue('--agent-terminal-height')
    ).toBe('')
  })

  it('開いている間だけ高さの境界を出し、高さを section へ渡す', () => {
    renderSized()
    expect(screen.getByRole('separator', { name: 'ターミナルの高さ' })).toHaveAttribute(
      'aria-valuenow',
      '60'
    )
    expect(
      screen
        .getByRole('region', { name: 'エージェント' })
        .style.getPropertyValue('--agent-terminal-height')
    ).toBe('60%')
  })

  it.each([
    ['閉じている', { isOpen: false }],
    ['最大化', { isMaximized: true }]
  ])('%s 間は境界を出さない', (_label, overrides) => {
    renderSized(makeAgentTerminalPanelLayout(overrides))
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('ポインタの位置をエディタの領域に対する % へ変える', () => {
    renderSized()
    const section = screen.getByRole('region', { name: 'エージェント' })
    vi.spyOn(section.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      bottom: 500,
      height: 400,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 100,
      toJSON: () => ({})
    })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 300 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 })
    expect(size.onChange).toHaveBeenLastCalledWith(75)
  })

  it('エディタの領域が低いと、パネルの最小の高さに合わせて下限を上げる', () => {
    renderSized()
    const section = screen.getByRole('region', { name: 'エージェント' })
    vi.spyOn(section.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 800,
      height: 800,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 790 })
    expect(size.onChange).toHaveBeenLastCalledWith(20)
  })

  it('エディタの領域の高さが 0 なら今の値のまま', () => {
    renderSized()
    const section = screen.getByRole('region', { name: 'エージェント' })
    vi.spyOn(section.parentElement as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 })
    expect(size.onChange).not.toHaveBeenCalled()
  })
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

  it('起動の名前は設定の種類のコマンド名(appCliKind)', () => {
    render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({ sessions: makeSessions(), appCliKind: 'copilot' })}
      />
    )
    expect(
      screen.getByRole('button', { name: '起動（開いているフォルダで copilot を起動）' })
    ).toBeEnabled()
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
    expect(start).toHaveAccessibleDescription('フォルダを開いてください')
  })

  it('起動を押すと選択中のタブを新しいセッション(new)で start する', async () => {
    const state = renderPanel({ sessions: makeSessions({ slotId: 'slot-2' }) })
    await userEvent.click(screen.getByRole('button', { name: /^起動/ }))
    expect(state.sessions.start).toHaveBeenCalledExactlyOnceWith('slot-2', { kind: 'new' })
  })

  // 終了・前回の続きから・+ とそろえ、ダブルクリックの 2 回目で start を重ねない
  it('起動: キーボードのクリック(detail: 0)では start を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const state = renderPanel({ sessions: makeSessions({ slotId: 'slot-2' }) })
    const start = screen.getByRole('button', { name: /^起動/ })
    fireEvent.click(start, { detail: 0 })
    fireEvent.click(start, { detail: 2 })
    expect(state.sessions.start).toHaveBeenCalledExactlyOnceWith('slot-2', { kind: 'new' })
  })

  it('実行中は終了を出し、押すと確認なしで選択中のタブの stop を呼ぶ', async () => {
    const state = renderPanel({
      sessions: makeSessions({ slotId: 'slot-2', status: 'running' })
    })
    expect(screen.getByText('実行中')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^終了/ }))
    expect(state.sessions.stop).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  // 許可・拒否 をダブルクリックすると、ボタンが消えて詰まった帯の 終了 に 2 回目が届きうる(狭い幅で帯がはみ出すとき)。確認なしで会話を失わない
  it('終了: キーボードのクリック(detail: 0)では stop を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const state = renderPanel({
      sessions: makeSessions({ slotId: 'slot-2', status: 'running' })
    })
    const stop = screen.getByRole('button', { name: /^終了/ })
    fireEvent.click(stop, { detail: 0 })
    fireEvent.click(stop, { detail: 2 })
    expect(state.sessions.stop).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  // 許可・拒否 で長押しした Enter の残りのリピートは、ボタンが消えた後の移し先の開閉のボタンに届く(Chromium はリピートごとに click を合成する。L-408)
  it('開閉のボタン: Enter・Space のキーリピートの keydown は既定の動作を止め、単発の打鍵と他のキーは止めない', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: 'エージェント' })
    expect(fireEvent.keyDown(toggle, { key: 'Enter', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(toggle, { key: ' ', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(toggle, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(toggle, { key: ' ' })).toBe(true)
    expect(fireEvent.keyDown(toggle, { key: 'a', repeat: true })).toBe(true)
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

  it.each([
    { isOpen: true, direction: 'down' },
    { isOpen: false, direction: 'right' }
  ])('開閉の矢印の向き(isOpen: $isOpen → $direction)', ({ isOpen, direction }) => {
    renderPanel({ layout: makeAgentTerminalPanelLayout({ isOpen }) })
    const toggle = screen.getByRole('button', { name: /^エージェント$/ })
    expect(toggle.querySelector('svg')).toHaveAttribute('data-direction', direction)
  })

  it('閉じているときは本文を隠す(xterm は取り外さない)', () => {
    renderPanel({ layout: makeAgentTerminalPanelLayout({ isOpen: false }) })
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
    const state = renderPanel({ layout: makeAgentTerminalPanelLayout({ isMaximized: true }) })
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
    // 省略されても全文が分かるよう子に title を付ける(ボタンに付けると説明として重ねて読まれる)
    expect(button).not.toHaveAttribute('title')
    expect(button.querySelector('[title]')).toHaveAttribute('title', '変更を確認')
    expect(button.compareDocumentPosition(screen.getByRole('button', { name: '最大化' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    await userEvent.click(button)
    expect(onReview).toHaveBeenCalledOnce()
  })

  it('最大化の間に押したら、最大化を元に戻してから移る', async () => {
    const order: string[] = []
    const layout = makeAgentTerminalPanelLayout({
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

    // タブ 1 つで + を押すと、描き直しの後に + のあった位置へ claude 1 の × が出る(ダブルクリックの 2 回目で止まっている claude 1 を確認なしに閉じない)
    it('タブ 1 つで + を押し、描き直しの後の × にダブルクリックの 2 回目(detail: 2)が届いても closeTab を呼ばない', () => {
      const a = makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', controller })
      const sessions = makeAgentSessionsState({ tabs: [a], selected: a })
      const { rerender } = render(
        <AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions })} />
      )
      const b = makeAgentSessionTabView({
        slotId: 'b',
        label: 'claude 2',
        controller: makeFakeController()
      })
      const added = makeAgentSessionsState({ tabs: [a, b], selected: b })
      added.closeTab = vi.fn(async () => true)
      sessions.addTab = vi.fn(async () => {
        rerender(<AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions: added })} />)
      })
      rerender(<AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions })} />)
      fireEvent.click(screen.getByRole('button', { name: '新しいセッション' }), { detail: 1 })
      expect(sessions.addTab).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByLabelText('claude 1 を閉じる'), { detail: 2 })
      expect(added.closeTab).not.toHaveBeenCalled()
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
        <AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions: current })} />
      )
      const rerenderWith = (next: typeof sessions): void => {
        current = next
        rerender(<AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions: current })} />)
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
      expect(focusAtClose).toBe(screen.getByRole('button', { name: /^エージェント/ }))
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
        <AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions: sessions })} />
      )
      sessions.closeTab = vi.fn(async () => {
        rerender(
          <AgentTerminalPanel
            state={makeAgentTerminalPanelState({
              sessions: makeAgentSessionsState({ tabs: [b], selected: b })
            })}
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
      renderPanel({ sessions: twoTabs(), layout: makeAgentTerminalPanelLayout({ isOpen: false }) })
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
        <AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions: sessions })} />
      )
      sessions.closeTab = vi.fn(async () => {
        rerender(
          <AgentTerminalPanel
            state={makeAgentTerminalPanelState({
              sessions: makeAgentSessionsState({ tabs: [a], selected: a })
            })}
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
        <AgentTerminalPanel state={makeAgentTerminalPanelState({ sessions: sessions })} />
      )
      expect(a.controller.attach).toHaveBeenCalled()
      expect(b.controller.attach).not.toHaveBeenCalled()
      rerender(
        <AgentTerminalPanel
          state={makeAgentTerminalPanelState({
            sessions: makeAgentSessionsState({ tabs: [a, b], selected: b })
          })}
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

describe('AgentTerminalPanel: 前回の続きから', () => {
  const RESUME_LABEL = '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'

  it('名前は設定の種類のコマンド名(appCliKind)で作る', () => {
    render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({ sessions: makeSessions(), appCliKind: 'copilot' })}
      />
    )
    expect(
      screen.getByRole('button', {
        name: '前回の続きから（このフォルダで最後に起動した copilot のセッションを再開）'
      })
    ).toBeInTheDocument()
  })

  it('動いていないタブで 起動 の隣に出し、押すと選択中のタブで onResume を呼ぶ', async () => {
    const state = renderPanel({ sessions: makeSessions({ slotId: 'slot-2', status: 'exited' }) })
    const button = screen.getByRole('button', { name: RESUME_LABEL })
    expect(button).toHaveTextContent('前回の続きから')
    await userEvent.click(button)
    expect(state.resumeLast.onResume).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  // 帯のボタンは右寄せ。止まると 終了 が 起動 に替わり、その右に 前回の続きから が足されるので、終了 のあった位置に 前回の続きから が出る。
  // 終了 のダブルクリックの 2 回目がここに届いて、止めたばかりのセッションを再開しない
  it('前回の続きから: キーボードのクリック(detail: 0)では onResume を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const state = renderPanel({ sessions: makeSessions({ slotId: 'slot-2', status: 'exited' }) })
    const button = screen.getByRole('button', { name: RESUME_LABEL })
    fireEvent.click(button, { detail: 0 })
    fireEvent.click(button, { detail: 2 })
    expect(state.resumeLast.onResume).toHaveBeenCalledExactlyOnceWith('slot-2')
  })

  it.each([
    ['押せるとき', {}],
    ['閉じる途中で押せないとき', { isClosing: true }]
  ] as const)(
    '%s(理由が無い)も、ラベルの文字にマウスを載せると全文が出る。ボタンの説明は増やさない(名前の後に重ねて読まれないように)',
    (_, selected) => {
      renderPanel({ sessions: makeSessions({ status: 'exited', ...selected }) })
      const button = screen.getByRole('button', { name: RESUME_LABEL })
      expect(button).toHaveAccessibleDescription('')
      expect(button).not.toHaveAttribute('title')
      // ツールチップはラベルを包む要素に出す(子の title はボタンの説明にならない)
      const label = button.querySelector('[title]')
      expect(label).toHaveAttribute('title', '前回の続きから')
      expect(label).toHaveTextContent('前回の続きから')
    }
  )

  it('押せない理由があるときは、ボタンの title に理由を出し、ラベルの要素には全文のツールチップを出さない', () => {
    renderPanel({
      resumeLast: {
        disabledReason: 'このフォルダで前回起動したセッションの記録がありません',
        onResume: vi.fn()
      }
    })
    const button = screen.getByRole('button', { name: RESUME_LABEL })
    expect(button).toHaveAttribute(
      'title',
      'このフォルダで前回起動したセッションの記録がありません'
    )
    expect(button.querySelector('[title]')).toBeNull()
  })

  it.each(['starting', 'running'] as const)('%s のタブでは出さない', (status) => {
    renderPanel({ sessions: makeSessions({ status }) })
    expect(screen.queryByRole('button', { name: RESUME_LABEL })).toBeNull()
  })

  it('押せない理由を帯の理由の領域に見える文字で 1 か所だけ出し、disabled と aria-describedby で結ぶ(L-057・L-058)', async () => {
    const state = renderPanel({
      resumeLast: {
        disabledReason: 'このフォルダで前回起動したセッションの記録がありません',
        onResume: vi.fn()
      }
    })
    const button = screen.getByRole('button', { name: RESUME_LABEL })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      'このフォルダで前回起動したセッションの記録がありません'
    )
    // 説明は hidden の要素から引く(読み上げの順番には出さない)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')).toHaveAttribute(
      'hidden'
    )
    // 見える文字は帯の理由の欄に 1 か所だけで、aria-hidden(説明と二重に読まれないように)
    const visible = document.querySelectorAll('.agent-terminal-panel__reason')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveTextContent('このフォルダで前回起動したセッションの記録がありません')
    expect(visible[0]).toBeVisible()
    expect(visible[0]).toHaveAttribute('aria-hidden', 'true')
    // 起動は押せる(起動の説明には結ばない)
    expect(screen.getByRole('button', { name: /^起動/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^起動/ })).not.toHaveAttribute('aria-describedby')
    await userEvent.click(button)
    expect(state.resumeLast.onResume).not.toHaveBeenCalled()
  })

  it('起動の理由があるときは、同じ理由の領域を両方のボタンから参照する(理由の文字は 1 か所)', () => {
    renderPanel({
      sessions: makeSessions({}, { startDisabledReason: 'フォルダを開いてください' }),
      resumeLast: { disabledReason: 'フォルダを開いてください', onResume: vi.fn() }
    })
    const start = screen.getByRole('button', { name: /^起動/ })
    const resume = screen.getByRole('button', { name: RESUME_LABEL })
    expect(resume.getAttribute('aria-describedby')).toBe(start.getAttribute('aria-describedby'))
    expect(start).toHaveAccessibleDescription('フォルダを開いてください')
    expect(resume).toHaveAccessibleDescription('フォルダを開いてください')
    expect(document.getElementById(start.getAttribute('aria-describedby') ?? '')).toHaveAttribute(
      'hidden'
    )
    // 見える文字は 1 か所で、読み上げの順番には出さない(テキストと説明で 3 回読まれないように)
    const visible = document.querySelectorAll('.agent-terminal-panel__reason')
    expect(visible).toHaveLength(1)
    expect(visible[0]).toHaveTextContent('フォルダを開いてください')
    expect(visible[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('閉じる途中のタブでは押せない', () => {
    renderPanel({ sessions: makeSessions({ isClosing: true }) })
    expect(screen.getByRole('button', { name: RESUME_LABEL })).toBeDisabled()
  })
})

// 起動・前回の続きからを押すと、ボタンが 終了 に替わる。押したボタンの位置の 終了 にフォーカスを残す(body に落とさない)
describe('AgentTerminalPanel: 起動した後のフォーカス', () => {
  const RESUME_LABEL = '前回の続きから（このフォルダで最後に起動した claude のセッションを再開）'

  // start・onResume を押すと、選択中のタブを starting にして描き直す
  function renderStartable(): void {
    const starting = makeAgentTerminalPanelState({ sessions: makeSessions({ status: 'starting' }) })
    const sessions = makeSessions({ status: 'none' })
    const { rerender } = render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: {
            ...sessions,
            start: vi.fn(async () => rerender(<AgentTerminalPanel state={starting} />))
          },
          resumeLast: {
            disabledReason: null,
            onResume: vi.fn(() => rerender(<AgentTerminalPanel state={starting} />))
          }
        })}
      />
    )
  }

  it('起動を押した後、フォーカスは同じ位置の 終了 にある', async () => {
    renderStartable()
    await userEvent.click(screen.getByRole('button', { name: /^起動/ }))
    const stop = screen.getByRole('button', { name: /^終了/ })
    expect(document.activeElement).not.toBe(document.body)
    expect(stop).toHaveFocus()
  })

  it('前回の続きからを押した後も、フォーカスは 終了 にある', async () => {
    renderStartable()
    await userEvent.click(screen.getByRole('button', { name: RESUME_LABEL }))
    const stop = screen.getByRole('button', { name: /^終了/ })
    expect(document.activeElement).not.toBe(document.body)
    expect(stop).toHaveFocus()
  })
})

describe('AgentTerminalPanel: 中断', () => {
  const NAME = /^中断/
  const COOLDOWN = '中断を送りました。まだ作業中なら、少し待つと押せます'
  const IDLE = '入力待ちのため、中断する作業がありません'

  const runningState = (
    interrupt: Partial<AgentInterruptPanelState> = {},
    session: Partial<AgentSessionTabView> = {}
  ): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions({ status: 'running', ...session }),
      interrupt: makeAgentInterruptPanelState({ visible: true, ...interrupt })
    })
  // セッションが終わった帯(中断 は出さない)。rest で起動の理由などを渡す
  const exitedState = (
    session: Partial<AgentSessionTabView> = {},
    rest: Parameters<typeof makeAgentSessionsState>[0] = {}
  ): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions(
        { status: 'exited', exit: { exitCode: 0, reason: 'exited' }, ...session },
        rest
      ),
      interrupt: makeAgentInterruptPanelState({
        visible: false,
        disabledReason: 'claude が動いていないため中断できません'
      })
    })
  const interruptButton = (): HTMLElement => screen.getByRole('button', { name: NAME })

  it.each([
    ['starting', true],
    ['running', true],
    ['none', false],
    ['exited', false]
  ] as const)('%s の帯に出すか: %s(出すときは 終了 の直前)', (status, visible) => {
    render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeSessions({ status }),
          interrupt: makeAgentInterruptPanelState({ visible })
        })}
      />
    )
    const button = screen.queryByRole('button', { name: NAME })
    if (!visible) {
      expect(button).toBeNull()
      return
    }
    expect(button).toHaveTextContent('中断')
    expect(button).toHaveAccessibleName('中断（作業中の claude に Esc を送る）')
    const buttons = screen.getAllByRole('button')
    expect(buttons[buttons.indexOf(button as HTMLElement) + 1]).toBe(
      screen.getByRole('button', { name: /^終了/ })
    )
  })

  it('名前は選択中のタブの種類で変わる(copilot は Esc を 2 回。設定の種類ではない)', () => {
    render(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeSessions({ status: 'running', cliKind: 'copilot' }),
          interrupt: makeAgentInterruptPanelState({ visible: true }),
          appCliKind: 'claude'
        })}
      />
    )
    expect(interruptButton()).toHaveAccessibleName('中断（作業中の copilot に Esc を 2 回送る）')
  })

  it('押せるときは aria-disabled・説明・title を付けない', () => {
    render(<AgentTerminalPanel state={runningState()} />)
    const button = interruptButton()
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(button).not.toHaveAttribute('title')
    expect(button).toBeEnabled()
  })

  it('押せないときは aria-disabled(disabled ではない)で、理由を説明(隠した span)と title に出し、見える文字にはしない(L-057)', () => {
    render(<AgentTerminalPanel state={runningState({ disabledReason: IDLE })} />)
    const button = interruptButton()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toHaveAttribute('disabled')
    expect(button).toHaveAccessibleDescription(IDLE)
    expect(button).toHaveAttribute('title', IDLE)
    const description = document.getElementById(button.getAttribute('aria-describedby') ?? '')
    expect(description).not.toBeVisible()
  })

  it.each([
    ['押せるとき', null],
    ['押せないとき', IDLE]
  ] as const)(
    '%s の click で onInterrupt を呼ぶ(送らないことと理由の読み上げは hook の手順 2。L-058)',
    async (_name, disabledReason) => {
      const state = runningState({ disabledReason })
      render(<AgentTerminalPanel state={state} />)
      await userEvent.click(interruptButton())
      expect(state.interrupt.onInterrupt).toHaveBeenCalledOnce()
    }
  )

  // キーボード(Enter・Space)と支援技術のクリックは detail が 0 で届く。ダブルクリックの判定がこれを捨てないこと
  it('キーボードのクリック(detail: 0)では onInterrupt を呼ぶ', () => {
    const state = runningState()
    render(<AgentTerminalPanel state={state} />)
    fireEvent.click(interruptButton(), { detail: 0 })
    expect(state.interrupt.onInterrupt).toHaveBeenCalledOnce()
  })

  it('ダブルクリックの 2 回目(detail: 2)では onInterrupt を呼ばない', () => {
    const state = runningState()
    render(<AgentTerminalPanel state={state} />)
    fireEvent.click(interruptButton(), { detail: 1 })
    fireEvent.click(interruptButton(), { detail: 2 })
    expect(state.interrupt.onInterrupt).toHaveBeenCalledOnce()
  })

  it('Enter・Space のキーリピートの keydown は既定の動作を止め、単発の Enter・Space は止めない(L-408)', () => {
    render(<AgentTerminalPanel state={runningState()} />)
    const button = interruptButton()
    expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(button, { key: ' ', repeat: true })).toBe(false)
    expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true)
    expect(fireEvent.keyDown(button, { key: 'a', repeat: true })).toBe(true)
  })

  it('読み上げの要素(role="status")は未起動でも常にあり、notice の文言を入れる', () => {
    const { container, rerender } = render(
      <AgentTerminalPanel state={makeAgentTerminalPanelState()} />
    )
    const live = container.querySelector('.agent-terminal-panel__live')
    expect(live).not.toBeNull()
    expect(live).toHaveAttribute('role', 'status')
    expect(live).toHaveTextContent('')
    rerender(
      <AgentTerminalPanel
        state={runningState({ notice: { text: 'claude 1 に中断（Esc）を送りました', id: 1 } })}
      />
    )
    expect(container.querySelector('.agent-terminal-panel__live')).toBe(live)
    expect(live).toHaveTextContent('claude 1 に中断（Esc）を送りました')
  })

  it('押せない状態に変わっても、フォーカスは 中断 に残る(aria-disabled のため body に落ちない)', () => {
    const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
    interruptButton().focus()
    rerender(<AgentTerminalPanel state={runningState({ disabledReason: COOLDOWN })} />)
    expect(interruptButton()).toHaveFocus()
    expect(interruptButton()).toHaveAttribute('aria-disabled', 'true')
  })

  // 移すかの判定(最後にフォーカスを受けた要素・blur で控えを消さない・外のフォーカスを奪わない)は useAgentInterruptFocus の
  // テストで確かめる。ここでは帯の配線(section の onFocus・主ボタンが 起動・押せないときの移し先が開閉のボタン)だけ
  describe('セッションが終わって 中断 が消えたときのフォーカス(設計書「フォーカス」)', () => {
    const start = (): HTMLElement => screen.getByRole('button', { name: /^起動/ })
    const toggle = (): HTMLElement => screen.getByRole('button', { name: /エージェント/ })

    it('中断 にフォーカスがある状態で終わると、同じ帯の 起動 へ移る', () => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      interruptButton().focus()
      rerender(<AgentTerminalPanel state={exitedState()} />)
      expect(start()).toHaveFocus()
    })

    it.each<[string, Partial<AgentSessionTabView>, Parameters<typeof makeAgentSessionsState>[0]]>([
      ['閉じる途中', { isClosing: true }, {}],
      ['起動できない理由がある', {}, { startDisabledReason: 'フォルダを開いてください' }]
    ])('起動 が押せない(%s)ときは、開閉のボタン(エージェント)へ移る', (_name, session, rest) => {
      const { rerender } = render(<AgentTerminalPanel state={runningState()} />)
      interruptButton().focus()
      rerender(<AgentTerminalPanel state={exitedState(session, rest)} />)
      expect(start()).toBeDisabled()
      expect(toggle()).toHaveFocus()
    })
  })
})

describe('AgentTerminalPanel: 許可の確認への答え', () => {
  const ALLOW = /^許可/
  const DENY = /^拒否/
  const ALLOW_NAME = '許可（claude 1 の「Do you want to proceed?」に 1 番の Yes で答える）'
  const DENY_NAME = '拒否（claude 1 の「Do you want to proceed?」に 4 番の No で答える）'
  const COOLDOWN = '答えを押した直後です（少し待つと押せます）'
  const NO_YES = '画面に「Yes」の選択肢が見つかりません（ターミナルで答えてください）'
  const FULL_QUESTION = 'Do you want to make this edit to a-very-long-file-name.md?'

  const answerState = (
    overrides: Partial<AgentPermissionAnswerPanelState> = {}
  ): AgentPermissionAnswerPanelState =>
    makeAgentPermissionAnswerPanelState({
      visible: true,
      question: { firstLine: 'Do you want to proceed?', full: 'Do you want to proceed?' },
      allow: { disabledReason: null, ariaLabel: ALLOW_NAME },
      deny: { disabledReason: null, ariaLabel: DENY_NAME },
      ...overrides
    })
  const permissionState = (
    permissionAnswer: Partial<AgentPermissionAnswerPanelState> = {}
  ): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions({ status: 'running' }),
      interrupt: makeAgentInterruptPanelState({
        visible: true,
        disabledReason:
          '許可待ちのため中断できません（Esc は許可の拒否になります。ターミナルで答えてください）'
      }),
      permissionAnswer: answerState(permissionAnswer)
    })
  // 許可待ちでない帯(答えの状態は既定の「出さない」)。描かないことと、許可待ちが終わったときのフォーカスの移し先のテストで使う
  const notPermissionState = (): AgentTerminalPanelState =>
    makeAgentTerminalPanelState({
      sessions: makeSessions({ status: 'running' }),
      interrupt: makeAgentInterruptPanelState({ visible: true })
    })
  const allowButton = (): HTMLElement => screen.getByRole('button', { name: ALLOW })
  const denyButton = (): HTMLElement => screen.getByRole('button', { name: DENY })

  it('許可待ちでないときは、問いも 2 つのボタンも描かない', () => {
    const { container } = render(<AgentTerminalPanel state={notPermissionState()} />)
    expect(screen.queryByRole('button', { name: ALLOW })).toBeNull()
    expect(screen.queryByRole('button', { name: DENY })).toBeNull()
    expect(container.querySelector('.agent-terminal-panel__permission-question')).toBeNull()
  })

  it('許可待ちでは 許可・拒否 を 中断 の直前に並べ、名前は見える文字で始まる', () => {
    render(<AgentTerminalPanel state={permissionState()} />)
    expect(allowButton()).toHaveTextContent('許可')
    expect(denyButton()).toHaveTextContent('拒否')
    expect(allowButton()).toHaveAccessibleName(ALLOW_NAME)
    expect(denyButton()).toHaveAccessibleName(DENY_NAME)
    const buttons = screen.getAllByRole('button')
    const index = buttons.indexOf(allowButton())
    expect(buttons[index + 1]).toBe(denyButton())
    expect(buttons[index + 2]).toBe(screen.getByRole('button', { name: /^中断/ }))
  })

  it('問いは 1 行目を見える文字に、全文を title に入れ、読み上げの順番には出さない(aria-hidden)', () => {
    const { container } = render(
      <AgentTerminalPanel
        state={permissionState({
          question: { firstLine: 'Do you want to make this edit to', full: FULL_QUESTION }
        })}
      />
    )
    const question = container.querySelector('.agent-terminal-panel__permission-question')
    expect(question).toHaveTextContent('Do you want to make this edit to')
    expect(question).toHaveAttribute('title', FULL_QUESTION)
    expect(question).toHaveAttribute('aria-hidden', 'true')
    // 問いは 許可 の直前
    expect(question?.nextElementSibling).toBe(allowButton())
  })

  it('問いを読み取れないときは、問いを描かずにボタンだけ出す', () => {
    const { container } = render(<AgentTerminalPanel state={permissionState({ question: null })} />)
    expect(container.querySelector('.agent-terminal-panel__permission-question')).toBeNull()
    expect(allowButton()).toBeInTheDocument()
  })

  it('押せるときは aria-disabled・説明・title を付けない', () => {
    render(<AgentTerminalPanel state={permissionState()} />)
    for (const button of [allowButton(), denyButton()]) {
      expect(button).not.toHaveAttribute('aria-disabled')
      expect(button).not.toHaveAttribute('aria-describedby')
      expect(button).not.toHaveAttribute('title')
      expect(button).toBeEnabled()
    }
  })

  it('押せないときは aria-disabled(disabled ではない)で、ボタンごとの理由を説明(隠した span)と title に出す', () => {
    render(
      <AgentTerminalPanel
        state={permissionState({
          allow: { disabledReason: NO_YES, ariaLabel: ALLOW_NAME },
          deny: { disabledReason: null, ariaLabel: DENY_NAME }
        })}
      />
    )
    const allow = allowButton()
    expect(allow).toHaveAttribute('aria-disabled', 'true')
    expect(allow).not.toHaveAttribute('disabled')
    expect(allow).toHaveAccessibleDescription(NO_YES)
    expect(allow).toHaveAttribute('title', NO_YES)
    const description = document.getElementById(allow.getAttribute('aria-describedby') ?? '')
    expect(description).not.toBeVisible()
    expect(denyButton()).not.toHaveAttribute('aria-disabled')
  })

  it('2 つのボタンの説明は別々の要素を参照する(理由がボタンで違いうるため)', () => {
    render(
      <AgentTerminalPanel
        state={permissionState({
          allow: { disabledReason: NO_YES, ariaLabel: ALLOW_NAME },
          deny: { disabledReason: COOLDOWN, ariaLabel: DENY_NAME }
        })}
      />
    )
    expect(allowButton().getAttribute('aria-describedby')).not.toBe(
      denyButton().getAttribute('aria-describedby')
    )
    expect(denyButton()).toHaveAccessibleDescription(COOLDOWN)
  })

  it.each([
    ['押せるとき', null],
    ['押せないとき', COOLDOWN]
  ] as const)(
    '%s の click で onAnswer に選択肢を渡す(送らないことと理由の読み上げは hook の役目。L-058)',
    async (_name, disabledReason) => {
      const state = permissionState({
        allow: { disabledReason, ariaLabel: ALLOW_NAME },
        deny: { disabledReason, ariaLabel: DENY_NAME }
      })
      render(<AgentTerminalPanel state={state} />)
      await userEvent.click(allowButton())
      await userEvent.click(denyButton())
      expect(vi.mocked(state.permissionAnswer.onAnswer).mock.calls).toEqual([['allow'], ['deny']])
    }
  )

  it('キーボードのクリック(detail: 0)では onAnswer を呼び、ダブルクリックの 2 回目(detail: 2)では呼ばない', () => {
    const state = permissionState()
    render(<AgentTerminalPanel state={state} />)
    fireEvent.click(allowButton(), { detail: 0 })
    fireEvent.click(allowButton(), { detail: 1 })
    fireEvent.click(allowButton(), { detail: 2 })
    expect(state.permissionAnswer.onAnswer).toHaveBeenCalledTimes(2)
  })

  it('Enter・Space のキーリピートの keydown は既定の動作を止め、単発の Enter・Space は止めない(L-408)', () => {
    render(<AgentTerminalPanel state={permissionState()} />)
    for (const button of [allowButton(), denyButton()]) {
      expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(button, { key: ' ', repeat: true })).toBe(false)
      expect(fireEvent.keyDown(button, { key: 'Enter' })).toBe(true)
      expect(fireEvent.keyDown(button, { key: ' ' })).toBe(true)
      // Enter・Space 以外のリピート(Tab など)は止めない
      expect(fireEvent.keyDown(button, { key: 'Tab', repeat: true })).toBe(true)
    }
  })

  it('読み上げの要素(role="status")は中断のものと別に常に 2 つあり、1 つ目に中断・2 つ目に答えの notice の文言を入れる', () => {
    const { container, rerender } = render(
      <AgentTerminalPanel state={makeAgentTerminalPanelState()} />
    )
    const lives = container.querySelectorAll('.agent-terminal-panel__live')
    expect(lives).toHaveLength(2)
    for (const live of lives) expect(live).toHaveAttribute('role', 'status')
    const base = permissionState({
      notice: { text: 'claude 1 に許可（1 番の Yes）を送りました', id: 1 }
    })
    rerender(
      <AgentTerminalPanel
        state={{
          ...base,
          interrupt: { ...base.interrupt, notice: { text: 'claude 1 に中断を送りました', id: 2 } }
        }}
      />
    )
    const after = container.querySelectorAll('.agent-terminal-panel__live')
    expect(after[0]).toBe(lives[0])
    expect(after[1]).toBe(lives[1])
    // 全文を比べる(部分一致だと、2 つ目に中断の文言が混ざっても通る)。同じ文の再読み上げ用の末尾の文字は id の偶奇で付く(toAnnouncementText)
    expect(after[0].textContent).toBe(
      toAnnouncementText({ text: 'claude 1 に中断を送りました', id: 2 })
    )
    expect(after[1].textContent).toBe(
      toAnnouncementText({ text: 'claude 1 に許可（1 番の Yes）を送りました', id: 1 })
    )
  })

  it('押せない状態に変わっても、フォーカスは押したボタンに残る(aria-disabled のため body に落ちない。L-157)', () => {
    const { rerender } = render(<AgentTerminalPanel state={permissionState()} />)
    allowButton().focus()
    rerender(
      <AgentTerminalPanel
        state={permissionState({ allow: { disabledReason: COOLDOWN, ariaLabel: ALLOW_NAME } })}
      />
    )
    expect(allowButton()).toHaveFocus()
  })

  // 移すかの判定の細部は useAgentPermissionAnswerFocus のテストで確かめる。ここでは帯の配線(section の onFocus・移し先)だけ
  it.each([ALLOW, DENY])(
    '%s にフォーカスがある状態で許可待ちが終わると、開閉のボタン(エージェント)へ移り、中断・終了へは移らない',
    (name) => {
      const { rerender } = render(<AgentTerminalPanel state={permissionState()} />)
      screen.getByRole('button', { name }).focus()
      rerender(<AgentTerminalPanel state={notPermissionState()} />)
      expect(screen.getByRole('button', { name: 'エージェント' })).toHaveFocus()
      expect(screen.getByRole('button', { name: /^中断/ })).not.toHaveFocus()
      expect(screen.getByRole('button', { name: /^終了/ })).not.toHaveFocus()
    }
  )

  it('中断 のフォーカスの控えも、答えのボタンと同じ section の onFocus で働き続ける', () => {
    const { rerender } = render(<AgentTerminalPanel state={permissionState()} />)
    screen.getByRole('button', { name: /^中断/ }).focus()
    rerender(
      <AgentTerminalPanel
        state={makeAgentTerminalPanelState({
          sessions: makeSessions({ status: 'exited', exit: { exitCode: 0, reason: 'exited' } }),
          interrupt: makeAgentInterruptPanelState({ visible: false })
        })}
      />
    )
    expect(screen.getByRole('button', { name: /^起動/ })).toHaveFocus()
  })
})
