import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangesScope, GitStatusResult } from '@shared/types'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentNotificationTab } from '../../lib/agentNotificationEvents'
import type { AgentChangesView } from '../../types'
import type { AgentChangesRevertOptions, AgentChangesRevertState } from '../useAgentChangesRevert'
import type { AgentChangesUndoOptions, AgentChangesUndoState } from '../useAgentChangesUndo'
import type { DiffTabKey } from '../useDiffTabs'
import type { FileOperationLock } from '../useFileOperationLock'

// 戻す操作の中身は useAgentChangesRevert.test.ts で確かめる。ここでは渡す値と、戻り値の組み立てだけを見る
const mockUseAgentChangesRevert = vi.hoisted(() =>
  vi.fn<(options: AgentChangesRevertOptions) => AgentChangesRevertState>()
)
vi.mock('../useAgentChangesRevert', () => ({ useAgentChangesRevert: mockUseAgentChangesRevert }))
// 取り消しの中身は useAgentChangesUndo.test.ts で確かめる。ここでは渡す値と、パネルへの受け渡しだけを見る
const mockUseAgentChangesUndo = vi.hoisted(() =>
  vi.fn<(options: AgentChangesUndoOptions) => AgentChangesUndoState>()
)
vi.mock('../useAgentChangesUndo', () => ({ useAgentChangesUndo: mockUseAgentChangesUndo }))

