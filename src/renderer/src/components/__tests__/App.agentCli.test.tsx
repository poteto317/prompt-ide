import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExternalFileChangeEvent, Prompt } from '@shared/types'
import type { Panel } from '../../types'

// jsdom では xterm を開けない(matchMedia・canvas が無い)ため、文書ごとのタブの置き場の controller を偽物にする
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'
import { PROMPT_RUN_ARIA_LABEL_AGENT, RUN_DISABLED_NO_SESSION } from '../../lib/agentSendMessages'

// App から Sidebar・EditorPanel へ渡すエージェント CLI 方式の props(promptRun・executionMode・bottomPanel・agentTerminal・
// externalChangeBanner)の配線を、末端のコンポーネントの表示で確かめる(どれも省略可能な props のため typecheck では漏れを
// 検知できない)。既定の setup は従来の方式なので、実行方式の読み込みを agent-cli に差し替える

const prompt: Prompt = {
  id: 'p1',
  title: 'テストタイトル',
  content: 'テスト内容',
  createdAt: 1000000
}

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

describe('App: エージェント CLI 方式の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.getAgentCliKind = vi.fn().mockResolvedValue({ kind: 'claude', fallback: null })
    window.api.loadPrompts = vi.fn().mockResolvedValue([])
    window.api.openFolder = vi.fn().mockResolvedValue(null)
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    window.api.readFile = vi.fn().mockResolvedValue('')
    window.api.onExternalFileChange = vi.fn(() => () => {})
  })

  it('設定にエージェントの通知を出し、既定でオンになっている', async () => {
    render(<App />)
    await userEvent.click(panelButton('settings'))
    const checkbox = await screen.findByRole('checkbox', {
      name: 'ウィンドウが背面のとき、許可待ち・確認待ち・作業の完了を通知する'
    })
    await waitFor(() => expect(checkbox).toBeChecked())
  })

  it('設定に送信前の確認を出し、既定でオンになっている', async () => {
    render(<App />)
    await userEvent.click(panelButton('settings'))
    const checkbox = await screen.findByRole('checkbox', {
      name: 'エージェントへ送る前に、送る内容を確認する'
    })
    await waitFor(() => expect(checkbox).toBeChecked())
  })

  it('エージェントの状態の変化の読み上げの領域を、パネルの外(ステータスバーの隣)に常設する', async () => {
    const { container } = render(<App />)
    await screen.findByRole('region', { name: 'エージェント' })
    const region = container.querySelector('.agent-announcer')
    expect(region).not.toBeNull()
    expect(region).toHaveAttribute('aria-live', 'polite')
    // パネル(region「エージェント」)の中ではない
    expect(screen.getByRole('region', { name: 'エージェント' }).contains(region)).toBe(false)
  })

  it('エディタの下部にターミナルパネル(エージェント)を出し、出力パネルを出さない', async () => {
    render(<App />)
    expect(await screen.findByRole('region', { name: 'エージェント' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '出力をクリア' })).toBeNull()
  })

  it('設定にプロンプトの実行方式を出し、エージェント CLI が選ばれている', async () => {
    render(<App />)
    await userEvent.click(panelButton('settings'))
    const group = await screen.findByRole('radiogroup', { name: 'プロンプトの実行方式' })
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: /^エージェント CLI/ })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )
  })

  it('設定に使うエージェント CLI を出して保存された種類を選び、帯の 起動 の名前もその種類にする', async () => {
    window.api.getAgentCliKind = vi.fn().mockResolvedValue({ kind: 'copilot', fallback: null })
    render(<App />)
    expect(
      await screen.findByRole('button', { name: '起動（開いているフォルダで copilot を起動）' })
    ).toBeInTheDocument()
    await userEvent.click(panelButton('settings'))
    const group = await screen.findByRole('radiogroup', { name: '使うエージェント CLI' })
    await waitFor(() =>
      expect(
        within(group).getByRole('radio', { name: 'GitHub Copilot CLI（copilot）' })
      ).toHaveAttribute('aria-checked', 'true')
    )
  })

  it('セッションが無い間は実行ボタンを押せず、理由を出し、実行ツールの選択を出さない', async () => {
    window.api.loadPrompts = vi.fn().mockResolvedValue([prompt])
    render(<App />)
    await userEvent.click(panelButton('prompts'))
    const runButton = await screen.findByRole('button', { name: PROMPT_RUN_ARIA_LABEL_AGENT })
    expect(runButton).toBeDisabled()
    expect(runButton).toHaveAccessibleDescription(RUN_DISABLED_NO_SESSION)
    expect(screen.queryByRole('combobox', { name: '実行ツールを選択' })).toBeNull()
  })

  it('編集中のタブのファイルがディスク上で変わったら、通知の帯を出す', async () => {
    let notifyExternalChange: (event: ExternalFileChangeEvent) => void = () => undefined
    window.api.onExternalFileChange = vi.fn(
      (listener: (event: ExternalFileChangeEvent) => void) => {
        notifyExternalChange = listener
        return () => {}
      }
    )
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi
      .fn()
      .mockResolvedValue([{ name: 'a.ts', path: '/project/a.ts', type: 'file' }])
    window.api.readFile = vi.fn().mockResolvedValue('on disk')
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
    await userEvent.click(await within(await screen.findByRole('tree')).findByText('a.ts'))
    // 編集中にする(未編集のタブは通知せずにディスクの内容で置き換える)
    fireEvent.change(await screen.findByTestId('monaco-editor-textarea'), {
      target: { value: 'typed' }
    })
    window.api.readFile = vi.fn().mockResolvedValue('changed by agent')
    act(() => notifyExternalChange({ paths: ['/project/a.ts'] }))
    expect(await screen.findByRole('button', { name: 'このまま編集する' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ディスクの内容を読み込む' })).toBeInTheDocument()
  })
})
