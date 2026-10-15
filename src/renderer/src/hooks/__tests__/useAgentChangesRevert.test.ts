import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type {
  AgentChangeEntry,
  AgentChangesScope,
  AgentRevertAllResult,
  AgentRevertResult
} from '@shared/types'

vi.mock('../../lib/agentChangesApi')

import * as agentChangesApi from '../../lib/agentChangesApi'
import { useAgentChangesRevert } from '../useAgentChangesRevert'
import type { AgentChangesRevertOptions, AgentChangesRevertState } from '../useAgentChangesRevert'
import { useAgentChangesWriteRunner } from '../useAgentChangesWriteRunner'
import { recordingStartedAtOf } from '../../lib/agentChangesView'
import type { AgentChangesList } from '@shared/types'
import type { FileOperationLock } from '../useFileOperationLock'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_BUSY_LOADING,
  AGENT_CHANGES_BUSY_REVERTING,
  AGENT_CHANGES_LIST_FAILED,
  AGENT_CHANGES_NOT_RECORDED_REASON,
  AGENT_CHANGES_ONLY_USER_REASON,
  AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
  AGENT_CHANGES_TRUNCATED_REASON,
  AGENT_REVERT_ALL_DISTINGUISHING_NOTE
} from '../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesController,
  makeAgentChangesList,
  makeAgentChangesRecordingView,
  makeAgentChangesTrackingSummary,
  makeAgentChangesUndoSummary,
  makeAgentRevertAllResult,
  makeAgentRevertResult
} from '../../__tests__/makeAgentChangesState'

const ALL_SCOPE: AgentChangesScope = { kind: 'all' }

