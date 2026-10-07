import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { GitStatusResult } from '@shared/types'
import type { AgentChangesView } from '../useAgentChanges'
import type { AgentChangesRevertOptions, AgentChangesRevertState } from '../useAgentChangesRevert'
import type { DiffTabKey } from '../useDiffTabs'
import type { FileOperationLock } from '../useFileOperationLock'

// 戻す操作の中身は useAgentChangesRevert.test.ts で確かめる。ここでは渡す値と、戻り値の組み立てだけを見る
const mockUseAgentChangesRevert = vi.hoisted(() =>
  vi.fn<(options: AgentChangesRevertOptions) => AgentChangesRevertState>()
)
vi.mock('../useAgentChangesRevert', () => ({ useAgentChangesRevert: mockUseAgentChangesRevert }))

import { useAgentChangesWiring } from '../useAgentChangesWiring'
import type { AgentChangesWiringOptions } from '../useAgentChangesWiring'
import {
  makeAgentChangeEntry,
  makeAgentChangesController,
  makeAgentChangesRecordingView,
  makeAgentChangesRevertState
} from '../../__tests__/makeAgentChangesState'

const gitStatusOf = (branch: string): GitStatusResult => ({
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: false,
  hasRemote: false,
  upstream: null,
  detached: false,
  branch,
  ahead: 0,
  behind: 0,
  files: []
})

// 既定と違う値(失敗あり・押せない)で、パネルへそのまま渡ることを確かめる
const revertState = makeAgentChangesRevertState({
  error: 'failed',
  errorPath: 'a.txt',
  hunkNotice: { text: 'ハンクを実行前の状態に戻しました', id: 3 },
  revertDisabledReason: 'busy'
})

const lock = {} as FileOperationLock

// 描画をまたいで同じ関数を使うため、options は 1 度作り、テストごとに一部を差し替えて rerender する
function makeOptions(
  overrides: Partial<AgentChangesWiringOptions> = {}
): AgentChangesWiringOptions {
  const changes = makeAgentChangesController()
  return {
    folderPath: '/repo',
    recording: { changes, beginAndRefresh: vi.fn(async () => undefined) },
    gitStatus: null,
    refreshGitStatus: vi.fn(async () => undefined),
    agentSessionExit: null,
    agentRunning: false,
    isAgentMode: true,
    diffTabs: {
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn()
    },
    refreshDiff: vi.fn(),
    fileLock: lock,
    fileSystem: {
      hasDirtyTabAtOrInside: vi.fn(() => false),
      reloadOpenFile: vi.fn(async () => undefined),
      closeTabsAtOrInside: vi.fn(),
      confirmDiscardAnyDirty: vi.fn(() => true),
      reloadOpenFiles: vi.fn(async () => undefined),
      refreshTree: vi.fn(async () => true)
    },
    showSourceControl: vi.fn(),
    ...overrides
  }
}

function setup(initial: AgentChangesWiringOptions = makeOptions()): {
  result: { current: ReturnType<typeof useAgentChangesWiring> }
  update: (overrides: Partial<AgentChangesWiringOptions>) => void
  options: () => AgentChangesWiringOptions
} {
  let options = initial
  const { result, rerender } = renderHook(
    (props: AgentChangesWiringOptions) => useAgentChangesWiring(props),
    { initialProps: options }
  )
  return {
    result,
    update: (overrides) => {
      options = { ...options, ...overrides }
      rerender(options)
    },
    options: () => options
  }
}

// 記録の写しの view だけを差し替える(begin・refresh などの関数は同じものを使い続ける)
const withView = (
  options: AgentChangesWiringOptions,
  view: AgentChangesView
): Partial<AgentChangesWiringOptions> => ({
  recording: { ...options.recording, changes: { ...options.recording.changes, view } }
})

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAgentChangesRevert.mockReturnValue(revertState)
})

