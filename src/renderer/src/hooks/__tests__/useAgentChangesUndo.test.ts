import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangesUndoResult } from '@shared/types'

vi.mock('../../lib/agentChangesApi')

import * as agentChangesApi from '../../lib/agentChangesApi'
import { useAgentChangesUndo } from '../useAgentChangesUndo'
import type { AgentChangesUndoOptions, AgentChangesUndoState } from '../useAgentChangesUndo'
import { useAgentChangesWriteRunner } from '../useAgentChangesWriteRunner'
import { recordingStartedAtOf } from '../../lib/agentChangesView'
import type { AgentChangesWriteRunner } from '../useAgentChangesWriteRunner'
import type { FileOperationLock } from '../useFileOperationLock'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_BUSY_REVERTING,
  AGENT_CHANGES_BUSY_UNDOING,
  buildAgentUndoConfirmMessage
} from '../../lib/agentChangesMessages'
import {
  makeAgentChangesController,
  makeAgentChangesRecordingView,
  makeAgentChangesUndoResult,
  makeAgentChangesUndoSummary
} from '../../__tests__/makeAgentChangesState'

const makeLock = (): FileOperationLock => ({
  isLocked: vi.fn(() => false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn(() => false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn()
})

// 実行の共有(runner)は取り消しの hook の外で作るため、テストの選択肢には含めない
type UndoTestOptions = Omit<AgentChangesUndoOptions, 'runner'>

// 実行の共有(runner)と組で描画する(useAgentChangesWiring と同じ組み立て)。runner も返し、戻す操作との共有を試す
function useUndoWithRunner(
  options: UndoTestOptions
): AgentChangesUndoState & { runner: AgentChangesWriteRunner } {
  const runner = useAgentChangesWriteRunner({
    folderPath: options.folderPath,
    recordStartedAt: recordingStartedAtOf(options.changes.view),
    fileLock: options.fileLock
  })
  return { ...useAgentChangesUndo({ ...options, runner }), runner }
}

function makeOptions(overrides: Partial<UndoTestOptions> = {}): UndoTestOptions {
  return {
    folderPath: '/repo',
    changes: makeAgentChangesController({
      view: makeAgentChangesRecordingView([], {
        startedAt: 1,
        undo: makeAgentChangesUndoSummary()
      })
    }),
    fileLock: makeLock(),
    agentRunning: false,
    hasDirtyTabAtOrInside: vi.fn(() => false),
    reloadOpenFile: vi.fn(async () => undefined),
    closeTabsAtOrInside: vi.fn(),
    refreshAfterWrite: vi.fn(async () => undefined),
    onConfirm: vi.fn(() => true),
    ...overrides
  }
}

// 解決を遅らせられる Promise
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(agentChangesApi.undoAgentChangesRevert).mockResolvedValue(makeAgentChangesUndoResult())
})

describe('useAgentChangesUndo — 押せない理由', () => {
  it('押せるなら理由は null。帯の控えは返さない(写しの view.undo が唯一の持ち主)', () => {
    const options = makeOptions()
    const { result } = renderHook(() => useUndoWithRunner(options))
    expect(result.current.undoDisabledReason).toBeNull()
    expect(result.current).not.toHaveProperty('summary')
  })

  it('他の Git 操作の実行中は押せない理由を返す', () => {
    const options = makeOptions()
    vi.mocked(options.fileLock.isAnyLocked).mockReturnValue(true)
    const { result } = renderHook(() => useUndoWithRunner(options))
    expect(result.current.undoDisabledReason).toBe(AGENT_CHANGES_BUSY_GIT)
  })
})

