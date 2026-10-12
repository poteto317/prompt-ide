import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangeEntry, AgentChangesScope } from '@shared/types'

vi.mock('../../lib/agentChangesApi')

import * as agentChangesApi from '../../lib/agentChangesApi'
import { useAgentChangesRevert } from '../useAgentChangesRevert'
import type { AgentChangesRevertOptions } from '../useAgentChangesRevert'
import type { AgentChangesList } from '@shared/types'
import type { FileOperationLock } from '../useFileOperationLock'
import {
  AGENT_CHANGES_BUSY_GIT,
  AGENT_CHANGES_BUSY_LOADING,
  AGENT_CHANGES_BUSY_REVERTING,
  AGENT_CHANGES_HUNK_REVERTED_NOTICE,
  AGENT_CHANGES_LIST_FAILED,
  AGENT_CHANGES_NOT_RECORDED_REASON,
  AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE,
  AGENT_CHANGES_TRUNCATED_REASON
} from '../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesController,
  makeAgentChangesList,
  makeAgentChangesRecordingView
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

function makeOptions(
  overrides: Partial<AgentChangesRevertOptions> = {},
  list: AgentChangesList | null = makeAgentChangesList([makeAgentChangeEntry('a.txt')])
): AgentChangesRevertOptions {
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
    refreshTree: vi.fn(async () => true),
    refreshGitStatus: vi.fn(async () => undefined),
    refreshDiff: vi.fn(),
    onConfirm: vi.fn(() => true),
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(agentChangesApi.revertAgentChange).mockResolvedValue(undefined)
  vi.mocked(agentChangesApi.revertAgentChangeHunk).mockResolvedValue(undefined)
  vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue({ status: 'done' })
})

describe('useAgentChangesRevert — ファイル単位', () => {
  it('確認をキャンセルしたら何も呼ばず、ロックも取らない', async () => {
    const options = makeOptions({ onConfirm: vi.fn(() => false) })
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('成功したら、全体ロックの中で戻し、開いているタブを読み直し、結果を読み上げ、一覧と git status を取り直す', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('src/a.txt'))
    })
    expect(agentChangesApi.revertAgentChange).toHaveBeenCalledWith('src/a.txt', ALL_SCOPE)
    expect(options.fileLock.lockGlobal).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/src/a.txt')
    expect(options.closeTabsAtOrInside).not.toHaveBeenCalled()
    expect(options.changes.announce).toHaveBeenCalledWith('1 件を実行前の状態に戻しました')
    expect(options.refreshGitStatus).toHaveBeenCalledOnce()
    expect(options.changes.refresh).toHaveBeenCalledOnce()
    expect(options.refreshDiff).toHaveBeenCalledOnce()
    expect(result.current.isReverting).toBe(false)
  })

  it('追加されたフォルダはゴミ箱へ移した後、配下のタブを閉じる(読み直さない)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(
        makeAgentChangeEntry('newdir/', { status: 'A', isDirectory: true })
      )
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'newdir/ をゴミ箱へ移動しますか？フォルダとその中身（.gitignore の対象を含む）がすべて移動します。'
    )
    expect(options.closeTabsAtOrInside).toHaveBeenCalledWith('/repo/newdir')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
  })

  it('失敗したらタブを読み直さず、エラーを出し、一覧は取り直す(パターン 20)', async () => {
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('戻せません'))
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(result.current.error).toBe('戻せません')
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(options.changes.announce).not.toHaveBeenCalled()
    expect(options.changes.refresh).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('確認の文言に、アプリでの保存・未保存の編集・エージェントの動作を足す', async () => {
    const options = makeOptions({
      agentRunning: true,
      hasDirtyTabAtOrInside: vi.fn(() => true)
    })
    options.changes.savedPaths = new Set(['/repo/a.txt'])
    const { result } = renderHook(() => useAgentChangesRevert(options))
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
      const { result } = renderHook(() => useAgentChangesRevert(options))
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

  it.each<[string, Partial<AgentChangesRevertOptions>, AgentChangeEntry]>([
    ['一覧の取得中', {}, makeAgentChangeEntry('a.txt')],
    ['記録しなかったファイル', {}, makeAgentChangeEntry('big.bin', { notRecorded: true })]
  ])('%s は確認も出さずに何もしない', async (label, overrides, target) => {
    const options = makeOptions(overrides)
    if (label === '一覧の取得中') options.changes.isLoading = true
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertFile(target)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChange).not.toHaveBeenCalled()
  })

  it('押せない理由を返す(取得中・他の Git 操作の実行中)', () => {
    const options = makeOptions()
    options.changes.isLoading = true
    const { result } = renderHook(() => useAgentChangesRevert(options))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_BUSY_LOADING)
  })
})

