import { describe, it, expect, vi } from 'vitest'
import {
  makeAgentChangeEntry,
  makeAgentChangesList,
  makeAgentChangesRecordingView,
  makeAgentChangesListResult,
  makeAgentChangesLostSummary,
  makeAgentChangesController,
  makeAgentChangesRevertState,
  makeAgentChangesPanelState,
  makeAgentChangesPanelChanges,
  makeAgentChangesRun,
  makeAgentChangesRecordingState,
  makeAgentChangesScopeUnavailableView,
  makeAgentChangesScopeUnavailableListResult,
  makeAgentChangesTrackingSummary,
  makeAgentChangesUndoResult,
  makeAgentChangesUndoState,
  makeAgentChangesUndoSummary,
  makeAgentDiffActions,
  makeAgentRevertAllResult,
  makeAgentRevertResult
} from '../makeAgentChangesState'

describe('makeAgentChangeEntry', () => {
  it('既定は status M・ファイル・記録済み', () => {
    expect(makeAgentChangeEntry('a.txt')).toEqual({
      path: 'a.txt',
      status: 'M',
      isDirectory: false,
      notRecorded: false,
      author: null
    })
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentChangeEntry('dir/', { status: 'A', isDirectory: true })).toEqual({
      path: 'dir/',
      status: 'A',
      isDirectory: true,
      notRecorded: false,
      author: null
    })
  })
})

describe('makeAgentChangesList', () => {
  it('既定は totalCount が entries の数・打ち切りなし・HEAD は変わっていない', () => {
    const entries = [makeAgentChangeEntry('a.txt'), makeAgentChangeEntry('b.txt')]
    expect(makeAgentChangesList(entries)).toEqual({
      entries,
      totalCount: 2,
      truncated: false,
      headChanged: false
    })
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentChangesList([], { totalCount: 600, truncated: true })).toEqual({
      entries: [],
      totalCount: 600,
      truncated: true,
      headChanged: false
    })
  })
})

describe('makeAgentChangesRecordingView', () => {
  it('既定は startedAt 100 の記録中で、一覧は makeAgentChangesList の既定', () => {
    const entries = [makeAgentChangeEntry('a.txt')]
    expect(makeAgentChangesRecordingView(entries)).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      list: {
        kind: 'listed',
        scope: { kind: 'all' },
        entries,
        totalCount: 1,
        truncated: false,
        headChanged: false
      },
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository'
    })
  })

  it('entries が null なら一覧を取っていない記録中', () => {
    expect(makeAgentChangesRecordingView(null, { startedAt: 1 })).toEqual({
      kind: 'recording',
      startedAt: 1,
      runs: [],
      list: null,
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository'
    })
  })

  it('startedAt と一覧の項目を上書きする', () => {
    expect(
      makeAgentChangesRecordingView([], { startedAt: 5, totalCount: 9, headChanged: true })
    ).toEqual({
      kind: 'recording',
      startedAt: 5,
      runs: [],
      list: {
        kind: 'listed',
        scope: { kind: 'all' },
        entries: [],
        totalCount: 9,
        truncated: false,
        headChanged: true
      },
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository'
    })
  })

  it('取り消しの控えの要約を上書きする', () => {
    const undo = makeAgentChangesUndoSummary()
    expect(makeAgentChangesRecordingView([], { undo })).toMatchObject({ undo })
  })
})

describe('makeAgentChangesRecordingState', () => {
  it('既定は startedAt 100・実行なしの記録中の状態', () => {
    expect(makeAgentChangesRecordingState()).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository'
    })
  })

  it('startedAt と実行の一覧を上書きする', () => {
    const run = makeAgentChangesRun({ runId: 2 })
    expect(makeAgentChangesRecordingState({ startedAt: 5, runs: [run] })).toEqual({
      kind: 'recording',
      startedAt: 5,
      runs: [run],
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository'
    })
  })

  it('取り消しの控えの要約を上書きする', () => {
    const undo = makeAgentChangesUndoSummary()
    expect(makeAgentChangesRecordingState({ undo })).toMatchObject({ undo })
  })
})