const makeLock = (): FileOperationLock => ({
  isLocked: vi.fn(() => false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn(() => false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn()
})

// 実行の共有(runner)は戻す操作の hook の外で作るため、テストの選択肢には含めない
type RevertTestOptions = Omit<AgentChangesRevertOptions, 'runner'>

// 実行の共有(runner)と組で描画する(useAgentChangesWiring と同じ組み立て)
function useRevertWithRunner(options: RevertTestOptions): AgentChangesRevertState {
  const runner = useAgentChangesWriteRunner({
    folderPath: options.folderPath,
    recordStartedAt: recordingStartedAtOf(options.changes.view),
    fileLock: options.fileLock
  })
  return useAgentChangesRevert({ ...options, runner })
}

function makeOptions(
  overrides: Partial<RevertTestOptions> = {},
  list: AgentChangesList | null = makeAgentChangesList([makeAgentChangeEntry('a.txt')])
): RevertTestOptions {
  return {
    folderPath: '/repo',
    changes: makeAgentChangesController({
      view:
        list === null
          ? makeAgentChangesRecordingView(null, { startedAt: 1 })
          : makeAgentChangesRecordingView(list.entries, {
              startedAt: 1,
              totalCount: list.totalCount,
              truncated: list.truncated,
              headChanged: list.headChanged
            })
    }),
    fileLock: makeLock(),
    agentRunning: false,
    hasDirtyTabAtOrInside: vi.fn(() => false),
    reloadOpenFile: vi.fn(async () => undefined),
    closeTabsAtOrInside: vi.fn(),
    confirmDiscardAnyDirty: vi.fn(() => true),
    reloadOpenFiles: vi.fn(async () => undefined),
    refreshAfterWrite: vi.fn(async () => undefined),
    onConfirm: vi.fn(() => true),
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(agentChangesApi.revertAgentChange).mockResolvedValue(makeAgentRevertResult())
  vi.mocked(agentChangesApi.revertAgentChangeHunk).mockResolvedValue(makeAgentRevertResult())
  vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue(
    makeAgentRevertAllResult({ undoSummary: null })
  )
})

describe('useAgentChangesRevert — ファイル単位', () => {
  it('確認をキャンセルしたら何も呼ばず、ロックも取らない', async () => {
    const options = makeOptions({ onConfirm: vi.fn(() => false) })
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('成功したら、全体ロックの中で戻し、開いているタブを読み直し、結果を読み上げ、読み直しの後に書き換えの後の取り直し(refreshAfterWrite)を呼ぶ', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('src/a.txt'))
    })
    expect(agentChangesApi.revertAgentChange).toHaveBeenCalledWith('src/a.txt', ALL_SCOPE)
    expect(options.fileLock.lockGlobal).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/src/a.txt')
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
    expect(options.changes.announce).toHaveBeenCalledWith(
      '1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
    // 取り直しはタブの読み直しの後(取り直す対象と順序は useAgentChangesWiring・refreshAfterAgentChangesWrite が持つ)
    expect(options.refreshAfterWrite).toHaveBeenCalledOnce()
    expect(vi.mocked(options.reloadOpenFile).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.refreshAfterWrite).mock.invocationCallOrder[0]
    )
    expect(result.current.runningOperation).toBeNull()
  })

  it('追加されたフォルダはゴミ箱へ移した後、配下のタブを閉じる(読み直さない)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(
        makeAgentChangeEntry('newdir/', { status: 'A', isDirectory: true })
      )
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'newdir/ をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
    )
    expect(options.closeTabsAtOrInside).toHaveBeenCalledWith('/repo/newdir')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('失敗したらタブを読み直さず、エラーを出し、書き換えの後の取り直し(refreshAfterWrite)は呼ぶ(パターン 20)', async () => {
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('戻せません'))
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(result.current.error).toBe('戻せません')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.changes.announce).not.toHaveBeenCalled()
    expect(options.refreshAfterWrite).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('確認の文言に、アプリでの保存・未保存の編集・エージェントの動作を足す', async () => {
    const options = makeOptions({
      agentRunning: true,
      hasDirtyTabAtOrInside: vi.fn(() => true)
    })
    options.changes.savedPaths = new Set(['/repo/a.txt'])
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain('このファイルは、記録を始めた後にアプリで保存されています。')
    expect(message).toContain('エディタの未保存の編集も破棄されます。')
    expect(message).toContain('エージェントが動いている間は')
    expect(options.hasDirtyTabAtOrInside).toHaveBeenCalledWith('/repo/a.txt')
  })

  it.each<[string, string, boolean]>([
    ['配下で保存したなら足す', '/repo/newdir/x.txt', true],
    ['名前の前方一致だけの別フォルダなら足さない', '/repo/newdir2/x.txt', false]
  ])(
    '追加されたフォルダの行は、%s(末尾の / を落として判定する)',
    async (_label, saved, expected) => {
      const options = makeOptions()
      options.changes.savedPaths = new Set([saved])
      const { result } = renderHook(() => useRevertWithRunner(options))
      await act(async () => {
        await result.current.revertFile(
          makeAgentChangeEntry('newdir/', { status: 'A', isDirectory: true })
        )
      })
      const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
      expect(message.includes('記録を始めた後にアプリで保存されています')).toBe(expected)
      expect(options.hasDirtyTabAtOrInside).toHaveBeenCalledWith('/repo/newdir')
    }
  )

  it.each<[string, Partial<RevertTestOptions>, AgentChangeEntry]>([
    ['一覧の取得中', {}, makeAgentChangeEntry('a.txt')],
    ['記録しなかったファイル', {}, makeAgentChangeEntry('big.bin', { notRecorded: true })]
  ])('%s は確認も出さずに何もしない', async (label, overrides, target) => {
    const options = makeOptions(overrides)
    if (label === '一覧の取得中') options.changes.isLoading = true
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(target)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
  })

  it('押せない理由を返す(取得中・他の Git 操作の実行中)', () => {
    const options = makeOptions()
    options.changes.isLoading = true
    const { result } = renderHook(() => useRevertWithRunner(options))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_BUSY_LOADING)
  })
})

describe('useAgentChangesRevert — ハンク', () => {
  it('確認の後に戻し、成功したらそのファイルのタブを読み直す', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'a.txt の次のハンクを実行前の状態に戻しますか？戻した直後なら「戻した操作を取り消す」で取り消せます（内容が大きすぎるときを除く）。\n\n@@ -1 +1 @@'
    )
    expect(agentChangesApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch', ALL_SCOPE)
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/a.txt')
    expect(options.refreshAfterWrite).toHaveBeenCalledOnce()
  })

  it('失敗したら読み直さずエラーを出す', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(result.current.error).toBe('合いません')
  })

  it('記録中でない写しでは、ハンクを戻す操作は確認も IPC も呼ばない', async () => {
    const options = makeOptions()
    options.changes.view = { kind: 'none' }
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChangeHunk).not.toHaveBeenCalled()
  })
})