describe('useAgentChangesUndo — 確認', () => {
  it('確認の文言は控えの要約から作る', async () => {
    const options = makeOptions({ onConfirm: vi.fn(() => false) })
    const { result } = renderHook(() => useUndoWithRunner(options))
    await act(async () => {
      await result.current.undoLastRevert()
    })
    expect(options.onConfirm).toHaveBeenCalledExactlyOnceWith(
      buildAgentUndoConfirmMessage({
        summary: makeAgentChangesUndoSummary(),
        hasUnsavedEdits: false,
        agentRunning: false
      })
    )
  })

  it('キャンセルしたら IPC を呼ばず、ロックも取らない', async () => {
    const options = makeOptions({ onConfirm: vi.fn(() => false) })
    const { result } = renderHook(() => useUndoWithRunner(options))
    await act(async () => {
      await result.current.undoLastRevert()
    })
    expect(agentChangesApi.undoAgentChangesRevert).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(options.refreshAfterWrite).not.toHaveBeenCalled()
  })

  it.each<[string, string, boolean]>([
    ['書き戻すパスのタブに未保存の編集があれば足す', '/repo/b.txt', true],
    ['ゴミ箱へ移すパスのタブに未保存の編集があれば足す', '/repo/c.txt', true],
    ['作り直すパス(今は無い)のタブだけなら足さない', '/repo/a.txt', false]
  ])('未保存の編集は rewrite・trash のパスだけで判定する: %s', async (_label, dirty, expected) => {
    const summary = makeAgentChangesUndoSummary({
      operation: 'all',
      entries: [
        { path: 'a.txt', action: 'recreate' },
        { path: 'b.txt', action: 'rewrite' },
        { path: 'c.txt', action: 'trash' }
      ]
    })
    const options = makeOptions({
      changes: makeAgentChangesController({
        view: makeAgentChangesRecordingView([], { startedAt: 1, undo: summary })
      }),
      hasDirtyTabAtOrInside: vi.fn((path: string) => path === dirty),
      onConfirm: vi.fn(() => false)
    })
    const { result } = renderHook(() => useUndoWithRunner(options))
    await act(async () => {
      await result.current.undoLastRevert()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message.includes('エディタの未保存の編集も破棄されます。')).toBe(expected)
  })

  it.each<[string, UndoTestOptions['changes']['view']]>([
    ['写しに控えが無い', makeAgentChangesRecordingView([], { startedAt: 1, undo: null })],
    ['記録中でない', { kind: 'none' }]
  ])('%s なら確認も IPC も呼ばない(L-058)', async (_label, view) => {
    const options = makeOptions({ changes: makeAgentChangesController({ view }) })
    const { result } = renderHook(() => useUndoWithRunner(options))
    await act(async () => {
      await result.current.undoLastRevert()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.undoAgentChangesRevert).not.toHaveBeenCalled()
  })
})

describe('useAgentChangesUndo — 実行', () => {
  it('成功: undoId で依頼し、結果の undoSummary を unlockGlobal より前に反映し、タブを同期して読み上げ、取り直す', async () => {
    // 失敗のときの null の反映と区別できるよう、結果に要約を入れる
    const resultSummary = makeAgentChangesUndoSummary({ undoId: 2 })
    vi.mocked(agentChangesApi.undoAgentChangesRevert).mockResolvedValue(
      makeAgentChangesUndoResult({
        restoredPaths: ['a.txt'],
        trashedPaths: ['b.txt'],
        undoSummary: resultSummary
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useUndoWithRunner(options))
    await act(async () => {
      await result.current.undoLastRevert()
    })
    expect(agentChangesApi.undoAgentChangesRevert).toHaveBeenCalledExactlyOnceWith(1)
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(resultSummary, 1)
    expect(vi.mocked(options.changes.applyUndoSummary).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
    )
    expect(options.reloadOpenFile).toHaveBeenCalledExactlyOnceWith('/repo/a.txt')
    expect(options.closeTabsAtOrInside).toHaveBeenCalledExactlyOnceWith('/repo/b.txt')
    expect(options.changes.announce).toHaveBeenCalledExactlyOnceWith(
      '戻した操作を取り消しました（2 件）'
    )
    // 取り直しはタブの同期の後(取り直す対象と順序は useAgentChangesWiring・refreshAfterAgentChangesWrite が持つ)
    expect(options.refreshAfterWrite).toHaveBeenCalledOnce()
    expect(vi.mocked(options.closeTabsAtOrInside).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.refreshAfterWrite).mock.invocationCallOrder[0]
    )
    expect(result.current.runner.error).toBeNull()
    expect(result.current.runner.runningOperation).toBeNull()
  })

  it('partial: 読み直しの後に失敗の表示へ警告を出し、読み上げない', async () => {
    const message = '取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: b.txt: x'
    const partial: AgentChangesUndoResult = {
      status: 'partial',
      message,
      restoredPaths: ['a.txt'],
      trashedPaths: [],
      undoSummary: null
    }
    vi.mocked(agentChangesApi.undoAgentChangesRevert).mockResolvedValue(partial)
    const reload = deferred<void>()
    const options = makeOptions({ reloadOpenFile: vi.fn(() => reload.promise) })
    const { result } = renderHook(() => useUndoWithRunner(options))
    let running: Promise<void> = Promise.resolve()
    await act(async () => {
      running = result.current.undoLastRevert()
      await vi.waitFor(() => expect(options.reloadOpenFile).toHaveBeenCalled())
    })
    // 読み直しの途中では、まだ警告を出さない
    expect(result.current.runner.error).toBeNull()
    await act(async () => {
      reload.resolve()
      await running
    })
    expect(options.reloadOpenFile).toHaveBeenCalledExactlyOnceWith('/repo/a.txt')
    expect(result.current.runner.error).toEqual({ message, path: null, source: 'undo' })
    expect(options.changes.announce).not.toHaveBeenCalled()
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(null, 1)
  })

  it('失敗(reject): 帯を隠す(null を unlockGlobal より前に反映)、失敗を出し、タブは読み直さず、取り直す', async () => {
    vi.mocked(agentChangesApi.undoAgentChangesRevert).mockRejectedValue(
      new Error('取り消せる操作が変わりました。一覧を更新してください')
    )
    const options = makeOptions()
    const { result } = renderHook(() => useUndoWithRunner(options))
    await act(async () => {
      await result.current.undoLastRevert()
    })
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(null, 1)
    expect(vi.mocked(options.changes.applyUndoSummary).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
    )
    expect(result.current.runner.error?.message).toBe(
      '取り消せる操作が変わりました。一覧を更新してください'
    )
    expect(result.current.runner.error?.source).toBe('undo')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
    expect(options.changes.announce).not.toHaveBeenCalled()
    expect(options.refreshAfterWrite).toHaveBeenCalledOnce()
  })

  it.each<[string, Partial<UndoTestOptions>]>([
    ['フォルダを切り替えた', { folderPath: '/other' }],
    [
      '記録が新しくなった',
      {
        changes: makeAgentChangesController({
          view: makeAgentChangesRecordingView([], { startedAt: 2, undo: null })
        })
      }
    ]
  ])(
    '結果が届く前に記録の世代が変わった(%s)なら読み上げない。タブは依頼の時点のフォルダのパスで同期する',
    async (_label, next) => {
      const pending = deferred<AgentChangesUndoResult>()
      vi.mocked(agentChangesApi.undoAgentChangesRevert).mockReturnValueOnce(pending.promise)
      const options = makeOptions()
      const { result, rerender } = renderHook(
        (props: UndoTestOptions) => useUndoWithRunner(props),
        {
          initialProps: options
        }
      )
      let running: Promise<void> = Promise.resolve()
      act(() => {
        running = result.current.undoLastRevert()
      })
      // 実行中に世代が変わる(フォルダの切り替え・記録の終了と新しい記録)
      rerender({ ...options, ...next })
      await act(async () => {
        pending.resolve(
          makeAgentChangesUndoResult({ restoredPaths: ['a.txt'], trashedPaths: ['b.txt'] })
        )
        await running
      })
      expect(options.changes.announce).not.toHaveBeenCalled()
      // 作業ツリーは書き換わっているため、タブの同期は世代を見ない(依頼の時点のフォルダのパスで行う)
      expect(options.reloadOpenFile).toHaveBeenCalledExactlyOnceWith('/repo/a.txt')
      expect(options.closeTabsAtOrInside).toHaveBeenCalledExactlyOnceWith('/repo/b.txt')
      expect(options.refreshAfterWrite).toHaveBeenCalledOnce()
    }
  )
})

describe('useAgentChangesUndo — 実行中(L-101)', () => {
  it('同じ描画の中の 2 回目は呼ばず、実行中の理由は取り消しの実行中', async () => {
    const pending = deferred<AgentChangesUndoResult>()
    vi.mocked(agentChangesApi.undoAgentChangesRevert).mockReturnValueOnce(pending.promise)
    const options = makeOptions()
    const { result } = renderHook(() => useUndoWithRunner(options))
    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.undoLastRevert()
      second = result.current.undoLastRevert()
    })
    expect(agentChangesApi.undoAgentChangesRevert).toHaveBeenCalledOnce()
    expect(result.current.undoDisabledReason).toBe(AGENT_CHANGES_BUSY_UNDOING)
    await act(async () => {
      pending.resolve(makeAgentChangesUndoResult())
      await first
      await second
    })
    expect(result.current.undoDisabledReason).toBeNull()
  })

  it('戻す操作の実行中(runner を共有)は、戻す操作の実行中の理由を返し、押しても呼ばない', async () => {
    const pending = deferred<void>()
    const options = makeOptions()
    const { result } = renderHook(() => useUndoWithRunner(options))
    let revert: Promise<unknown> = Promise.resolve()
    act(() => {
      revert = result.current.runner.run('file', 'a.txt', () => pending.promise, {
        onResult: () => undefined,
        onError: () => undefined
      })
    })
    expect(result.current.undoDisabledReason).toBe(AGENT_CHANGES_BUSY_REVERTING)
    await act(async () => {
      await result.current.undoLastRevert()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.undoAgentChangesRevert).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve()
      await revert
    })
  })
})