describe('makeAgentChangesScopeUnavailableView', () => {
  it('既定は startedAt 100・実行なしで、一覧は範囲と理由を持つ scope-unavailable', () => {
    expect(
      makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 2 }, 'end-not-recorded')
    ).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      list: {
        kind: 'scope-unavailable',
        scope: { kind: 'run', runId: 2 },
        reason: 'end-not-recorded'
      },
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository'
    })
  })

  it('取り消しの控えの要約を上書きする', () => {
    const undo = makeAgentChangesUndoSummary()
    expect(
      makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 1 }, 'end-not-recorded', { undo })
    ).toMatchObject({ undo })
  })

  it('startedAt と実行の一覧を上書きする', () => {
    const run = makeAgentChangesRun()
    expect(
      makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 1 }, 'start-not-recorded', {
        startedAt: 1,
        runs: [run]
      })
    ).toMatchObject({ startedAt: 1, runs: [run] })
  })
})

describe('makeAgentChangesListResult', () => {
  it('既定は startedAt 100 の recording で、一覧は makeAgentChangesList の既定', () => {
    const entries = [makeAgentChangeEntry('a.txt')]
    expect(makeAgentChangesListResult(entries)).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository',
      scope: { kind: 'all' },
      entries,
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentChangesListResult([], { startedAt: 7, truncated: true })).toEqual({
      kind: 'recording',
      startedAt: 7,
      runs: [],
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository',
      scope: { kind: 'all' },
      entries: [],
      totalCount: 0,
      truncated: true,
      headChanged: false
    })
  })
})

describe('makeAgentChangesController', () => {
  it('既定は記録なし・読み込みなし・失敗なし・通知なし・保存したパスなしで、操作は resolve するモック', async () => {
    const controller = makeAgentChangesController()
    expect(controller).toMatchObject({
      view: { kind: 'none' },
      isLoading: false,
      isBeginning: false,
      listError: null,
      notice: null,
      quietRefreshCount: 0
    })
    expect(controller.savedPaths.size).toBe(0)
    for (const fn of [controller.refresh, controller.clear]) {
      expect(vi.isMockFunction(fn)).toBe(true)
      await expect(fn()).resolves.toBeUndefined()
    }
    await expect(controller.begin('manual')).resolves.toBeUndefined()
    expect(controller.scope).toEqual({ kind: 'all' })
    expect(vi.isMockFunction(controller.selectScope)).toBe(true)
    expect(vi.isMockFunction(controller.markSaved)).toBe(true)
    expect(vi.isMockFunction(controller.announce)).toBe(true)
    expect(vi.isMockFunction(controller.applyUndoSummary)).toBe(true)
  })

  it('呼ぶたびに別のモックを作る(テスト間で呼び出しの記録を共有しない)', () => {
    expect(makeAgentChangesController().begin).not.toBe(makeAgentChangesController().begin)
  })

  it('指定した項目だけを上書きする', () => {
    const view = makeAgentChangesRecordingView(null)
    const controller = makeAgentChangesController({ view, listError: 'failed' })
    expect(controller.view).toBe(view)
    expect(controller.listError).toBe('failed')
    expect(controller.isLoading).toBe(false)
  })
})

describe('makeAgentChangesUndoState', () => {
  it('既定は押せるで、取り消しは resolve するモック', async () => {
    const state = makeAgentChangesUndoState()
    expect(state).toEqual({ undoDisabledReason: null, undoLastRevert: state.undoLastRevert })
    expect(vi.isMockFunction(state.undoLastRevert)).toBe(true)
    await expect(state.undoLastRevert()).resolves.toBeUndefined()
  })

  it('指定した項目だけを上書きする', () => {
    const undoLastRevert = vi.fn(async () => undefined)
    const state = makeAgentChangesUndoState({ undoLastRevert })
    expect(state.undoLastRevert).toBe(undoLastRevert)
    expect(state.undoDisabledReason).toBeNull()
  })
})

