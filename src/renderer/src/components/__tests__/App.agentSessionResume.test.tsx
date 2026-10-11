import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentSessionExit, Prompt } from '@shared/types'
import type { Panel } from '../../types'

// jsdom では xterm を開けない(matchMedia・canvas が無い)ため、文書ごとのタブの置き場の controller を偽物にする
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'
import { getAgentSessionTabs } from '../../lib/xtermFactory'
import type { FakeController } from '../../__tests__/makeFakeAgentTerminal'
import { prepareClaudeScreen as prepareClaudeScreenOf } from '../../__tests__/prepareClaudeScreen'
import {
  AGENT_SEND_FAILURE_MESSAGES,
  PROMPT_RUN_ARIA_LABEL_AGENT
} from '../../lib/agentSendMessages'
import { AGENT_RESUME_LAST_ARIA_LABEL } from '../../lib/agentSessionMessages'
import { activityBarPanels } from '../../config/activityBarPanels'

// App → useAppState(useAgentWorkspace・usePromptRunner・useHistory)→ Sidebar(PromptsPanel・HistoryPanel)を本物のまま通し、
// 「実行 → 確認から送れたら履歴にエージェントのエントリ → 詳細の このセッションで再開 で resume の起動の依頼」を確かめる。
// getHistoryActions・onResume の取り違え・渡し忘れ(L-060)と、確認を経由した送信の記録の抜けをここで落とす

const ID = '11111111-1111-4111-8111-111111111111'
const prompt: Prompt = { id: 'p1', title: '要約', content: '要約して', createdAt: 1000000 }

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

// 選択中のタブの偽の controller を空の入力欄の claude の画面にする(共有の prepareClaudeScreen。App.agentReferences.test.tsx と同じ)。
// タブの置き場はファイルで共有しているため、上書きの前に戻す restore を控え、afterEach(restoreControllerState)で戻す
let restoreControllerState: (() => void) | null = null
const prepareClaudeScreen = (): FakeController => {
  const { controller, restore } = prepareClaudeScreenOf(getAgentSessionTabs())
  restoreControllerState = restore
  return controller
}

let emitExit: (exit: AgentSessionExit) => void = () => undefined