describe('useAgentChangesRevert — すべて', () => {
  const entries = [
    makeAgentChangeEntry('a.txt'),
    makeAgentChangeEntry('new.txt', { status: 'A' }),
    makeAgentChangeEntry('gone.txt', { status: 'D' })
  ]

  // 確認の文言の「保存したファイルを含む」は、セクションの行の印と同じ判定(isEntrySavedInApp。フォルダの行は配下を含む)
  it.each<[string, string | null, string[], boolean]>([
    ['フォルダの行の配下で保存したなら足す', '/repo', ['/repo/newdir/x.txt'], true],
    ['名前の前方一致だけの別フォルダなら足さない', '/repo', ['/repo/newdir2/x.txt'], false],
    ['ファイルの行で保存したなら足す', '/repo', ['/repo/a.txt'], true],
    ['保存が無ければ足さない', '/repo', [], false],
    ['フォルダを開いていなければ足さない', null, ['/repo/a.txt'], false]
  ])('すべて戻すの確認は、%s', async (_label, folderPath, saved, expected) => {
    const options = makeOptions(
      { folderPath },
      makeAgentChangesList([
        makeAgentChangeEntry('a.txt'),
        makeAgentChangeEntry('newdir/', { status: 'A', isDirectory: true })
      ])
    )
    options.changes.savedPaths = new Set(saved)
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message.includes('記録を始めた後にアプリで保存したファイルを含みます')).toBe(expected)
  })

  it('確認で見せた一覧を渡し、成功したら全タブを読み直して件数を読み上げる', async () => {
    const options = makeOptions({}, makeAgentChangesList(entries))
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(vi.mocked(options.onConfirm!).mock.calls[0][0]).toContain(
      'うち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。'
    )
    expect(options.confirmDiscardAnyDirty).toHaveBeenCalledOnce()
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledWith(
      [
        { path: 'a.txt', status: 'M' },
        { path: 'new.txt', status: 'A' },
        { path: 'gone.txt', status: 'D' }
      ],
      ALL_SCOPE
    )
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(options.changes.announce).toHaveBeenCalledWith(
      '3 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
  })

  it('未保存の編集の破棄を断ったら何もしない', async () => {
    const options = makeOptions(
      { confirmDiscardAnyDirty: vi.fn(() => false) },
      makeAgentChangesList(entries)
    )
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
  })

  it('partial なら読み直してから警告を出す(パターン 52)', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue(
      makeAgentRevertAllResult({ status: 'partial', message: '途中で失敗しました' })
    )
    let releaseReload: () => void = () => undefined
    const options = makeOptions(
      {
        reloadOpenFiles: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseReload = resolve
            })
        )
      },
      makeAgentChangesList(entries)
    )
    const { result } = renderHook(() => useRevertWithRunner(options))
    let running: Promise<void> = Promise.resolve()
    await act(async () => {
      running = result.current.revertAll()
      await vi.waitFor(() => expect(options.reloadOpenFiles).toHaveBeenCalled())
    })
    // 読み直しの途中では、まだ警告を出さない
    expect(result.current.error).toBeNull()
    await act(async () => {
      releaseReload()
      await running
    })
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(result.current.error).toBe(
      '途中で失敗しました。戻せた 1 件は「戻した操作を取り消す」で取り消せます'
    )
    expect(options.changes.announce).not.toHaveBeenCalled()
  })

  it('失敗したら読み直さない', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    const options = makeOptions({}, makeAgentChangesList(entries))
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
    expect(result.current.error).toBe('中止しました')
  })

  it('すべて戻すの確認は、フォルダの行を含むなら取り消せない旨を出す', async () => {
    const options = makeOptions(
      {},
      makeAgentChangesList([
        makeAgentChangeEntry('a.txt'),
        makeAgentChangeEntry('nd/', { status: 'A', isDirectory: true })
      ])
    )
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain(
      'フォルダをゴミ箱へ移すため、この操作は取り消せません（OS のゴミ箱から戻せます）。'
    )
    expect(message).not.toContain('戻した直後なら')
  })

  it('打ち切った一覧では押せず、確認も出さない', async () => {
    const options = makeOptions({}, makeAgentChangesList(entries, { truncated: true }))
    const { result } = renderHook(() => useRevertWithRunner(options))
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_TRUNCATED_REASON)
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
  })

  it('記録していない行を含む一覧では押せず、確認も出さない(main は照合のため全行を受け取るが、必ず中止する)', async () => {
    const options = makeOptions(
      {},
      makeAgentChangesList([...entries, makeAgentChangeEntry('big.bin', { notRecorded: true })])
    )
    const { result } = renderHook(() => useRevertWithRunner(options))
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_NOT_RECORDED_REASON)
    // ファイル・ハンク単位の戻す操作は、記録した行なら使える
    expect(result.current.revertDisabledReason).toBeNull()
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
  })
})