import { useAgentChangesWiring } from '../useAgentChangesWiring'
import type { AgentChangesWiringOptions } from '../useAgentChangesWiring'
import { AUTO_REFRESH_WAIT_MS } from '../useAgentChangesAutoRefresh'
import {
  makeAgentChangeEntry,
  makeAgentChangesController,
  makeAgentChangesRecordingView,
  makeAgentChangesRevertState,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableView,
  makeAgentChangesUndoState
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

// 既定と違う値(押せない)で、パネルへそのまま渡ることを確かめる
const undoState = makeAgentChangesUndoState({ undoDisabledReason: 'busy' })

const lock = {} as FileOperationLock

// 記録の束(useAgentChangesRecording の戻り値)。既定は makeAgentChangesController の既定と、resolve する begin の vi.fn。
// 束の形が変わっても、写しや操作だけを差し替えたいテストを個別に直さずに済むようにする
function makeRecording(
  changes: AgentChangesWiringOptions['recording']['changes'] = makeAgentChangesController()
): AgentChangesWiringOptions['recording'] {
  return {
    changes,
    beginForSendAndRefresh: vi.fn(async () => undefined),
    beginManuallyAndRefresh: vi.fn(async () => undefined)
  }
}

// 描画をまたいで同じ関数を使うため、options は 1 度作り、テストごとに一部を差し替えて rerender する
function makeOptions(
  overrides: Partial<AgentChangesWiringOptions> = {}
): AgentChangesWiringOptions {
  return {
    folderPath: '/repo',
    recording: makeRecording(),
    gitStatus: null,
    refreshGitStatus: vi.fn(async () => undefined),
    wasGitStatusSetQuietly: () => false,
    agentSessionExit: null,
    agentRunning: false,
    agentTabs: [],
    agentActivities: new Map(),
    isAgentMode: true,
    cliKind: 'claude',
    diffTabs: {
      diffTabs: [],
      activeDiffTab: null,
      openDiffTab: vi.fn(),
      closeDiffTab: vi.fn()
    },
    refreshDiff: vi.fn(),
    agentDiffScope: { kind: 'all' },
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
  mockUseAgentChangesUndo.mockReturnValue(undoState)
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

    it('静かな取り直しが置いた git status → 一覧も静かに取り直す({ quiet: true })。通常の取得が置いたもの → 引数無し', () => {
      let setQuietly = true
      const { update, options } = setup(makeOptions({ wasGitStatusSetQuietly: () => setQuietly }))
      const refresh = options().recording.changes.refresh
      update({ gitStatus: gitStatusOf('main') })
      expect(refresh).toHaveBeenLastCalledWith({ quiet: true })
      setQuietly = false
      update({ gitStatus: gitStatusOf('dev') })
      expect(refresh).toHaveBeenLastCalledWith()
      expect(refresh).toHaveBeenCalledTimes(2)
    })

    it('いずれかのタブのセッションが終わったら取り直す(終わっていない間は取り直さない)', () => {
      const { update, options } = setup()
      const refresh = options().recording.changes.refresh
      update({ agentRunning: true })
      expect(refresh).not.toHaveBeenCalled()
      update({ agentSessionExit: { sessionId: 's-2', exitCode: 0, reason: 'exited' } })
      expect(refresh).toHaveBeenCalledOnce()
      // 引数なし(件数を読み上げない)
      expect(refresh).toHaveBeenCalledWith()
    })

    describe('自動の取り直し(エージェントの活動の出来事)', () => {
      const tab: AgentNotificationTab = {
        slotId: 's1',
        number: 1,
        status: 'running',
        isClosing: false,
        cliKind: 'claude'
      }
      const activitiesOf = (activity: AgentActivity): ReadonlyMap<string, AgentActivity> =>
        new Map([['s1', activity]])

      beforeEach(() => {
        vi.useFakeTimers()
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('記録中に活動が完了になると、待ちの後に一覧だけを読み上げずに取り直す(git status は取り直さない)', async () => {
        const initial = makeOptions({ agentTabs: [tab], agentActivities: activitiesOf('working') })
        const { update, options } = setup({
          ...initial,
          ...withView(initial, makeAgentChangesRecordingView([]))
        })
        update({ agentActivities: activitiesOf('idle') })
        await act(async () => {
          vi.advanceTimersByTime(AUTO_REFRESH_WAIT_MS)
        })
        expect(options().recording.changes.refresh).toHaveBeenCalledExactlyOnceWith({
          announce: false,
          quiet: true
        })
        expect(options().refreshGitStatus).not.toHaveBeenCalled()
      })

      it('記録が無い間は、活動が完了になっても取り直さない', async () => {
        const { update, options } = setup(
          makeOptions({ agentTabs: [tab], agentActivities: activitiesOf('working') })
        )
        update({ agentActivities: activitiesOf('idle') })
        await act(async () => {
          vi.advanceTimersByTime(AUTO_REFRESH_WAIT_MS * 10)
        })
        expect(options().recording.changes.refresh).not.toHaveBeenCalled()
      })
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

    it('範囲の一覧が取れなくなったら、タブは閉じずに、開いている agent の diff を取り直す(前の範囲の内容を残さない)', () => {
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      update(
        withView(
          options(),
          makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 2 }, 'end-not-recorded')
        )
      )
      expect(options().diffTabs.closeDiffTab).not.toHaveBeenCalled()
      expect(options().refreshDiff).toHaveBeenCalledExactlyOnceWith()
    })

    // 静かな取り直し(自動の取り直し)の完了は quietRefreshCount が進むことで分かる。一覧が同じ(写しの参照が同じ)でも、
    // 同じファイルの続きの変更を出すため、開いている agent の diff を静かに取り直す
    const withQuietRefresh = (
      options: AgentChangesWiringOptions,
      count: number,
      view: AgentChangesView = options.recording.changes.view
    ): Partial<AgentChangesWiringOptions> => ({
      recording: {
        ...options.recording,
        changes: { ...options.recording.changes, view, quietRefreshCount: count }
      }
    })

    it('静かな取り直しが終わったら、一覧が同じでも agent の diff を静かに取り直す(タブは閉じない)', () => {
      const listed = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        ...withView(base, listed),
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      update(withQuietRefresh(options(), 1))
      expect(options().refreshDiff).toHaveBeenCalledExactlyOnceWith({ quiet: true })
      expect(options().diffTabs.closeDiffTab).not.toHaveBeenCalled()
      update(withQuietRefresh(options(), 2))
      expect(options().refreshDiff).toHaveBeenCalledTimes(2)
      expect(options().refreshDiff).toHaveBeenLastCalledWith({ quiet: true })
    })

    it('静かな取り直しで一覧も変わったら、消えたパスのタブを閉じ、diff は静かに 1 回だけ取り直す', () => {
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      update(
        withQuietRefresh(
          options(),
          1,
          makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
        )
      )
      expect(options().diffTabs.closeDiffTab).toHaveBeenCalledExactlyOnceWith(tabs[1])
      expect(options().refreshDiff).toHaveBeenCalledExactlyOnceWith({ quiet: true })
    })

    it('静かな取り直しが終わっても、開いている diff タブが agent でなければ取り直さない', () => {
      const listed = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        ...withView(base, listed),
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[2] }
      })
      update(withQuietRefresh(options(), 1))
      expect(options().refreshDiff).not.toHaveBeenCalled()
    })

    it('範囲の一覧が取れないまま静かな取り直しが終わったら、タブは閉じずに agent の diff を静かに取り直す', () => {
      const unavailable = makeAgentChangesScopeUnavailableView(
        { kind: 'run', runId: 2 },
        'end-not-recorded'
      )
      const base = makeOptions()
      const { update, options } = setup({
        ...base,
        ...withView(base, unavailable),
        diffTabs: { ...base.diffTabs, diffTabs: tabs, activeDiffTab: tabs[0] }
      })
      update(withQuietRefresh(options(), 1))
      expect(options().refreshDiff).toHaveBeenCalledExactlyOnceWith({ quiet: true })
      expect(options().diffTabs.closeDiffTab).not.toHaveBeenCalled()
    })

    it('記録が無くなったら、agent のタブをすべて閉じる', () => {
      const base = makeOptions({
        recording: makeRecording(
          makeAgentChangesController({
            view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
          })
        )
      })
      const { update, options } = setup({
        ...base,
        diffTabs: { ...base.diffTabs, diffTabs: tabs }
      })
      update(withView(options(), { kind: 'none' }))
      expect(vi.mocked(options().diffTabs.closeDiffTab).mock.calls).toEqual([[tabs[0]], [tabs[1]]])
    })
  })

  it('設定の種類(cliKind)をセクションの状態と戻す操作に渡す(省略できない。L-060)', () => {
    const { result } = setup(makeOptions({ cliKind: 'copilot' }))
    expect(result.current.agentChangesPanel.cliKind).toBe('copilot')
    expect(mockUseAgentChangesRevert).toHaveBeenLastCalledWith(
      expect.objectContaining({ cliKind: 'copilot' })
    )
  })

  it('戻す操作(useAgentChangesRevert)に、記録の写し・ロック・タブとツリーの同期の操作を渡す', () => {
    const { options } = setup(makeOptions({ agentRunning: true }))
    const o = options()
    expect(mockUseAgentChangesRevert).toHaveBeenLastCalledWith({
      folderPath: '/repo',
      changes: o.recording.changes,
      fileLock: lock,
      agentRunning: true,
      hasDirtyTabAtOrInside: o.fileSystem.hasDirtyTabAtOrInside,
      reloadOpenFile: o.fileSystem.reloadOpenFile,
      closeTabsAtOrInside: o.fileSystem.closeTabsAtOrInside,
      confirmDiscardAnyDirty: o.fileSystem.confirmDiscardAnyDirty,
      reloadOpenFiles: o.fileSystem.reloadOpenFiles,
      refreshAfterWrite: expect.any(Function),
      runner: expect.objectContaining({ run: expect.any(Function), runningOperation: null }),
      cliKind: 'claude'
    })
  })

  it('書き換えの後の取り直し(refreshAfterWrite)は、ツリー → git status → 一覧 → diff タブの順に取り直し、戻す操作と取り消しに同じものを渡す', async () => {
    const { options } = setup(makeOptions())
    const o = options()
    const refreshAfterWrite = mockUseAgentChangesRevert.mock.lastCall![0].refreshAfterWrite
    expect(mockUseAgentChangesUndo.mock.lastCall![0].refreshAfterWrite).toBe(refreshAfterWrite)
    vi.mocked(o.refreshGitStatus).mockClear()
    vi.mocked(o.recording.changes.refresh).mockClear()
    vi.mocked(o.refreshDiff).mockClear()
    await act(async () => {
      await refreshAfterWrite()
    })
    const order = [
      o.fileSystem.refreshTree,
      o.refreshGitStatus,
      o.recording.changes.refresh,
      o.refreshDiff
    ].map((fn) => {
      expect(fn).toHaveBeenCalledOnce()
      return vi.mocked(fn).mock.invocationCallOrder[0]
    })
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // 一覧の取り直しは読み上げない・diff タブは静かな取り直しにしない(戻す操作の hook が持っていたときと同じ引数)
    expect(o.recording.changes.refresh).toHaveBeenCalledWith()
    expect(o.refreshDiff).toHaveBeenCalledWith()
  })

  it('取り消しの hook に、戻す操作と同じ runner・ロック・写しとタブの操作を渡し、パネルへ戻り値をそのまま渡す', () => {
    const { result, options } = setup(makeOptions({ agentRunning: true }))
    const o = options()
    const undoOptions = mockUseAgentChangesUndo.mock.lastCall![0]
    expect(undoOptions).toEqual({
      folderPath: '/repo',
      changes: o.recording.changes,
      runner: mockUseAgentChangesRevert.mock.lastCall![0].runner,
      fileLock: lock,
      agentRunning: true,
      hasDirtyTabAtOrInside: o.fileSystem.hasDirtyTabAtOrInside,
      reloadOpenFile: o.fileSystem.reloadOpenFile,
      closeTabsAtOrInside: o.fileSystem.closeTabsAtOrInside,
      refreshAfterWrite: mockUseAgentChangesRevert.mock.lastCall![0].refreshAfterWrite
    })
    // 同じ runner(実行中の印・失敗の表示・全体ロックを共有する)を参照で渡す
    expect(undoOptions.runner).toBe(mockUseAgentChangesRevert.mock.lastCall![0].runner)
    expect(result.current.agentChangesPanel.undo).toBe(undoState)
  })

  describe('diff タブのハンクの操作(agentDiffActions)', () => {
    it('diff の内容の範囲が実行なら、その実行の番号を contentRunNumber に渡す(累積・無いなら null)', () => {
      const runs = [makeAgentChangesRun({ runId: 5, number: 2 })]
      const base = makeOptions({
        recording: makeRecording(
          makeAgentChangesController({
            view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { runs })
          })
        ),
        agentDiffScope: { kind: 'run', runId: 5 }
      })
      const { result, update } = setup(base)
      expect(result.current.agentDiffActions.contentRunNumber).toBe(2)
      update({ agentDiffScope: { kind: 'all' } })
      expect(result.current.agentDiffActions.contentRunNumber).toBeNull()
      update({ agentDiffScope: null })
      expect(result.current.agentDiffActions.contentRunNumber).toBeNull()
    })

    it('開いている agent のタブの行が変更ならハンクで戻せ、理由とエラーは戻す操作のものを渡す', () => {
      const base = makeOptions({
        recording: makeRecording(
          makeAgentChangesController({
            view: makeAgentChangesRecordingView([
              makeAgentChangeEntry('a.txt'),
              makeAgentChangeEntry('b.txt', { status: 'A' })
            ])
          })
        )
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
        '@@ -1 +1 @@',
        { kind: 'all' }
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

    it.each<[string, AgentChangesScope | null]>([
      ['実行の範囲', { kind: 'run', runId: 2 }],
      ['まだ取っていない(null)', null]
    ])(
      'diff の内容の範囲が %s なら、ハンクを戻せず、押しても戻さない',
      (_label, agentDiffScope) => {
        const base = makeOptions({
          recording: makeRecording(
            makeAgentChangesController({
              view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
            })
          ),
          agentDiffScope
        })
        const { result } = setup({
          ...base,
          diffTabs: { ...base.diffTabs, activeDiffTab: { path: 'a.txt', kind: 'agent' } }
        })
        expect(result.current.agentDiffActions.canRevertHunk).toBe(false)
        result.current.agentDiffActions.onRevertHunk('patch', '@@ -1 +1 @@')
        expect(revertState.revertHunk).not.toHaveBeenCalled()
      }
    )
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
      const { changes, beginManuallyAndRefresh } = options().recording
      expect(panel.changes.begin).toBe(beginManuallyAndRefresh)
      expect(panel.changes.view).toBe(changes.view)
      expect(panel.changes.savedPaths).toBe(changes.savedPaths)
      expect(panel.changes.clear).toBe(changes.clear)
      expect(panel.changes.scope).toBe(changes.scope)
      expect(panel.changes.selectScope).toBe(changes.selectScope)
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
        makeOptions({
          recording: makeRecording(changes)
        })
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