describe('App: セッションの再開と履歴の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreControllerState = null
    // タブの置き場はファイルで共有しているため、前のテストで足したタブを消して 1 つ目(claude 1)だけにする
    const store = getAgentSessionTabs()
    const [first, ...rest] = store.getSnapshot().tabs
    for (const tab of rest) store.remove(tab.slotId)
    if (first !== undefined) store.select(first.slotId)
    window.api.getAgentSendConfirmEnabled = vi.fn().mockResolvedValue(true)
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.loadPrompts = vi.fn().mockResolvedValue([prompt])
    window.api.loadHistory = vi.fn().mockResolvedValue([])
    window.api.saveHistory = vi.fn().mockResolvedValue(undefined)
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi
      .fn()
      .mockResolvedValue([{ name: 'a.ts', path: '/project/a.ts', type: 'file' }])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getLastAgentSession = vi.fn().mockResolvedValue(null)
    window.api.startAgentSession = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: ID })
      .mockResolvedValue({ kind: 'started', sessionId: 's2', claudeSessionId: ID })
    window.api.onAgentExit = vi.fn((listener: (exit: AgentSessionExit) => void) => {
      emitExit = listener
      return () => {}
    })
  })

  afterEach(() => {
    restoreControllerState?.()
    restoreControllerState = null
  })

  it('確認から送れたら履歴に 送信済み のエージェントのエントリを足し、詳細の このセッションで再開 で新しいタブから resume を依頼する', async () => {
    render(<App />)
    await screen.findByRole('region', { name: 'エージェント' })
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await screen.findByRole('tree')
    await userEvent.click(
      screen.getByRole('button', { name: '起動（開いているフォルダで claude を起動）' })
    )
    expect(window.api.startAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ launch: { kind: 'new' } })
    )
    // 実行 → 送信前の確認 → 送信(確認を経由した送信でも送り先の ID を控えて記録する)
    await userEvent.click(panelButton('prompts'))
    const runButton = await screen.findByRole('button', { name: PROMPT_RUN_ARIA_LABEL_AGENT })
    await waitFor(() => expect(runButton).toBeEnabled())
    await userEvent.click(runButton)
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    const controller = prepareClaudeScreen()
    await userEvent.click(within(dialog).getByRole('button', { name: '送信' }))
    await waitFor(() => expect(controller.writes).toContain('\r'))
    await waitFor(() =>
      expect(window.api.saveHistory).toHaveBeenLastCalledWith([
        expect.objectContaining({
          promptTitle: '要約',
          promptContent: '要約して',
          status: 'sent',
          agent: { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/project' }
        })
      ])
    )
    // 履歴の一覧と詳細
    await userEvent.click(panelButton('history'))
    const item = screen.getByRole('radio', { name: /要約/ })
    expect(within(item).getByText('送信済み')).toBeInTheDocument()
    expect(within(item).getByText('エージェント（claude 1）')).toBeInTheDocument()
    await userEvent.click(item)
    expect(screen.getByText(`セッション: ${ID}`)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '送った内容' }).textContent).toBe('要約して')
    // 同じ ID が claude 1 で動いている間は押せない(理由を見える文字で結ぶ)
    const resume = screen.getByRole('button', { name: 'このセッションで再開' })
    expect(resume).toBeDisabled()
    expect(
      document.getElementById(resume.getAttribute('aria-describedby') ?? '')
    ).toHaveTextContent('このセッションは claude 1 で動いています')
    // claude 1 が終了したら押せる。押すと新しいタブ(claude 2)を足して、そのタブで resume を依頼する
    act(() => emitExit({ sessionId: 's1', exitCode: 0, signal: null, reason: 'exited' }))
    await waitFor(() => expect(resume).toBeEnabled())
    await userEvent.click(resume)
    await waitFor(() =>
      expect(window.api.startAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ launch: { kind: 'resume', claudeSessionId: ID } })
      )
    )
    expect(await screen.findByRole('tab', { name: /claude 2/, selected: true })).toBeInTheDocument()
  })

  it('履歴の詳細の 再実行 で送れなかったとき、失敗の文言を見えている履歴のパネルに出し、読み上げはパネルの切り替えで作り直さない Sidebar の 1 か所だけが担う', async () => {
    window.api.loadHistory = vi.fn().mockResolvedValue([
      {
        id: 'h1',
        promptId: 'p1',
        promptTitle: '要約',
        promptContent: '要約して',
        fileContent: null,
        toolId: 'claude',
        status: 'sent',
        resultText: null,
        errorMessage: null,
        executedAt: 1000000,
        agent: { claudeSessionId: ID, tabLabel: 'claude 1', folderPath: '/project' }
      }
    ])
    render(<App />)
    await screen.findByRole('region', { name: 'エージェント' })
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await screen.findByRole('tree')
    await userEvent.click(
      screen.getByRole('button', { name: '起動（開いているフォルダで claude を起動）' })
    )
    await userEvent.click(panelButton('history'))
    await userEvent.click(await screen.findByRole('radio', { name: /要約/ }))
    const rerun = screen.getByRole('button', { name: '再実行' })
    await waitFor(() => expect(rerun).toBeEnabled())
    await userEvent.click(rerun)
    // 偽の controller の画面は空(入力欄が無い)のまま送るため、送信は失敗する
    const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
    await userEvent.click(within(dialog).getByRole('button', { name: '送信' }))
    const message = AGENT_SEND_FAILURE_MESSAGES['input-not-found']
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(message)
    // 読み上げの領域はパネルの外(Sidebar の常設)。alert・送信の結果の status は全体で 1 つずつ
    expect(alert.closest('.sidebar__panel')).toBeNull()
    expect(alert.closest('.sidebar')).not.toBeNull()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    const notice = document.querySelector('.agent-send-feedback__live [role="status"]')
    expect(notice).not.toBeNull()
    expect(document.querySelectorAll('.agent-send-feedback__live [role="status"]')).toHaveLength(1)
    // 見える文言は、見えている履歴のパネルに出す(読み上げは上の領域だけが担うので aria-hidden)
    const visibleIn = (panel: string): Element | null =>
      document.querySelector(`${panel} .agent-send-feedback__error`)
    expect(visibleIn('.history-panel')).toHaveTextContent(message)
    expect(visibleIn('.history-panel')).toHaveAttribute('aria-hidden', 'true')
    expect(visibleIn('.prompts-panel')).toBeNull()
    // パネルを切り替えても、読み上げの領域は同じ要素のまま(文言を持った alert が新しく入って読み直されない)
    await userEvent.click(panelButton('prompts'))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert')).toBe(alert)
    expect(document.querySelector('.agent-send-feedback__live [role="status"]')).toBe(notice)
    expect(visibleIn('.prompts-panel')).toHaveTextContent(message)
    expect(visibleIn('.history-panel')).toBeNull()
    await userEvent.click(panelButton('history'))
    expect(screen.getByRole('alert')).toBe(alert)
    expect(visibleIn('.history-panel')).toHaveTextContent(message)
  })

  it('前回の続きから: 開いたフォルダの前回のセッションを本物の useAgentLastSession で取り、押すと resume を依頼し、動いている間は理由を見える文字で結ぶ', async () => {
    window.api.getLastAgentSession = vi.fn().mockResolvedValue({ claudeSessionId: ID })
    // + で足すタブ(claude 2)は起動に失敗させ、起動していないタブとして 前回の続きから を出す
    window.api.startAgentSession = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'started', sessionId: 's1', claudeSessionId: ID })
      .mockResolvedValue({ kind: 'error', error: 'spawn-failed' })
    render(<App />)
    await screen.findByRole('region', { name: 'エージェント' })
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await screen.findByRole('tree')
    const resumeLast = screen.getByRole('button', { name: AGENT_RESUME_LAST_ARIA_LABEL })
    await waitFor(() => expect(resumeLast).toBeEnabled())
    expect(window.api.getLastAgentSession).toHaveBeenCalledWith('/project')
    await userEvent.click(resumeLast)
    await waitFor(() =>
      expect(window.api.startAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ launch: { kind: 'resume', claudeSessionId: ID } })
      )
    )
    // 起動に成功したタブ(claude 1)が同じ ID で動いている間は、ほかのタブ(claude 2)から押せない
    // (起動の理由と同じ 1 か所に見える文字で出す。動いているタブでは 終了 に替わるため、ほかのタブで確かめる)
    await screen.findByRole('button', { name: '終了（エージェントを止める）' })
    await userEvent.click(screen.getByRole('button', { name: '新しいセッション' }))
    await screen.findByRole('tab', { name: /claude 2/, selected: true })
    const resumeLastOnNewTab = screen.getByRole('button', { name: AGENT_RESUME_LAST_ARIA_LABEL })
    await waitFor(() => expect(resumeLastOnNewTab).toBeDisabled())
    expect(
      document.getElementById(resumeLastOnNewTab.getAttribute('aria-describedby') ?? '')
    ).toHaveTextContent('前回のセッションは claude 1 で動いています')
  })
})