describe('useAgentChangesRevert — 押せない間(パターン 111)', () => {
  it('ファイルを戻す実行中は、同じ描画の 2 回目の依頼を止め、押せない理由に実行中を返す', async () => {
    let resolveRevert: () => void = () => undefined
    vi.mocked(agentChangesApi.revertAgentChange).mockReturnValueOnce(
      new Promise<AgentRevertResult>((resolve) => {
        resolveRevert = () => resolve(makeAgentRevertResult())
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    let first: Promise<void> = Promise.resolve()
    await act(async () => {
      const { revertFile } = result.current
      first = revertFile(makeAgentChangeEntry('a.txt'))
      await revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(options.onConfirm).toHaveBeenCalledOnce()
    expect(agentChangesApi.revertAgentChange).toHaveBeenCalledOnce()
    expect(result.current.runningOperation).toBe('revert')
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_BUSY_REVERTING)
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_BUSY_REVERTING)
    await act(async () => {
      resolveRevert()
      await first
    })
    expect(result.current.revertDisabledReason).toBeNull()
  })

  it('すべて戻す実行中は、同じ描画の 2 回目の依頼を止める', async () => {
    let resolveRevert: (value: AgentRevertAllResult) => void = () => undefined
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockReturnValueOnce(
      new Promise<AgentRevertAllResult>((resolve) => {
        resolveRevert = resolve
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    let first: Promise<void> = Promise.resolve()
    await act(async () => {
      const { revertAll } = result.current
      first = revertAll()
      await revertAll()
    })
    expect(options.onConfirm).toHaveBeenCalledOnce()
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledOnce()
    await act(async () => {
      resolveRevert(makeAgentRevertAllResult())
      await first
    })
    expect(result.current.runningOperation).toBeNull()
  })

  type Operation = 'ファイル' | 'ハンク' | 'すべて'
  const operate = async (
    state: ReturnType<typeof useAgentChangesRevert>,
    operation: Operation
  ): Promise<void> => {
    if (operation === 'ファイル') await state.revertFile(makeAgentChangeEntry('a.txt'))
    else if (operation === 'ハンク')
      await state.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    else await state.revertAll()
  }
  const busyCases: [string, (options: RevertTestOptions) => void, string][] = [
    [
      '他の Git 操作の実行中',
      (options) => {
        vi.mocked(options.fileLock.isAnyLocked).mockReturnValue(true)
      },
      AGENT_CHANGES_BUSY_GIT
    ],
    [
      '一覧の取得に失敗',
      (options) => {
        options.changes.listError = '失敗'
      },
      AGENT_CHANGES_LIST_FAILED
    ]
  ]
  const operations: Operation[] = ['ファイル', 'ハンク', 'すべて']

  it.each(
    busyCases.flatMap(([label, setup, reason]) =>
      operations.map((operation) => [label, operation, setup, reason] as const)
    )
  )(
    '%s は押せない理由を返し、%s を戻す操作は確認を出さない',
    async (_label, operation, setup, reason) => {
      const options = makeOptions()
      setup(options)
      const { result } = renderHook(() => useRevertWithRunner(options))
      expect(result.current.revertDisabledReason).toBe(reason)
      expect(result.current.revertAllDisabledReason).toBe(reason)
      await act(async () => {
        await operate(result.current, operation)
      })
      expect(options.onConfirm).not.toHaveBeenCalled()
      expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    }
  )
})

// 失敗の文言は、その記録・そのフォルダについてのもの(PR #47 B-1)
describe('useAgentChangesRevert — 失敗の文言を消す契機', () => {
  const recordingAt = (startedAt: number): RevertTestOptions['changes']['view'] =>
    makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { startedAt })

  async function failOnce(options: RevertTestOptions): Promise<{
    result: { current: ReturnType<typeof useAgentChangesRevert> }
    rerender: (props: RevertTestOptions) => void
  }> {
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('戻せません: a.txt'))
    const { result, rerender } = renderHook(
      (props: RevertTestOptions) => useRevertWithRunner(props),
      { initialProps: options }
    )
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(result.current.error).toBe('戻せません: a.txt')
    return { result, rerender }
  }

  it('記録が無くなったら(確認を終えた)消す', async () => {
    const options = makeOptions()
    const { result, rerender } = await failOnce(options)
    rerender({ ...options, changes: { ...options.changes, view: { kind: 'none' } } })
    expect(result.current.error).toBeNull()
    expect(result.current.errorPath).toBeNull()
  })

  it('新しい記録(startedAt が変わった)なら消す', async () => {
    const options = makeOptions()
    const { result, rerender } = await failOnce(options)
    rerender({ ...options, changes: { ...options.changes, view: recordingAt(2) } })
    expect(result.current.error).toBeNull()
  })

  it('フォルダを切り替えたら消す', async () => {
    const options = makeOptions()
    const { result, rerender } = await failOnce(options)
    rerender({ ...options, folderPath: '/other' })
    expect(result.current.error).toBeNull()
  })

  it('同じ記録のまま一覧だけが取り直されても消さない(消しすぎない)', async () => {
    const options = makeOptions()
    const { result, rerender } = await failOnce(options)
    rerender({ ...options, changes: { ...options.changes, view: recordingAt(1) } })
    expect(result.current.error).toBe('戻せません: a.txt')
    expect(result.current.errorPath).toBe('a.txt')
  })

  it('実行中にフォルダを切り替えたら、終わった後に前のフォルダの失敗を出さない', async () => {
    let rejectRevert: (err: Error) => void = () => undefined
    vi.mocked(agentChangesApi.revertAgentChange).mockImplementation(
      () =>
        new Promise<AgentRevertResult>((_resolve, reject) => {
          rejectRevert = reject
        })
    )
    const options = makeOptions()
    const { result, rerender } = renderHook(
      (props: RevertTestOptions) => useRevertWithRunner(props),
      { initialProps: options }
    )
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    rerender({ ...options, folderPath: '/other' })
    await act(async () => {
      rejectRevert(new Error('戻せません: a.txt'))
      await pending
    })
    expect(result.current.error).toBeNull()
  })

  // 成功の読み上げも、その記録・そのフォルダについてのもの(新しいフォルダのセクションで帯が無いのに「取り消せます」と読み上げない)
  let resolvePending: (value: AgentRevertResult | AgentRevertAllResult) => void = () => undefined
  it.each<[string, (result: { current: AgentChangesRevertState }) => Promise<void>, () => void]>([
    [
      'ファイルを戻す',
      (result) => result.current.revertFile(makeAgentChangeEntry('a.txt')),
      () => resolvePending(makeAgentRevertResult())
    ],
    [
      'すべて戻す',
      (result) => result.current.revertAll(),
      () => resolvePending(makeAgentRevertAllResult())
    ]
  ])(
    '%s の結果が届く前にフォルダを切り替えたら(世代が変わったら)、成功を読み上げない',
    async (_label, start, finish) => {
      vi.mocked(agentChangesApi.revertAgentChange).mockImplementation(
        () =>
          new Promise<AgentRevertResult>(
            (resolve) => (resolvePending = resolve as typeof resolvePending)
          )
      )
      vi.mocked(agentChangesApi.revertAllAgentChanges).mockImplementation(
        () =>
          new Promise<AgentRevertAllResult>(
            (resolve) => (resolvePending = resolve as typeof resolvePending)
          )
      )
      const options = makeOptions()
      const { result, rerender } = renderHook(
        (props: RevertTestOptions) => useRevertWithRunner(props),
        { initialProps: options }
      )
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = start(result)
      })
      rerender({ ...options, folderPath: '/other' })
      await act(async () => {
        finish()
        await pending
      })
      expect(options.changes.announce).not.toHaveBeenCalled()
    }
  )

  it('失敗の対象のパスを返す(ファイル・ハンクはそのパス、すべて戻すは null)', async () => {
    const options = makeOptions()
    const { result } = await failOnce(options)
    expect(result.current.errorPath).toBe('a.txt')

    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    await act(async () => {
      await result.current.revertHunk('b.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.errorPath).toBe('b.txt')

    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(result.current.error).toBe('中止しました')
    expect(result.current.errorPath).toBeNull()
  })
})

// 失敗の読み上げの出し分け(PR #47 の 2 回目のレビュー)。ハンクの失敗は diff タブ側の aria-live(hunkNotice)が読み上げるため、
// セクションの alert にしない(二重に読まれる)。ファイル・すべて(partial を含む)の失敗はセクションの alert が読み上げる
describe('useAgentChangesRevert — 失敗をどこで読み上げるか', () => {
  it('ハンクの失敗は isErrorAnnouncedInDiff が true', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    const { result } = renderHook(() => useRevertWithRunner(makeOptions()))
    expect(result.current.isErrorAnnouncedInDiff).toBe(false)
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.error).toBe('合いません')
    expect(result.current.isErrorAnnouncedInDiff).toBe(true)
  })

  it('ハンクの失敗の後のファイルの失敗は false に戻る', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('戻せません'))
    const { result } = renderHook(() => useRevertWithRunner(makeOptions()))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(result.current.error).toBe('戻せません')
    expect(result.current.isErrorAnnouncedInDiff).toBe(false)
  })

  it('すべて戻すの失敗・partial の警告は false', async () => {
    const entries = [makeAgentChangeEntry('a.txt')]
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    const { result } = renderHook(() =>
      useRevertWithRunner(makeOptions({}, makeAgentChangesList(entries)))
    )
    await act(async () => {
      await result.current.revertAll()
    })
    expect(result.current.error).toBe('中止しました')
    expect(result.current.isErrorAnnouncedInDiff).toBe(false)

    vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue(
      makeAgentRevertAllResult({ status: 'partial', message: '途中で失敗しました' })
    )
    await act(async () => {
      await result.current.revertAll()
    })
    expect(result.current.error).toBe(
      '途中で失敗しました。戻せた 1 件は「戻した操作を取り消す」で取り消せます'
    )
    expect(result.current.isErrorAnnouncedInDiff).toBe(false)
  })
})

// ハンクを戻した結果の読み上げ(PR #47 B-2)。diff タブ側の常設の aria-live に入れる
describe('useAgentChangesRevert — ハンクの結果の読み上げ', () => {
  it('成功したら hunkNotice に結果を出す(セクションの読み上げには出さない)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    expect(result.current.hunkNotice).toBeNull()
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.hunkNotice?.text).toBe(
      'ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます'
    )
    expect(options.changes.announce).not.toHaveBeenCalled()
  })

  it('同じ結果が続いても id を進める(読み上げ直させる)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    const firstId = result.current.hunkNotice?.id
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.hunkNotice?.id).not.toBe(firstId)
  })

  it('失敗したら hunkNotice に失敗の文言を出す', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.hunkNotice?.text).toBe('合いません')
  })

  it('ファイル単位・すべて戻すの結果は hunkNotice に出さない(セクションが読み上げる)', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    await act(async () => {
      await result.current.revertAll()
    })
    expect(result.current.hunkNotice).toBeNull()
  })

  it('フォルダを切り替えたら消す', async () => {
    const options = makeOptions()
    const { result, rerender } = renderHook(
      (props: RevertTestOptions) => useRevertWithRunner(props),
      { initialProps: options }
    )
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.hunkNotice).not.toBeNull()
    rerender({ ...options, folderPath: '/other' })
    expect(result.current.hunkNotice).toBeNull()
  })
})