describe('useAgentChangesWiring', () => {
  describe('一覧を取り直す契機', () => {
    it('git status が無い間は取り直さず、新しくなるたびに取り直す', () => {
      const { update, options } = setup()
      const refresh = options().recording.changes.refresh
      expect(refresh).not.toHaveBeenCalled()
      update({ gitStatus: gitStatusOf('main') })
      expect(refresh).toHaveBeenCalledOnce()
      // 同じ内容でも、新しいオブジェクトなら取り直す
      update({ gitStatus: gitStatusOf('main') })
      expect(refresh).toHaveBeenCalledTimes(2)
    })

    it('エージェントのセッションが終わったら取り直す(終わっていない間は取り直さない)', () => {
      const { update, options } = setup()
      const refresh = options().recording.changes.refresh
      update({ agentRunning: true })
      expect(refresh).not.toHaveBeenCalled()
      update({ agentSessionExit: { exitCode: 0, reason: 'exited' } })
      expect(refresh).toHaveBeenCalledOnce()
      // 引数なし(件数を読み上げない)
      expect(refresh).toHaveBeenCalledWith()
    })
  })

  describe('一覧から消えたパスの diff タブ', () => {
    const tabs: DiffTabKey[] = [
      { path: 'a.txt', kind: 'agent' },
      { path: 'gone.txt', kind: 'agent' },
      { path: 'gone.txt', kind: 'unstaged' }
    ]

    it('初回のマウントでは閉じない・取り直さない', () => {
      const base = makeOptions()
      const { options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      expect(options().diffTabs.closeDiffTab).not.toHaveBeenCalled()
      expect(options().refreshDiff).not.toHaveBeenCalled()
    })

    it('一覧が変わったら、消えたパスの agent のタブだけを閉じ、agent のタブを開いていれば diff を取り直す', () => {
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      update(withView(options(), makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])))
      expect(options().diffTabs.closeDiffTab).toHaveBeenCalledExactlyOnceWith(tabs[1])
      expect(options().refreshDiff).toHaveBeenCalledOnce()
    })

    it('開いている diff タブが agent でなければ、diff を取り直さない', () => {
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[2] }
      })
      update(withView(options(), makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])))
      expect(options().diffTabs.closeDiffTab).toHaveBeenCalledOnce()
      expect(options().refreshDiff).not.toHaveBeenCalled()
    })

    it('記録中で一覧をまだ取っていなければ、閉じず・取り直さない', () => {
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      update(withView(options(), makeAgentChangesRecordingView(null)))
      expect(options().diffTabs.closeDiffTab).not.toHaveBeenCalled()
      expect(options().refreshDiff).not.toHaveBeenCalled()
    })

    it('記録が無くなったら、agent のタブをすべて閉じる', () => {
      const base = makeOptions({
        recording: {
          changes: makeAgentChangesController({
            view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
          }),
          beginAndRefresh: vi.fn(async () => undefined)
        }
      })
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs }
      })
      update(withView(options(), { kind: 'none' }))
      expect(vi.mocked(options().diffTabs.closeDiffTab).mock.calls).toEqual([[tabs[0]], [tabs[1]]])
    })
  })

  it('戻す操作(useAgentChangesRevert)に、記録の写し・ロック・タブとツリーの同期の操作を渡す', () => {
    const { options } = setup(makeOptions({ agentRunning: true }))
    const o = options()
    expect(mockUseAgentChangesRevert).toHaveBeenLastCalledWith({
      folderPath: '/repo',
      changes: o.recording.changes,
      fileLock: lock,
      agentRunning: true,
      ...o.fileSystem,
      refreshGitStatus: o.refreshGitStatus,
      refreshDiff: o.refreshDiff
    })
  })

  describe('diff タブのハンクの操作(agentDiffActions)', () => {
    it('開いている agent のタブの行が変更ならハンクで戻せ、理由とエラーは戻す操作のものを渡す', () => {
      const base = makeOptions({
        recording: {
          changes: makeAgentChangesController({
            view: makeAgentChangesRecordingView([
              makeAgentChangeEntry('a.txt'),
              makeAgentChangeEntry('b.txt', { status: 'A' })
            ])
          }),
          beginAndRefresh: vi.fn(async () => undefined)
        }
      })
      const { result, update } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, activeDiffTab: { path: 'a.txt', kind: 'agent' } }
      })
      expect(result.current.agentDiffActions).toMatchObject({
        canRevertHunk: true,
        disabledReason: 'busy',
        error: 'failed'
      })
      update({ diffTabs: { ...base.diffTabs, activeDiffTab: { path: 'b.txt', kind: 'agent' } } })
      expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
    })

    // 失敗はそのパスのタブにだけ出す(PR #47 B-1: b.txt の失敗を a.txt のタブに出さない)
    it.each<[string, string | null, string, string | null]>([
      ['同じパスのタブなら出す', 'a.txt', 'a.txt', 'failed'],
      ['別のパスのタブには出さない', 'b.txt', 'a.txt', null],
      ['「すべて戻す」の失敗(パスなし)は出さない', null, 'a.txt', null],
      ['フォルダの行の失敗は、末尾の / を除いて照合する', 'dir/', 'dir', 'failed']
    ])('失敗は、%s', (_label, errorPath, tabPath, expected) => {
      mockUseAgentChangesRevert.mockReturnValue({ ...revertState, errorPath })
      const base = makeOptions()
      const { result } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, activeDiffTab: { path: tabPath, kind: 'agent' } }
      })
      expect(result.current.agentDiffActions.error).toBe(expected)
    })

    it('ハンクを戻した結果の読み上げは、開いているタブを問わず渡す(最後のハンクでタブが閉じても届く)', () => {
      const { result } = setup()
      expect(result.current.agentDiffActions.notice).toEqual({
        text: 'ハンクを実行前の状態に戻しました',
        id: 3
      })
    })

    it('ハンクを戻すと、開いている agent のタブのパスで戻す', () => {
      const base = makeOptions()
      const { result } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, activeDiffTab: { path: 'a.txt', kind: 'agent' } }
      })
      result.current.agentDiffActions.onRevertHunk('patch', '@@ -1 +1 @@')
      expect(revertState.revertHunk).toHaveBeenCalledExactlyOnceWith(
        'a.txt',
        'patch',
        '@@ -1 +1 @@'
      )
    })

    it('agent のタブを開いていなければ、ハンクを戻さない・戻せない', () => {
      const base = makeOptions()
      const { result } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, activeDiffTab: { path: 'a.txt', kind: 'unstaged' } }
      })
      expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
      result.current.agentDiffActions.onRevertHunk('patch', '@@ -1 +1 @@')
      expect(revertState.revertHunk).not.toHaveBeenCalled()
    })
  })

  describe('ターミナルの帯の「変更を確認」(agentChangesReview)', () => {
    it('記録中かを渡す', () => {
      const { result, update, options } = setup()
      expect(result.current.agentChangesReview.isRecording).toBe(false)
      update(withView(options(), makeAgentChangesRecordingView(null)))
      expect(result.current.agentChangesReview.isRecording).toBe(true)
    })

    it('ソース管理パネルを開き、フォーカスを依頼し、git status と一覧(読み上げつき)を取り直す', () => {
      const { result, options } = setup()
      expect(result.current.agentChangesPanel.focusRequest.isRequested).toBe(false)
      act(() => result.current.agentChangesReview.onReview())
      expect(options().showSourceControl).toHaveBeenCalledOnce()
      expect(result.current.agentChangesPanel.focusRequest.isRequested).toBe(true)
      expect(options().refreshGitStatus).toHaveBeenCalledOnce()
      expect(options().recording.changes.refresh).toHaveBeenCalledExactlyOnceWith({
        announce: true
      })
    })

    it('セクションが受け取ったら(consume)、依頼を下ろす。consume の参照は描画をまたいで変わらない', () => {
      const { result } = setup()
      const consume = result.current.agentChangesPanel.focusRequest.consume
      act(() => result.current.agentChangesReview.onReview())
      expect(result.current.agentChangesPanel.focusRequest.consume).toBe(consume)
      act(() => consume())
      expect(result.current.agentChangesPanel.focusRequest.isRequested).toBe(false)
    })

    it('フォルダが変わっても、依頼はセクションが受け取るまで残す', () => {
      const { result, update } = setup()
      act(() => result.current.agentChangesReview.onReview())
      update({ folderPath: '/other' })
      expect(result.current.agentChangesPanel.focusRequest.isRequested).toBe(true)
    })
  })

  describe('ソース管理パネルのセクション(agentChangesPanel)', () => {
    it('記録の写しに、begin を「記録を始めてから一覧を取る」へ差し替えたものを渡す', () => {
      const { result, options } = setup(makeOptions({ isAgentMode: false }))
      const panel = result.current.agentChangesPanel
      const { changes, beginAndRefresh } = options().recording
      expect(panel.changes.begin).toBe(beginAndRefresh)
      expect(panel.changes.view).toBe(changes.view)
      expect(panel.changes.savedPaths).toBe(changes.savedPaths)
      expect(panel.changes.clear).toBe(changes.clear)
      expect(panel.revert).toBe(revertState)
      expect(panel.folderPath).toBe('/repo')
      expect(panel.isAgentMode).toBe(false)
    })

    it('「更新」は git status も取り直し、一覧の取り直し(オプションつき)の完了を返す', async () => {
      let resolveRefresh: () => void = () => undefined
      const changes = {
        ...makeAgentChangesController(),
        refresh: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveRefresh = resolve
            })
        )
      }
      const { result, options } = setup(
        makeOptions({ recording: { changes, beginAndRefresh: vi.fn(async () => undefined) } })
      )
      let settled = false
      const done = result.current.agentChangesPanel.changes.refresh({ announce: true }).then(() => {
        settled = true
      })
      expect(options().refreshGitStatus).toHaveBeenCalledOnce()
      expect(changes.refresh).toHaveBeenCalledExactlyOnceWith({ announce: true })
      await Promise.resolve()
      expect(settled).toBe(false)
      resolveRefresh()
      await done
      expect(settled).toBe(true)
    })

    it('行を開くと、agent の diff タブを開く', () => {
      const { result, options } = setup()
      result.current.agentChangesPanel.onOpenDiff('dir/a.txt')
      expect(options().diffTabs.openDiffTab).toHaveBeenCalledExactlyOnceWith({
        path: 'dir/a.txt',
        kind: 'agent'
      })
    })
  })
})