describe('useAgentChangesRevert — ハンク', () => {
  it('確認の後に戻し、成功したらそのファイルのタブを読み直す', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'a.txt の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n@@ -1 +1 @@'
    )
    expect(agentChangesApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch', ALL_SCOPE)
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/a.txt')
    expect(options.refreshDiff).toHaveBeenCalledOnce()
  })

  it('失敗したら読み直さずエラーを出す', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(options.reloadOpenFile).not.toHaveBeenCalled()
    expect(result.current.error).toBe('合いません')
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
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    const message = vi.mocked(options.onConfirm!).mock.calls[0][0]
    expect(message.includes('記録を始めた後にアプリで保存したファイルを含みます')).toBe(expected)
  })

  it('確認で見せた一覧を渡し、成功したら全タブを読み直して件数を読み上げる', async () => {
    const options = makeOptions({}, makeAgentChangesList(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
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
    expect(options.changes.announce).toHaveBeenCalledWith('3 件を実行前の状態に戻しました')
  })

  it('未保存の編集の破棄を断ったら何もしない', async () => {
    const options = makeOptions(
      { confirmDiscardAnyDirty: vi.fn(() => false) },
      makeAgentChangesList(entries)
    )
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(agentChangesApi.revertAllAgentChanges).not.toHaveBeenCalled()
  })

  it('partial なら読み直してから警告を出す(パターン 52)', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue({
      status: 'partial',
      message: '途中で失敗しました'
    })
    const options = makeOptions({}, makeAgentChangesList(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(result.current.error).toBe('途中で失敗しました')
    expect(options.changes.announce).not.toHaveBeenCalled()
  })

  it('失敗したら読み直さない', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    const options = makeOptions({}, makeAgentChangesList(entries))
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertAll()
    })
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
    expect(result.current.error).toBe('中止しました')
  })

  it('打ち切った一覧では押せず、確認も出さない', async () => {
    const options = makeOptions({}, makeAgentChangesList(entries, { truncated: true }))
    const { result } = renderHook(() => useAgentChangesRevert(options))
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
    const { result } = renderHook(() => useAgentChangesRevert(options))
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
      new Promise<void>((resolve) => {
        resolveRevert = resolve
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    let first: Promise<void> = Promise.resolve()
    await act(async () => {
      const { revertFile } = result.current
      first = revertFile(makeAgentChangeEntry('a.txt'))
      await revertFile(makeAgentChangeEntry('a.txt'))
    })
    expect(options.onConfirm).toHaveBeenCalledOnce()
    expect(agentChangesApi.revertAgentChange).toHaveBeenCalledOnce()
    expect(result.current.isReverting).toBe(true)
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_BUSY_REVERTING)
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_BUSY_REVERTING)
    await act(async () => {
      resolveRevert()
      await first
    })
    expect(result.current.revertDisabledReason).toBeNull()
  })

  it('すべて戻す実行中は、同じ描画の 2 回目の依頼を止める', async () => {
    let resolveRevert: (value: { status: 'done' }) => void = () => undefined
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRevert = resolve
      })
    )
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    let first: Promise<void> = Promise.resolve()
    await act(async () => {
      const { revertAll } = result.current
      first = revertAll()
      await revertAll()
    })
    expect(options.onConfirm).toHaveBeenCalledOnce()
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledOnce()
    await act(async () => {
      resolveRevert({ status: 'done' })
      await first
    })
    expect(result.current.isReverting).toBe(false)
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
  const busyCases: [string, (options: AgentChangesRevertOptions) => void, string][] = [
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
      const { result } = renderHook(() => useAgentChangesRevert(options))
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
  const recordingAt = (startedAt: number): AgentChangesRevertOptions['changes']['view'] =>
    makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { startedAt })

  async function failOnce(options: AgentChangesRevertOptions): Promise<{
    result: { current: ReturnType<typeof useAgentChangesRevert> }
    rerender: (props: AgentChangesRevertOptions) => void
  }> {
    vi.mocked(agentChangesApi.revertAgentChange).mockRejectedValue(new Error('戻せません: a.txt'))
    const { result, rerender } = renderHook(
      (props: AgentChangesRevertOptions) => useAgentChangesRevert(props),
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
        new Promise<void>((_resolve, reject) => {
          rejectRevert = reject
        })
    )
    const options = makeOptions()
    const { result, rerender } = renderHook(
      (props: AgentChangesRevertOptions) => useAgentChangesRevert(props),
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
    const { result } = renderHook(() => useAgentChangesRevert(makeOptions()))
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
    const { result } = renderHook(() => useAgentChangesRevert(makeOptions()))
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
      useAgentChangesRevert(makeOptions({}, makeAgentChangesList(entries)))
    )
    await act(async () => {
      await result.current.revertAll()
    })
    expect(result.current.error).toBe('中止しました')
    expect(result.current.isErrorAnnouncedInDiff).toBe(false)

    vi.mocked(agentChangesApi.revertAllAgentChanges).mockResolvedValue({
      status: 'partial',
      message: '途中で失敗しました'
    })
    await act(async () => {
      await result.current.revertAll()
    })
    expect(result.current.error).toBe('途中で失敗しました')
    expect(result.current.isErrorAnnouncedInDiff).toBe(false)
  })
})