describe('実行の範囲では戻さない(L-058・L-061)', () => {
  const RUN: AgentChangesScope = { kind: 'run', runId: 2 }
  const runView = (scope: AgentChangesScope): RevertTestOptions['changes'] =>
    makeAgentChangesController({
      scope,
      view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { startedAt: 1, scope })
    })

  it('選んでいる範囲が実行なら、戻すボタンの理由に実行の範囲の文言を出す', () => {
    const { result } = renderHook(() => useRevertWithRunner(makeOptions({ changes: runView(RUN) })))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
  })

  it('表示中の一覧の範囲が実行なら、選んでいる範囲が累積でも押せない(切り替えの直後)', () => {
    const changes = { ...runView(RUN), scope: ALL_SCOPE }
    const { result } = renderHook(() => useRevertWithRunner(makeOptions({ changes })))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
  })

  it.each(['ファイル', 'すべて'] as const)(
    '表示中の一覧の範囲が実行なら、%s を戻す操作は確認も IPC も呼ばない',
    async (operation) => {
      const options = makeOptions({ changes: runView(RUN) })
      const { result } = renderHook(() => useRevertWithRunner(options))
      await act(async () => {
        if (operation === 'ファイル') await result.current.revertFile(makeAgentChangeEntry('a.txt'))
        else await result.current.revertAll()
      })
      expect(options.onConfirm).not.toHaveBeenCalled()
      expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
      expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
    }
  )

  it('ハンクの内容の範囲が実行なら、確認も IPC も呼ばない', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', RUN)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChangeHunk).not.toHaveBeenCalled()
  })
})