describe('makeAgentChangesRevertState', () => {
  it('既定は押せる・実行していない・失敗なしで、操作は resolve するモック', async () => {
    const state = makeAgentChangesRevertState()
    expect(state).toMatchObject({
      runningOperation: null,
      error: null,
      revertDisabledReason: null,
      revertAllDisabledReason: null,
      revertAllExcludedCount: 0
    })
    await expect(state.revertFile(makeAgentChangeEntry('a.txt'))).resolves.toBeUndefined()
    await expect(state.revertHunk('a.txt', 'patch', '@@', { kind: 'all' })).resolves.toBeUndefined()
    await expect(state.revertAll()).resolves.toBeUndefined()
    expect(vi.isMockFunction(state.revertFile)).toBe(true)
    expect(vi.isMockFunction(state.revertHunk)).toBe(true)
    expect(vi.isMockFunction(state.revertAll)).toBe(true)
  })

  it('指定した項目だけを上書きする', () => {
    const state = makeAgentChangesRevertState({ error: 'failed', revertDisabledReason: 'busy' })
    expect(state.error).toBe('failed')
    expect(state.revertDisabledReason).toBe('busy')
    expect(state.revertAllDisabledReason).toBeNull()
  })
})

describe('makeAgentChangesPanelState', () => {
  it('既定はエージェント CLI 方式・フォルダ /repo・フォーカスの依頼なしで、changes・revert・undo は各ファクトリの既定', () => {
    const state = makeAgentChangesPanelState()
    expect(state.isAgentMode).toBe(true)
    expect(state.folderPath).toBe('/repo')
    expect(state.focusRequest.isRequested).toBe(false)
    expect(vi.isMockFunction(state.focusRequest.consume)).toBe(true)
    expect(vi.isMockFunction(state.onOpenDiff)).toBe(true)
    expect(state.changes.view).toEqual({ kind: 'none' })
    expect(state.revert.revertDisabledReason).toBeNull()
    expect(state.undo.undoDisabledReason).toBeNull()
    expect(vi.isMockFunction(state.undo.undoLastRevert)).toBe(true)
  })

  it('指定した項目だけを上書きする', () => {
    const changes = makeAgentChangesPanelChanges({ isLoading: true })
    const state = makeAgentChangesPanelState({ changes, isAgentMode: false })
    expect(state.changes).toBe(changes)
    expect(state.isAgentMode).toBe(false)
    expect(state.folderPath).toBe('/repo')
  })
})

describe('makeAgentChangesPanelChanges', () => {
  it('begin は引数なしで resolve する vi.fn で、ほかは controller の既定。指定した項目だけを上書きする', async () => {
    const changes = makeAgentChangesPanelChanges({ isLoading: true })
    expect(vi.isMockFunction(changes.begin)).toBe(true)
    await expect(changes.begin()).resolves.toBeUndefined()
    expect(changes.isLoading).toBe(true)
    expect(changes.view).toEqual({ kind: 'none' })
  })
})

describe('makeAgentChangesRun', () => {
  it('既定は runId・number 1、開始 100、最後の実行、選べる。指定した項目だけを上書きする', () => {
    expect(makeAgentChangesRun()).toEqual({
      runId: 1,
      number: 1,
      startedAt: 100,
      endedAt: null,
      availability: { kind: 'available' }
    })
    expect(makeAgentChangesRun({ runId: 3, endedAt: 200 })).toMatchObject({
      runId: 3,
      number: 1,
      endedAt: 200
    })
  })
})

describe('makeAgentChangesScopeUnavailableListResult', () => {
  it('既定は startedAt 100・実行なしで、範囲と理由を持つ IPC の scope-unavailable の結果', () => {
    expect(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 2 }, 'run-missing')
    ).toEqual({
      kind: 'scope-unavailable',
      startedAt: 100,
      runs: [],
      undo: null,
      attribution: { kind: 'tracking', since: null, hadUnassignedSince: false },
      storage: 'repository',
      scope: { kind: 'run', runId: 2 },
      reason: 'run-missing'
    })
  })

  it('取り消しの控えの要約を上書きする', () => {
    const undo = makeAgentChangesUndoSummary()
    expect(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'run-missing', {
        undo
      })
    ).toMatchObject({ undo })
  })

  it('startedAt と実行の一覧を上書きする', () => {
    const run = makeAgentChangesRun({ runId: 3 })
    expect(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'end-not-recorded', {
        startedAt: 5,
        runs: [run]
      })
    ).toMatchObject({ startedAt: 5, runs: [run] })
  })
})