// ハンクを戻した結果の読み上げ(PR #47 B-2)。diff タブ側の常設の aria-live に入れる
describe('useAgentChangesRevert — ハンクの結果の読み上げ', () => {
  it('成功したら hunkNotice に結果を出す(セクションの読み上げには出さない)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    expect(result.current.hunkNotice).toBeNull()
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.hunkNotice?.text).toBe(AGENT_CHANGES_HUNK_REVERTED_NOTICE)
    expect(options.changes.announce).not.toHaveBeenCalled()
  })

  it('同じ結果が続いても id を進める(読み上げ直させる)', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
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
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', ALL_SCOPE)
    })
    expect(result.current.hunkNotice?.text).toBe('合いません')
  })

  it('ファイル単位・すべて戻すの結果は hunkNotice に出さない(セクションが読み上げる)', async () => {
    vi.mocked(agentChangesApi.revertAllAgentChanges).mockRejectedValue(new Error('中止しました'))
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
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
      (props: AgentChangesRevertOptions) => useAgentChangesRevert(props),
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
  const runView = (scope: AgentChangesScope): AgentChangesRevertOptions['changes'] =>
    makeAgentChangesController({
      scope,
      view: makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { startedAt: 1, scope })
    })

  it('選んでいる範囲が実行なら、戻すボタンの理由に実行の範囲の文言を出す', () => {
    const { result } = renderHook(() =>
      useAgentChangesRevert(makeOptions({ changes: runView(RUN) }))
    )
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
    expect(result.current.revertAllDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
  })

  it('表示中の一覧の範囲が実行なら、選んでいる範囲が累積でも押せない(切り替えの直後)', () => {
    const changes = { ...runView(RUN), scope: ALL_SCOPE }
    const { result } = renderHook(() => useAgentChangesRevert(makeOptions({ changes })))
    expect(result.current.revertDisabledReason).toBe(AGENT_CHANGES_REVERT_DISABLED_RUN_SCOPE)
  })

  it.each(['ファイル', 'すべて'] as const)(
    '表示中の一覧の範囲が実行なら、%s を戻す操作は確認も IPC も呼ばない',
    async (operation) => {
      const options = makeOptions({ changes: runView(RUN) })
      const { result } = renderHook(() => useAgentChangesRevert(options))
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
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@', RUN)
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(agentChangesApi.revertAgentChangeHunk).not.toHaveBeenCalled()
  })
})