// 結果の控えの要約を、実行中の印を下ろす前(unlockGlobal より前)に写しへ反映する(L-039)。例外では帯を隠す
describe('useAgentChangesRevert — 取り消しの控えの写しへの反映', () => {
  const unlockOrder = (options: RevertTestOptions): number =>
    vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
  const applyOrder = (options: RevertTestOptions): number =>
    vi.mocked(options.changes.applyUndoSummary).mock.invocationCallOrder[0]

  it('ファイルを戻す成功: 結果の undoSummary を依頼の時点の startedAt で、unlockGlobal より前に反映する', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(
      makeAgentChangesUndoSummary(),
      1
    )
    expect(applyOrder(options)).toBeLessThan(unlockOrder(options))
    expect(options.changes.announce).toHaveBeenCalledWith(
      '1 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
  })

  it('控えが取れなかった結果は、取り消せない理由を読み上げ、帯を消す(null を反映)', async () => {
    vi.mocked(agentChangesApi.revertAgentChange).mockResolvedValue(
      makeAgentRevertResult({
        undo: { kind: 'unavailable', reason: 'too-large' },
        undoSummary: null
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(options.changes.announce).toHaveBeenCalledWith(
      '1 件を実行前の状態に戻しました。内容が大きすぎるため、この操作は取り消せません'
    )
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(null, 1)
  })

  it.each<[string, (state: AgentChangesRevertState) => Promise<void>]>([
    ['ファイル', (state) => state.revertFile(makeAgentChangeEntry('a.txt'))],
    ['ハンク', (state) => state.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)],
    ['すべて', (state) => state.revertAll()]
  ])('%s を戻す失敗(reject): null を unlockGlobal より前に反映する', async (_label, invoke) => {
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('x'))
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('x'))
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('x'))
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await invoke(result.current)
    })
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(null, 1)
    expect(applyOrder(options)).toBeLessThan(unlockOrder(options))
  })

  it('ハンクの成功: 結果の undoSummary を反映し、diff タブ側でどこで取り消すかを読み上げる', async () => {
    const hunkSummary = makeAgentChangesUndoSummary({ operation: 'hunk' })
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockResolvedValue(
      makeAgentRevertResult({ undoSummary: hunkSummary })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(hunkSummary, 1)
    expect(result.current.hunkNotice?.text).toBe(
      'ハンクを実行前の状態に戻しました。ソース管理の「エージェントの変更」で取り消せます'
    )
  })

  it.each<[string, AgentRevertAllResult['undo'], string]>([
    [
      '取れた',
      { kind: 'saved' },
      'すべて戻すが途中で失敗しました（1 / 2 件を戻し済み）: x。戻せた 1 件は「戻した操作を取り消す」で取り消せます'
    ],
    [
      '取れなかった',
      { kind: 'unavailable', reason: 'capture-failed' },
      'すべて戻すが途中で失敗しました（1 / 2 件を戻し済み）: x。戻した後の状態を控えられなかったため、戻せた 1 件は取り消せません'
    ]
  ])(
    'すべて戻すの partial(控えが%s)は、戻せた件数を取り消せるかを警告に足す',
    async (_label, undo, expected) => {
      const summary = makeAgentChangesUndoSummary({ operation: 'all' })
      vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue(
        makeAgentRevertAllResult({
          status: 'partial',
          message: 'すべて戻すが途中で失敗しました（1 / 2 件を戻し済み）: x',
          revertedCount: 1,
          undo,
          undoSummary: undo.kind === 'saved' ? summary : null
        })
      )
      const options = makeOptions()
      const { result } = renderHook(() => useRevertWithRunner(options))
      await act(async () => {
        await result.current.revertAll()
      })
      expect(result.current.error).toBe(expected)
      expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(
        undo.kind === 'saved' ? summary : null,
        1
      )
    }
  )

  it('すべて戻すで 1 件も戻さなかった(revertedCount 0)なら、前の控えを残し、取り消しについて読み上げない', async () => {
    // main は作業ツリーを変えなかった依頼では前の控えを残す: undo はこの依頼の控えの成否(capture-failed など)で、
    // undoSummary は前の、まだ有効な控え
    const previous = makeAgentChangesUndoSummary({ undoId: 7 })
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue(
      makeAgentRevertAllResult({
        revertedCount: 0,
        undo: { kind: 'unavailable', reason: 'capture-failed' },
        undoSummary: previous
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.changes.applyUndoSummary).toHaveBeenCalledExactlyOnceWith(previous, 1)
    expect(options.changes.announce).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })
})

describe('useAgentChangesRevert — 利用者の変更の区別(すべて戻すの対象・確認・除く件数・押せない理由)', () => {
  // 記録の開始(1)から区別している記録
  const distinguishing = makeAgentChangesTrackingSummary({ since: 1 })
  // a.txt: エージェントの変更、u.txt: 利用者の変更(追加。アプリで保存)、m/: 両方(追加されたフォルダ)、n.txt: 区別していない行(追加)
  const entries = [
    makeAgentChangeEntry('a.txt', { author: 'agent' }),
    makeAgentChangeEntry('m/', { status: 'A', isDirectory: true, author: 'mixed' }),
    makeAgentChangeEntry('n.txt', { status: 'A', author: null }),
    makeAgentChangeEntry('u.txt', { status: 'A', author: 'user' })
  ]
  const optionsWith = (
    rows: AgentChangeEntry[],
    viewOverrides: Parameters<typeof makeAgentChangesRecordingView>[1] = {}
  ): RevertTestOptions =>
    makeOptions({
      changes: makeAgentChangesController({
        view: makeAgentChangesRecordingView(rows, {
          startedAt: 1,
          attribution: distinguishing,
          ...viewOverrides
        })
      })
    })

  it('すべて戻すは、利用者の変更・利用者の変更を含む行を除いた対象だけで、確認の件数・ゴミ箱の件数・フォルダの有無・保存の有無・expected・読み上げの件数を求める', async () => {
    const options = optionsWith(entries)
    options.changes.savedPaths = new Set(['/repo/u.txt'])
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain('エージェントの変更 2 件を実行前の状態に戻しますか？')
    expect(message).toContain('うち 1 件の新しいファイル・フォルダはゴミ箱へ移動します。')
    expect(message).not.toContain('フォルダをゴミ箱へ移すため')
    expect(message).not.toContain('記録を始めた後にアプリで保存したファイルを含みます')
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledWith(
      [
        { path: 'a.txt', status: 'M' },
        { path: 'n.txt', status: 'A' }
      ],
      ALL_SCOPE
    )
    expect(options.changes.announce).toHaveBeenCalledWith(
      '2 件を実行前の状態に戻しました。「戻した操作を取り消す」で取り消せます'
    )
  })

  it('すべて戻すの確認に、写しの区別の要約・記録の開始の時刻・除く件数を渡す', async () => {
    const options = optionsWith(entries)
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message).toContain(
      `？${AGENT_REVERT_ALL_DISTINGUISHING_NOTE}利用者の変更 2 件（印の付いた行）は戻しません。行の ↶ で個別に戻せます。戻した直後なら`
    )
    expect(message).not.toContain('記録を始めた後にあなたが編集した内容も戻ります。')
  })

  it('除く件数(revertAllExcludedCount)を返す。打ち切った一覧・実行の範囲の一覧では 0', () => {
    expect(
      renderHook(() => useRevertWithRunner(optionsWith(entries))).result.current
        .revertAllExcludedCount
    ).toBe(2)
    expect(
      renderHook(() => useRevertWithRunner(optionsWith(entries, { truncated: true }))).result
        .current.revertAllExcludedCount
    ).toBe(0)
    expect(
      renderHook(() =>
        useRevertWithRunner(optionsWith(entries, { scope: { kind: 'run', runId: 1 } }))
      ).result.current.revertAllExcludedCount
    ).toBe(0)
  })

  it('行がすべて利用者の変更なら、すべて戻すは押せず(理由を返す)、確認も出さない。行の ↶ は押せる', async () => {
    const options = optionsWith([
      makeAgentChangeEntry('u.txt', { author: 'user' }),
      makeAgentChangeEntry('m.txt', { author: 'mixed' })
    ])
    const { result } = renderHook(() => useRevertWithRunner(options))
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_ONLY_USER_REASON)
    expect(result.current.revertDisabledReason).toBeNull()
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
  })

  it.each<[AgentChangeEntry['author'], boolean]>([
    ['user', true],
    ['mixed', true],
    ['agent', false],
    [null, false]
  ])('行の ↶ の確認は、author が %s なら利用者の変更の旨を足すか: %s', async (author, expected) => {
    const options = optionsWith(entries)
    const { result } = renderHook(() => useRevertWithRunner(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt', { author }))
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(
      message.includes(
        'このファイル（フォルダ）には、エージェントのツールが動いていない間の変更（利用者の変更）が含まれます。'
      )
    ).toBe(expected)
  })
})
