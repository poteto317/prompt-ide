import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentChangesListResult, GitStatusResult } from '@shared/types'
import type { Panel } from '../../types'

// jsdom では xterm を開けないため、文書ごとのタブの置き場の controller を偽物にする(App.agentCli.test.tsx と同じ)
vi.mock('../../lib/xtermFactory', async () => {
  const { makeFakeAgentSessionTabs } = await import('../../__tests__/makeFakeAgentSessionTabs')
  const tabs = makeFakeAgentSessionTabs()
  return { getAgentSessionTabs: () => tabs }
})

import App from '../../App'
import { activityBarPanels } from '../../config/activityBarPanels'
import {
  AGENT_CHANGES_APP_STORAGE_HINT,
  AGENT_CHANGES_NONE_HINT
} from '../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesListResult,
  makeAgentChangesRecordingState,
  makeAgentChangesTrackingSummary,
  makeAgentRevertResult
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

// 設定の種類を書き換えるテストの後に、setup.ts の既定(claude)へ戻す
const originalGetAgentCliKind = window.api.getAgentCliKind

describe('App: エージェントの変更の配線', () => {
  afterEach(() => {
    window.api.getAgentCliKind = originalGetAgentCliKind
  })

  beforeEach(() => {
    vi.clearAllMocks()
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('agent-cli')
    window.api.openFolder = vi.fn().mockResolvedValue('/project')
    window.api.readDirectory = vi.fn().mockResolvedValue([])
    window.api.getGitStatus = vi.fn().mockResolvedValue(repoStatus)
    window.api.getLog = vi.fn().mockResolvedValue([])
    window.api.getHeadCommitMessage = vi.fn().mockResolvedValue(null)
    window.api.getBranches = vi.fn().mockResolvedValue([])
    window.api.getTags = vi.fn().mockResolvedValue([])
    window.api.getStashes = vi.fn().mockResolvedValue([])
    window.api.onExternalFileChange = vi.fn(() => () => {})
    window.api.getAgentChangesState = vi.fn().mockResolvedValue({ kind: 'none' })
    window.api.beginAgentChanges = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ startedAt: listedStartedAt }))
    window.api.listAgentChanges = vi.fn().mockResolvedValue(listed)
    window.api.clearAgentChanges = vi.fn().mockResolvedValue(undefined)
    window.api.getAgentChangeDiff = vi
      .fn()
      .mockResolvedValue(
        'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
      )
    window.api.revertAgentChange = vi.fn().mockResolvedValue(makeAgentRevertResult())
    window.api.revertAgentChangeHunk = vi.fn().mockResolvedValue(makeAgentRevertResult())
    window.confirm = vi.fn().mockReturnValue(true)
  })

  it('ソース管理のセクションで記録を始め、一覧の行から diff タブを開き、ファイル・ハンクを戻す', async () => {
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    await userEvent.click(
      await within(section()).findByRole('button', { name: 'いまから記録する' })
    )
    expect(window.api.beginAgentChanges).toHaveBeenCalledExactlyOnceWith('manual')
    expect(
      await within(section()).findByRole('button', { name: 'a.txt のエージェントの変更を表示' })
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'a.txt のエージェントの変更を表示' }))
    expect(
      await screen.findByRole('tab', { name: /a\.txt \(エージェントの変更\)/ })
    ).toBeInTheDocument()
    expect(window.api.getAgentChangeDiff).toHaveBeenCalledWith('a.txt', { kind: 'all' })
    // agentDiffActions が渡らないと、既存の「このハンクをステージ」が出る(Task 14 の申し送り)
    expect(screen.queryByRole('button', { name: /このハンクをステージ/ })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'このハンクを実行前に戻す' }))
    expect(window.api.revertAgentChangeHunk).toHaveBeenCalledWith(
      'a.txt',
      expect.stringContaining('@@ -1 +1 @@'),
      { kind: 'all' }
    )

    await userEvent.click(screen.getByRole('button', { name: 'new.txt をゴミ箱へ移動' }))
    expect(window.confirm).toHaveBeenLastCalledWith(
      'new.txt をゴミ箱へ移動しますか？（記録を始めた後に作られたファイルです）戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。'
    )
    expect(window.api.revertAgentChange).toHaveBeenCalledWith('new.txt', { kind: 'all' })
  })

  it('設定の種類が copilot なら、区別の状態の 1 行に精度の注記が、すべて戻すの確認に copilot の文言と精度の注記が出る(配線)', async () => {
    const PRECISION =
      'copilot では、利用者の変更との区別が claude より粗くなります（許可の確認で断ったツールの後は、そのターンが終わるまでのあなたの編集もエージェントの変更として扱います）'
    window.api.getAgentCliKind = vi.fn().mockResolvedValue({ kind: 'copilot', fallback: null })
    window.api.listAgentChanges = vi.fn().mockResolvedValue(
      makeAgentChangesListResult([makeAgentChangeEntry('a.txt')], {
        startedAt: listedStartedAt,
        attribution: makeAgentChangesTrackingSummary({ since: listedStartedAt })
      })
    )
    window.confirm = vi.fn().mockReturnValue(false)
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    await userEvent.click(
      await within(section()).findByRole('button', { name: 'いまから記録する' })
    )
    expect(await within(section()).findByText(PRECISION)).toBeInTheDocument()
    await userEvent.click(within(section()).getByRole('button', { name: 'すべて戻す' }))
    expect(window.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining(
        `copilot を起動してから最初のプロンプトを送るまで・中断（Esc）の後にあなたが編集した内容は、エージェントの変更として戻ります。${PRECISION}。`
      )
    )
  })

  // 自動の取り直し(ウィンドウの focus)は静かに取る(review 第 4 周の 1・2)。一覧が同じなら diff を作り直さず、スクロールとフォーカスを保つ。
  // 取り直しの間も戻すボタンを押せなくしない(押せなくなるとフォーカスが body に落ちる)
  describe('一覧の自動の取り直し(アプリへ戻ったとき)', () => {
    // 記録を始め、a.txt の diff タブを開いて、ハンクの「戻す」にフォーカスを置く
    async function openAgentDiffAndFocusHunk(): Promise<HTMLElement> {
      await openRepository()
      await userEvent.click(panelButton('source-control'))
      await userEvent.click(
        await within(section()).findByRole('button', { name: 'いまから記録する' })
      )
      await userEvent.click(
        await within(section()).findByRole('button', { name: 'a.txt のエージェントの変更を表示' })
      )
      const hunk = await screen.findByRole('button', { name: 'このハンクを実行前に戻す' })
      await waitFor(() => expect(hunk).toBeEnabled())
      hunk.focus()
      return hunk
    }

    function deferredList(): {
      promise: Promise<AgentChangesListResult>
      resolve: (value: AgentChangesListResult) => void
    } {
      let resolve: (value: AgentChangesListResult) => void = () => undefined
      const promise = new Promise<AgentChangesListResult>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }

    function deferredDiff(): { promise: Promise<string>; resolve: (value: string) => void } {
      let resolve: (value: string) => void = () => undefined
      const promise = new Promise<string>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }

    it('一覧が同じなら、取り直しの間も戻すボタンを押せるままにし、diff は静かに取り直して(内容が同じなら作り直さず)ハンクのフォーカスを保つ', async () => {
      const hunk = await openAgentDiffAndFocusHunk()
      const diffCalls = vi.mocked(window.api.getAgentChangeDiff).mock.calls.length
      const listCalls = vi.mocked(window.api.listAgentChanges).mock.calls.length
      const pending = deferredList()
      vi.mocked(window.api.listAgentChanges).mockReturnValueOnce(pending.promise)
      const pendingDiff = deferredDiff()
      vi.mocked(window.api.getAgentChangeDiff).mockReturnValueOnce(pendingDiff.promise)

      window.dispatchEvent(new Event('focus'))
      await waitFor(() => expect(window.api.listAgentChanges).toHaveBeenCalledTimes(listCalls + 1))
      // 取り直しの間: セクションの ↶・すべて戻す・ハンクの戻すは押せるまま、フォーカスはハンクのまま
      expect(
        within(section()).getByRole('button', { name: 'a.txt を実行前の状態に戻す' })
      ).toBeEnabled()
      expect(within(section()).getByRole('button', { name: 'すべて戻す' })).toBeEnabled()
      expect(hunk).toBeEnabled()
      expect(hunk).toHaveFocus()

      // 一覧が届くと diff を静かに取り直す。取り直しの間も読み込み中に差し替えない
      await act(async () => {
        pending.resolve(listed)
      })
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 1)
      )
      expect(screen.queryByText('読み込み中...')).toBeNull()
      expect(hunk).toBeInTheDocument()
      expect(hunk).toHaveFocus()
      // 内容が同じなら作り直さない(同じ要素のままフォーカスを保つ)
      await act(async () => {
        pendingDiff.resolve(
          'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
        )
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 1)
      expect(screen.queryByText('読み込み中...')).toBeNull()
      expect(hunk).toBeInTheDocument()
      expect(hunk).toHaveFocus()
    })

    it('一覧が同じでも、同じファイルの続きの変更は、読み込み中を挟まずに開いている diff へ反映する', async () => {
      await openAgentDiffAndFocusHunk()
      const pendingDiff = deferredDiff()
      vi.mocked(window.api.getAgentChangeDiff).mockReturnValueOnce(pendingDiff.promise)

      window.dispatchEvent(new Event('focus'))
      await waitFor(() => expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(2))
      expect(screen.queryByText('読み込み中...')).toBeNull()
      await act(async () => {
        pendingDiff.resolve(
          'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n-a\n+b\n+CONTINUED_CHANGE\n'
        )
      })
      expect(await screen.findByText(/CONTINUED_CHANGE/)).toBeInTheDocument()
      expect(screen.queryByText('読み込み中...')).toBeNull()
    })

    it('一覧が変わったら、開いている agent の diff タブを取り直す', async () => {
      await openAgentDiffAndFocusHunk()
      const diffCalls = vi.mocked(window.api.getAgentChangeDiff).mock.calls.length
      vi.mocked(window.api.listAgentChanges).mockResolvedValue(
        makeAgentChangesListResult(
          [
            makeAgentChangeEntry('a.txt'),
            makeAgentChangeEntry('new.txt', { status: 'A' }),
            makeAgentChangeEntry('b.txt')
          ],
          { startedAt: listedStartedAt }
        )
      )

      window.dispatchEvent(new Event('focus'))
      await waitFor(() =>
        expect(window.api.getAgentChangeDiff).toHaveBeenCalledTimes(diffCalls + 1)
      )
      expect(window.api.getAgentChangeDiff).toHaveBeenLastCalledWith('a.txt', { kind: 'all' })
    })
  })

  it('ターミナルの帯の「変更を確認」で、ソース管理パネルへ切り替えて一覧を取り直し、セクションの見出しへフォーカスを移す', async () => {
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ startedAt: listedStartedAt }))
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

  it('Git 管理外のフォルダでは、セクションにアプリの一時領域に記録する旨(HINT)と「いまから記録する」を出し、古い理由の文言は出さない', async () => {
    window.api.getGitStatus = vi.fn().mockResolvedValue({ ...repoStatus, isRepo: false })
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    expect(await within(section()).findByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: 'いまから記録する' })).toBeInTheDocument()
    expect(
      within(section()).queryByText('Git 管理外のフォルダでは、エージェントの変更を記録できません')
    ).toBeNull()
  })

  // GitRepoView が isNotRepository={false} を渡すことの固定(true を渡すとリポジトリの記録の前にも HINT が出てしまう)
  it('リポジトリを開いたとき、記録の前のセクションに Git 管理外の注記(HINT)は出さず、NONE_HINT と「いまから記録する」を出す', async () => {
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    expect(await within(section()).findByText(AGENT_CHANGES_NONE_HINT)).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: 'いまから記録する' })).toBeInTheDocument()
    expect(within(section()).queryByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeNull()
  })

  it('Git 管理外のフォルダからリポジトリに切り替えると、Git 管理外の注記(HINT)が消える', async () => {
    window.api.getGitStatus = vi.fn().mockResolvedValue({ ...repoStatus, isRepo: false })
    await openRepository()
    await userEvent.click(panelButton('source-control'))
    expect(await within(section()).findByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeInTheDocument()

    window.api.openFolder = vi.fn().mockResolvedValue('/repo')
    window.api.getGitStatus = vi.fn().mockResolvedValue(repoStatus)
    await userEvent.click(screen.getByRole('button', { name: 'フォルダを変更' }))
    await waitFor(() =>
      expect(within(section()).queryByText(AGENT_CHANGES_APP_STORAGE_HINT)).toBeNull()
    )
    expect(within(section()).getByText(AGENT_CHANGES_NONE_HINT)).toBeInTheDocument()
  })

  // 従来の方式では記録がある間だけセクションを出すため、「確認を終える」でセクションごと消える。フォーカスを body に落とさず、
  // ソース管理のツールバーの「更新」へ移す(Task 16 の申し送り。パターン 86・152)
  it('従来の方式で「確認を終える」を押すと、ソース管理の「更新」へフォーカスを移す', async () => {
    window.api.getPromptExecutionMode = vi.fn().mockResolvedValue('legacy')
    window.api.getAgentChangesState = vi
      .fn()
      .mockResolvedValue(makeAgentChangesRecordingState({ startedAt: listedStartedAt }))
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
