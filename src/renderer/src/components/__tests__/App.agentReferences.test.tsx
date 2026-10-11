import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Prompt } from '@shared/types'
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
import { PROMPT_RUN_ARIA_LABEL_AGENT } from '../../lib/agentSendMessages'
import { activityBarPanels } from '../../config/activityBarPanels'
import { mockEditor } from '../../__tests__/__mocks__/@monaco-editor/react'
import { selectionOf } from '../../__tests__/makeFakeApplyEditor'

// App → useAppState(useEditorSelectionRange・useAgentReferences)→ EditorPanel(onEditorMount)・Sidebar(PromptsPanel の参照の行・
// ExplorerPanel のメニュー)・常設の読み上げの領域、の配線を、末端の表示で確かめる

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

// エージェント CLI 方式(ターミナルのパネルが出るまで待つ)でフォルダを開く
const openFolder = async (): Promise<HTMLElement> => {
  render(<App />)
  await screen.findByRole('region', { name: 'エージェント' })
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  return screen.findByRole('tree')
}

const prompt: Prompt = { id: 'p1', title: '要約', content: '要約して', createdAt: 1000000 }

// 選択中のタブの偽の controller を空の入力欄の claude の画面にする(共有の prepareClaudeScreen。useAgentPromptSender.test と同じ流儀)。
// 本物の sendAgentPrompt がこの画面を読んで Enter まで送る。上書きの前に戻す restore を控え、afterEach(restoreControllerState)で戻す
let restoreControllerState: (() => void) | null = null
const prepareClaudeScreen = (): FakeController => {
  const { controller, restore } = prepareClaudeScreenOf(getAgentSessionTabs())
  restoreControllerState = restore
  return controller
}

// フォルダを開いてエージェントを起動し、エクスプローラから notes.md を参照に足して、プロンプトの「実行」を押す。
// 送信前の確認のダイアログを返す
const addReferenceAndRun = async (): Promise<HTMLElement> => {
  window.api.loadPrompts = vi.fn().mockResolvedValue([prompt])
  const tree = await openFolder()
  await userEvent.click(
    screen.getByRole('button', { name: '起動（開いているフォルダで claude を起動）' })
  )
  fireEvent.contextMenu(await within(tree).findByText('notes.md'))
  await userEvent.click(screen.getByRole('menuitem', { name: '参照として添える' }))
  await userEvent.click(panelButton('prompts'))
  const group = screen.getByRole('group', { name: '参照' })
  expect(within(group).getByText('@notes.md')).toBeInTheDocument()
  const runButton = await screen.findByRole('button', { name: PROMPT_RUN_ARIA_LABEL_AGENT })
  await waitFor(() => expect(runButton).toBeEnabled())
  await userEvent.click(runButton)
  const dialog = await screen.findByRole('dialog', { name: '送信前の確認' })
  const body = within(dialog).getByRole('region', { name: '送る内容' })
  expect(body.textContent).toContain('要約して')
  expect(body.textContent).toContain('参照:')
  expect(body.textContent).toContain('- @notes.md')
  return dialog
}

describe('App: 参照の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreControllerState = null
    // 3・4 件目は確認のダイアログが出ることを前提にするため、既定に頼らず明示する
    window.api.getAgentSendConfirmEnabled = vi.fn().mockResolvedValue(true)
    window.api.startAgentSession = vi.fn().mockResolvedValue({
      kind: 'started',
      sessionId: 's1',
      claudeSessionId: '11111111-1111-4111-8111-111111111111'
    })
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.loadPrompts = vi.fn().mockResolvedValue([])
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([
      { name: 'a.ts', path: '/project/a.ts', type: 'file' },
      { name: 'notes.md', path: '/project/notes.md', type: 'file' }
    ])
    window.api.readFile = vi.fn().mockResolvedValue('line1\nline2\nline3')
    window.api.onExternalFileChange = vi.fn(() => () => {})
  })

  afterEach(() => {
    restoreControllerState?.()
    restoreControllerState = null
  })

  it('エクスプローラの「参照として添える」で足したファイルを、パネルの外の読み上げの領域とプロンプトパネルの参照の行に出す', async () => {
    const tree = await openFolder()
    fireEvent.contextMenu(await within(tree).findByText('notes.md'))
    await userEvent.click(screen.getByRole('menuitem', { name: '参照として添える' }))
    const announcement = await screen.findByText('参照に @notes.md を足しました')
    expect(announcement).toHaveAttribute('aria-live', 'polite')
    // エクスプローラを開いている間はプロンプトパネルが隠れるため、サイドバーの外に置く
    expect(document.querySelector('.sidebar')?.contains(announcement)).toBe(false)
    await userEvent.click(panelButton('prompts'))
    const group = screen.getByRole('group', { name: '参照' })
    expect(within(group).getByText('@notes.md')).toBeInTheDocument()
    expect(
      within(group).getByRole('button', { name: '@notes.md を参照から外す' })
    ).toBeInTheDocument()
  })

  it('エディタで開いたファイルと選択範囲を参照のチップに出し、オンにしたファイルを編集すると未保存の印を付ける', async () => {
    const tree = await openFolder()
    await userEvent.click(await within(tree).findByText('a.ts'))
    await screen.findByTestId('monaco-editor')
    act(() => mockEditor.current?.select(selectionOf(1, 1, 2, 3, 2, 3)))
    await userEvent.click(panelButton('prompts'))
    const group = await screen.findByRole('group', { name: '参照' })
    await userEvent.click(within(group).getByRole('button', { name: '@a.ts' }))
    expect(within(group).getByRole('button', { name: '@a.ts' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(group).getByRole('button', { name: '@a.ts#L1-2' })).toBeEnabled()
    fireEvent.change(screen.getByTestId('monaco-editor-textarea'), { target: { value: 'typed' } })
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: '@a.ts 未保存' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    )
  })
  // 本物の hook どうし(useAgentReferences → usePromptRunner → useAgentWorkspace.sendToAgent → useAgentSendConfirm →
  // useAgentPromptSender → markSent)をつなぎ、送れたときだけ足したファイルを外す約束(L-407)を層をまたいで確かめる
  it('エクスプローラから足したファイルは、確認のダイアログに参照入りの全文を出し、送信で送れたらチップから外す', async () => {
    const dialog = await addReferenceAndRun()
    const controller = prepareClaudeScreen()
    await userEvent.click(within(dialog).getByRole('button', { name: '送信' }))
    await waitFor(() => expect(controller.writes).toContain('\r'))
    expect(controller.writes.find((data) => data.startsWith('\x1b[200~'))).toContain(
      '参照:\n- @notes.md'
    )
    // 参照の行は残したまま、足したファイルのチップだけが外れる(行ごと消える退行を通さない)
    await waitFor(() => {
      const group = screen.getByRole('group', { name: '参照' })
      expect(within(group).queryByText('@notes.md')).toBeNull()
    })
    expect(
      within(screen.getByRole('group', { name: '参照' })).getByText('開いているファイル')
    ).toBeInTheDocument()
  })

  it('確認をキャンセルで閉じたら、エクスプローラから足したファイルをチップに残す', async () => {
    const dialog = await addReferenceAndRun()
    const controller = prepareClaudeScreen()
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '送信前の確認' })).toBeNull())
    expect(controller.writes).toEqual([])
    const group = screen.getByRole('group', { name: '参照' })
    expect(within(group).getByText('@notes.md')).toBeInTheDocument()
  })
})
