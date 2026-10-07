import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentChangesListResult, GitStatusResult } from '@shared/types'
import type { Panel } from '../../types'

// jsdom では xterm を開けないため、文書ごとの controller を偽物にする(App.agentCli.test.tsx と同じ)
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeController } = await import('../../__tests__/makeFakeAgentTerminal')
  const controller = makeFakeController()
  return { getAgentTerminalController: () => controller }
})

import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'
import {
  makeAgentChangeEntry,
  makeAgentChangesListResult
} from '../../__tests__/makeAgentChangesState'

// App → Sidebar → SourceControlPanel → GitRepoView → AgentChangesSection と、App → EditorPanel → DiffView・AgentTerminalPanel の
// エージェントの変更の配線を、末端の表示と IPC の呼び出しで確かめる(どれも省略可能な props。パターン 155)

const repoStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

const listedStartedAt = new Date(2026, 9, 7, 10, 42).getTime()
const listed: AgentChangesListResult = makeAgentChangesListResult(
  [makeAgentChangeEntry('a.txt'), makeAgentChangeEntry('new.txt', { status: 'A' })],
  { startedAt: listedStartedAt }
)

const panelButton = (panel: Panel): HTMLElement => {
  const config = activityBarPanels.find((p) => p.panel === panel)
  if (config === undefined) throw new Error(`panel config not found: ${panel}`)
  return screen.getByTitle(config.title)
}

const section = (): HTMLElement => screen.getByRole('region', { name: /^エージェントの変更/ })

async function openRepository(): Promise<void> {
  render(<App />)
  await userEvent.click(screen.getByRole('button', { name: 'フォルダを開く' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'フォルダを変更' })).toBeInTheDocument()
  )
}

describe('App: エージェントの変更の配線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    window.api.getGitStatus = vi.fn().mockResolvedValue(repoStatus)
    window.api.getLog = vi.fn().mockResolvedValue([])
    window.api.getBranches = vi.fn().mockResolvedValue([])
    window.api.getTags = vi.fn().mockResolvedValue([])
    window.api.getStashes = vi.fn().mockResolvedValue([])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue({ kind: 'recording', startedAt: listedStartedAt })
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listed)
    window.api.clearAgentChanges = vi.fn().mockResolvedValue(undefined)
    window.api.getAgentChangeDiff = vi
      .fn()
      .mockResolvedValue(
        'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
      )
    window.api.revertAgentChange = vi.fn().mockResolvedValue(undefined)
    window.api.revertAgentChangeHunk = vi.fn().mockResolvedValue(undefined)
    window.confirm = vi.fn().mockReturnValue(true)
  })

  it('ソース管理のセクションで記録を始め、一覧の行から diff タブを開き、ファイル・ハンクを戻す', async () => {
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    await userEvent.click(
      await within(section()).findByRole('button', { name: 'いまから記録する' })
    )
    expect(window.api.beginAgentChanges).toHaveBeenCalledOnce()
    expect(
      await within(section()).findByRole('button', { name: 'a.txt のエージェントの変更を表示' })
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'a.txt のエージェントの変更を表示' }))
    expect(
      await screen.findByRole('tab', { name: /a\.txt \(エージェントの変更\)/ })
    ).toBeInTheDocument()
    expect(window.api.getAgentChangeDiff).toHaveBeenCalledWith('a.txt')
    // agentDiffActions が渡らないと、既存の「このハンクをステージ」が出る(Task 14 の申し送り)
    expect(screen.queryByRole('button', { name: /このハンクをステージ/ })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'このハンクを実行前に戻す' }))
    expect(window.api.revertAgentChangeHunk).toHaveBeenCalledWith(
      'a.txt',
      expect.stringContaining('@@ -1 +1 @@')
    )

    await userEvent.click(screen.getByRole('button', { name: 'new.txt をゴミ箱へ移動' }))
    expect(window.confirm).toHaveBeenLastCalledWith(
      'new.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）'
    )
    expect(window.api.revertAgentChange).toHaveBeenCalledWith('new.txt')
  })

  it('ターミナルの帯の「変更を確認」で、ソース管理パネルへ切り替えて一覧を取り直し、セクションの見出しへフォーカスを移す', async () => {
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue({ kind: 'recording', startedAt: listedStartedAt })
    await openRepository()
    const review = await screen.findByRole('button', {
      name: 'エージェントの変更を確認（ソース管理を開く）'
    })
    await userEvent.click(review)
    const heading = await within(section()).findByRole('button', {
      name: /エージェントの変更 \(2\)（10:42 から）/
    })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(window.api.listAgentChanges).toHaveBeenCalled()
  })

  it('Git 管理外のフォルダでは、セクションに理由を出す', async () => {
    window.api.getGitStatus = vi.fn().mockResolvedValue({ ...repoStatus, isRepo: false })
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    expect(
      await within(section()).findByText(
        'Git 管理外のフォルダでは、エージェントの変更を記録できません'
      )
    ).toBeInTheDocument()
  })

  // 従来の方式では記録がある間だけセクションを出すため、「確認を終える」でセクションごと消える。フォーカスを body に落とさず、
  // ソース管理のツールバーの「更新」へ移す(Task 16 の申し送り。パターン 86・152)
  it('従来の方式で「確認を終える」を押すと、ソース管理の「更新」へフォーカスを移す', async () => {
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('legacy')
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue({ kind: 'recording', startedAt: listedStartedAt })
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    await userEvent.click(await within(section()).findByRole('button', { name: '確認を終える' }))
    expect(window.api.clearAgentChanges).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: /^エージェントの変更/ })).toBeNull()
    )
    await waitFor(() => expect(screen.getByRole('button', { name: '更新' })).toHaveFocus())
  })
})