describe('makeAgentChangesUndoSummary', () => {
  it('既定は undoId 1・ファイル・a.txt の書き戻しで、指定した項目だけを上書きする', () => {
    expect(makeAgentChangesUndoSummary()).toEqual({
      undoId: 1,
      operation: 'file',
      entries: [{ path: 'a.txt', action: 'rewrite' }]
    })
    expect(makeAgentChangesUndoSummary({ undoId: 2, operation: 'all' })).toEqual({
      undoId: 2,
      operation: 'all',
      entries: [{ path: 'a.txt', action: 'rewrite' }]
    })
  })
})

describe('makeAgentRevertResult', () => {
  it('既定は控えが取れた結果と makeAgentChangesUndoSummary の既定の要約', () => {
    expect(makeAgentRevertResult()).toEqual({
      undo: { kind: 'saved' },
      undoSummary: makeAgentChangesUndoSummary()
    })
    expect(makeAgentRevertResult({ undoSummary: null })).toEqual({
      undo: { kind: 'saved' },
      undoSummary: null
    })
  })
})

describe('makeAgentRevertAllResult', () => {
  it('既定は done・1 件・控えが取れた・all の要約', () => {
    expect(makeAgentRevertAllResult()).toEqual({
      status: 'done',
      revertedCount: 1,
      undo: { kind: 'saved' },
      undoSummary: makeAgentChangesUndoSummary({ operation: 'all' })
    })
  })

  it('partial は message(既定 partial)を付け、undoSummary の null を既定で置き換えない', () => {
    expect(makeAgentRevertAllResult({ status: 'partial', undoSummary: null })).toEqual({
      status: 'partial',
      message: 'partial',
      revertedCount: 1,
      undo: { kind: 'saved' },
      undoSummary: null
    })
    expect(
      makeAgentRevertAllResult({
        status: 'partial',
        message: 'm',
        revertedCount: 3,
        undo: { kind: 'unavailable', reason: 'directory' }
      })
    ).toMatchObject({
      message: 'm',
      revertedCount: 3,
      undo: { kind: 'unavailable', reason: 'directory' }
    })
  })
})

describe('makeAgentChangesUndoResult', () => {
  it('既定は done・a.txt を書き戻した結果で、指定した項目だけを上書きする', () => {
    expect(makeAgentChangesUndoResult()).toEqual({
      status: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: [],
      undoSummary: null
    })
    expect(makeAgentChangesUndoResult({ trashedPaths: ['b.txt'] })).toEqual({
      status: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: ['b.txt'],
      undoSummary: null
    })
  })
})

describe('makeAgentDiffActions', () => {
  it('既定は戻せる・実行の番号なし・理由も失敗も通知もなしで、onRevertHunk は vi.fn', () => {
    const actions = makeAgentDiffActions()
    expect(actions).toMatchObject({
      canRevertHunk: true,
      contentRunNumber: null,
      disabledReason: null,
      error: null,
      notice: null
    })
    expect(vi.isMockFunction(actions.onRevertHunk)).toBe(true)
  })

  it('指定した項目だけを上書きする', () => {
    expect(makeAgentDiffActions({ canRevertHunk: false, contentRunNumber: 2 })).toMatchObject({
      canRevertHunk: false,
      contentRunNumber: 2,
      disabledReason: null
    })
  })
})

describe('記録の区別の要約', () => {
  it('tracking の既定は区別をまだ始めていない。指定した項目だけを上書きする', () => {
    expect(makeAgentChangesTrackingSummary()).toEqual({
      kind: 'tracking',
      since: null,
      hadUnassignedSince: false
    })
    expect(makeAgentChangesTrackingSummary({ since: 5 })).toEqual({
      kind: 'tracking',
      since: 5,
      hadUnassignedSince: false
    })
  })

  it('lost の既定は checkpoint-failed・lostAt 100・集合なし', () => {
    expect(makeAgentChangesLostSummary()).toEqual({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 100,
      hadMarks: false,
      since: null,
      hadUnassignedSince: false
    })
  })

  it('写し・状態・一覧の結果の工場は区別の要約を上書きできる', () => {
    const attribution = makeAgentChangesLostSummary({ hadMarks: true })
    expect(makeAgentChangesRecordingView([], { attribution })).toMatchObject({ attribution })
    expect(makeAgentChangesRecordingState({ attribution })).toMatchObject({ attribution })
    expect(makeAgentChangesListResult([], { attribution })).toMatchObject({ attribution })
  })
})
