import { describe, it, expect, vi, beforeEach } from 'vitest'

// xtermFactory は実物の xterm で controller を作る組み立てのモジュール。jsdom では xterm を開けないため、xterm・FitAddon と
// controller・タブの置き場の生成を差し替え、組み立てが依存へ渡す値(xterm の設定・リンクの開き方・表示の要素)だけを確かめる
const terminals = vi.hoisted(
  () => [] as { options: Record<string, unknown>; loadAddon: ReturnType<typeof vi.fn> }[]
)
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: unknown, options: Record<string, unknown>) {
    const terminal = { options, loadAddon: vi.fn() }
    terminals.push(terminal)
    return terminal
  })
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function () {
    return { marker: 'fit' }
  })
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
const mockCreateController = vi.hoisted(() => vi.fn((deps: unknown) => ({ deps })))
vi.mock('../agentTerminalController', () => ({
  createAgentTerminalController: mockCreateController
}))
const mockCreateTabs = vi.hoisted(() => vi.fn((deps: unknown) => ({ deps })))
vi.mock('../agentSessionTabs', () => ({ createAgentSessionTabs: mockCreateTabs }))
const mockOpenExternalLink = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../shellApi', () => ({ openExternalLink: mockOpenExternalLink }))
const mockIsMacPlatform = vi.hoisted(() => vi.fn(() => true))
vi.mock('../platform', () => ({ isMacPlatform: mockIsMacPlatform }))
vi.mock('../agentTerminalApi', () => ({ marker: 'agentTerminalApi' }))

import { AGENT_MAX_SESSIONS_PER_WINDOW } from '@shared/types'
import type { AgentSessionTabsDeps } from '../agentSessionTabs'
import type { AgentTerminalControllerDeps } from '../agentTerminalController'
import * as agentTerminalApi from '../agentTerminalApi'
import { getAgentSessionTabs } from '../xtermFactory'

interface LinkHandler {
  activate: (event: MouseEvent, uri: string) => void
}

// タブの置き場へ渡した依存(置き場は文書ごとに 1 つなので、最初の呼び出しの引数を見る)
function tabsDeps(): AgentSessionTabsDeps {
  getAgentSessionTabs()
  return mockCreateTabs.mock.calls[0][0] as AgentSessionTabsDeps
}

// createController を 1 回呼び、作った xterm と controller へ渡した依存を返す
function createOne(): {
  terminal: (typeof terminals)[number]
  deps: AgentTerminalControllerDeps
} {
  tabsDeps().createController()
  const deps = mockCreateController.mock.calls.at(-1)?.[0] as AgentTerminalControllerDeps
  return { terminal: terminals[terminals.length - 1], deps }
}

beforeEach(() => {
  mockOpenExternalLink.mockClear()
  mockCreateController.mockClear()
})

describe('getAgentSessionTabs', () => {
  it('置き場は文書ごとに 1 つで、何度呼んでも同じものを返す(タブの上限は 1 ウィンドウの上限)', () => {
    const first = getAgentSessionTabs()
    expect(getAgentSessionTabs()).toBe(first)
    expect(mockCreateTabs).toHaveBeenCalledOnce()
    expect(tabsDeps().max).toBe(AGENT_MAX_SESSIONS_PER_WINDOW)
  })

  it('タブの ID は呼ぶたびに別の値を振る', () => {
    const { createSlotId } = tabsDeps()
    const a = createSlotId()
    const b = createSlotId()
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)
  })
})

describe('createController(タブごとの xterm の controller)', () => {
  it('呼ぶたびに新しい xterm を作り、FitAddon を読み込んで controller へ渡す', () => {
    const before = terminals.length
    const one = createOne()
    const two = createOne()
    expect(terminals.length).toBe(before + 2)
    expect(one.terminal).not.toBe(two.terminal)
    expect(one.deps.terminal).toBe(one.terminal)
    expect(one.terminal.loadAddon).toHaveBeenCalledExactlyOnceWith(one.deps.fitAddon)
  })

  it('xterm の設定(点滅なし・等幅の書体・14px・5,000 行の履歴・背景色)', () => {
    const { terminal } = createOne()
    expect(terminal.options).toMatchObject({
      cursorBlink: false,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      scrollback: 5000,
      theme: { background: '#1e1e1e' }
    })
  })

  it('IPC の API・クリップボード・macOS かどうかを controller へ渡す', () => {
    // jsdom の navigator.clipboard は環境によって無い(undefined どうしの一致で通らないよう、目印の偽物を置く)
    const clipboard = { readText: vi.fn(), writeText: vi.fn() }
    const saved = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    try {
      mockIsMacPlatform.mockReturnValueOnce(false)
      const { deps } = createOne()
      expect(deps.api).toBe(agentTerminalApi)
      expect(deps.clipboard).toBe(clipboard)
      expect(deps.isMac).toBe(false)
    } finally {
      if (saved) Object.defineProperty(navigator, 'clipboard', saved)
      else delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  it('表示の要素は、呼ぶたびに agent-terminal-view__host の class を持つ新しい div を作る', () => {
    const { deps } = createOne()
    const a = deps.createHost()
    const b = deps.createHost()
    expect(a.tagName).toBe('DIV')
    expect(a.className).toBe('agent-terminal-view__host')
    expect(a).not.toBe(b)
  })

  describe('OSC 8 のリンク', () => {
    const activate = (uri: string): void => {
      const { linkHandler } = createOne().terminal.options as { linkHandler: LinkHandler }
      linkHandler.activate(new MouseEvent('click'), uri)
    }

    it.each(['https://example.com/a?b=1', 'http://localhost:3000/'])(
      '%s は既定のブラウザで開く',
      (uri) => {
        activate(uri)
        expect(mockOpenExternalLink).toHaveBeenCalledExactlyOnceWith(uri)
      }
    )

    it.each(['file:///etc/passwd', 'javascript:alert(1)', 'vscode://file/x', 'not a url', ''])(
      '%j は開かない(http・https 以外)',
      (uri) => {
        activate(uri)
        expect(mockOpenExternalLink).not.toHaveBeenCalled()
      }
    )
  })
})
