import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import AgentTerminalPanel from '../AgentTerminalPanel'
import type { AgentTerminalPanelState } from '../../../hooks/useAgentWorkspace'
import {
  makeAgentSessionsState,
  makeAgentSessionTabView
} from '../../../__tests__/makeAgentSessionsState'
import { AGENT_START_DISABLED_NO_FOLDER } from '../../../lib/agentSessionMessages'

// 実際の main.css を読み込み、jsdom のカスケード結果(getComputedStyle)で宣言値を検証する(OutputPanel.styles.test.tsx と同じ流儀)。
// jsdom はレイアウトを計算しないため、狭い幅で帯が 1 行に収まるかそのものは測れない(実機の手動テストで確かめる。パターン 124)
let styleElement: HTMLStyleElement

beforeAll(() => {
  styleElement = document.createElement('style')
  styleElement.textContent = readFileSync(resolve(__dirname, '../../../assets/main.css'), 'utf-8')
  document.head.appendChild(styleElement)
})

afterAll(() => {
  styleElement.remove()
})

beforeEach(() => {
  window.api.setAgentTerminalFocused = vi.fn()
})

// フォルダを開いていない状態(初回の起動で必ず通る)。帯に最も多くの部品が並ぶ
function renderNoFolder(): HTMLElement {
  const state: AgentTerminalPanelState = {
    sessions: makeAgentSessionsState({ startDisabledReason: AGENT_START_DISABLED_NO_FOLDER }),
    sendingSlotId: null,
    layout: {
      isOpen: true,
      isMaximized: false,
      open: vi.fn(),
      toggleOpen: vi.fn(),
      toggleMaximized: vi.fn()
    }
  }
  // 帯に最も多くの部品が並ぶよう、記録がある間の「変更を確認」も出す
  const { container } = render(
    <AgentTerminalPanel state={state} review={{ isRecording: true, onReview: vi.fn() }} />
  )
  return container
}

const styleOf = (container: HTMLElement, selector: string): CSSStyleDeclaration =>
  getComputedStyle(container.querySelector(selector) as HTMLElement)

describe('ターミナルパネルの見出しの帯のスタイル(main.css)', () => {
  it('帯は 32px のボタンが入る高さで、折り返さない', () => {
    const container = renderNoFolder()
    const header = styleOf(container, '.agent-terminal-panel__header')
    expect(header.minHeight).toBe('32px')
    expect(header.boxSizing).toBe('border-box')
    expect(header.flexWrap).not.toBe('wrap')
  })

  it('起動できない理由は 1 行で省略して縮み、全文は title に残す(狭い幅でボタンを押し出さない)', () => {
    const container = renderNoFolder()
    const reason = styleOf(container, '.agent-terminal-panel__reason')
    expect(reason.whiteSpace).toBe('nowrap')
    expect(reason.overflow).toBe('hidden')
    expect(reason.textOverflow).toBe('ellipsis')
    expect(reason.minWidth).toBe('0px')
    expect(reason.flexShrink).not.toBe('0')
    expect(container.querySelector('.agent-terminal-panel__reason')).toHaveAttribute(
      'title',
      AGENT_START_DISABLED_NO_FOLDER
    )

    // 理由を入れた操作群も縮められる(縮まない入れ物の中では理由が縮めない)
    const actions = styleOf(container, '.agent-terminal-panel__actions')
    expect(actions.minWidth).toBe('0px')
    expect(actions.flexShrink).not.toBe('0')
  })

  it('状態の文言より先に、起動できない理由が縮む', () => {
    const container = renderNoFolder()
    const actionsShrink = Number(styleOf(container, '.agent-terminal-panel__actions').flexShrink)
    const statusShrink = Number(styleOf(container, '.agent-terminal-panel__status').flexShrink)
    expect(actionsShrink).toBeGreaterThan(statusShrink)
  })

  it('開閉・起動・変更を確認・最大化のボタンは縮まず、折り返さない', () => {
    renderNoFolder()
    const buttons = [
      screen.getByRole('button', { name: /^▾ エージェント$|^エージェント$/ }),
      screen.getByRole('button', { name: /^起動/ }),
      screen.getByRole('button', { name: 'エージェントの変更を確認（ソース管理を開く）' }),
      screen.getByRole('button', { name: '最大化' })
    ]
    for (const button of buttons) {
      const style = getComputedStyle(button)
      expect(style.flexShrink).toBe('0')
      expect(style.whiteSpace).toBe('nowrap')
    }
  })

  it('ボタンのフォーカスリングは帯の内側に描く(帯の overflow: hidden で切れない)', () => {
    // jsdom は :focus-visible を計算しないため、規則そのものを CSSOM から探す
    const rules = Array.from(styleElement.sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule
    )
    for (const selector of [
      '.agent-terminal-panel__toggle:focus-visible',
      '.agent-terminal-panel__button:focus-visible'
    ]) {
      const rule = rules.find((r) => r.selectorText.split(/,\s*/).includes(selector))
      expect(rule, selector).toBeDefined()
      expect(rule?.style.outlineOffset).toBe('-2px')
      // jsdom は outline の一括指定を個別の値に展開しない
      expect(rule?.style.getPropertyValue('outline')).toContain('solid')
    }
  })

  describe('セッションのタブ列', () => {
    function renderTabs(): HTMLElement {
      const tabs = [
        makeAgentSessionTabView({ slotId: 'a', label: 'claude 1', status: 'running' }),
        makeAgentSessionTabView({ slotId: 'b', label: 'claude 2', status: 'starting' }),
        makeAgentSessionTabView({ slotId: 'c', label: 'claude 3', status: 'exited' })
      ]
      const state: AgentTerminalPanelState = {
        sessions: makeAgentSessionsState({
          tabs,
          selected: tabs[0],
          addDisabledReason: '上限です'
        }),
        sendingSlotId: null,
        layout: {
          isOpen: true,
          isMaximized: false,
          open: vi.fn(),
          toggleOpen: vi.fn(),
          toggleMaximized: vi.fn()
        }
      }
      return render(<AgentTerminalPanel state={state} />).container
    }

    it('タブ列は横にはみ出したらスクロールし、縮められる', () => {
      const container = renderTabs()
      const list = styleOf(container, '.agent-session-tabs__list')
      expect(list.overflowX).toBe('auto')
      expect(list.minWidth).toBe('0px')
      const root = styleOf(container, '.agent-session-tabs')
      expect(root.minWidth).toBe('0px')
      expect(root.display).toBe('flex')
    })

    it('選択中のタブには下線があり、状態の印は状態ごとに色が違う', () => {
      const container = renderTabs()
      const selected = styleOf(container, '.agent-session-tabs__tab--selected')
      expect(selected.borderBottomColor).not.toBe('')
      expect(selected.borderBottomColor).not.toBe('transparent')
      const colorOf = (status: string): string =>
        styleOf(container, `.agent-session-tabs__dot--${status}`).backgroundColor
      expect(colorOf('running')).not.toBe(colorOf('starting'))
      expect(colorOf('starting')).not.toBe(colorOf('exited'))
      expect(colorOf('running')).not.toBe('')
    })

    it('+ を押せない理由は視覚的に隠す(読み上げには残す)', () => {
      const container = renderTabs()
      const reason = styleOf(container, '.agent-session-tabs__reason')
      expect(reason.position).toBe('absolute')
      expect(reason.width).toBe('1px')
    })
  })
})
