import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { AgentChangeEntry } from '@shared/types'

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
  AGENT_CHANGES_LIST_FAILED,
  AGENT_CHANGES_NOT_RECORDED_REASON,
  AGENT_CHANGES_TRUNCATED_REASON
} from '../../lib/agentChangesMessages'
import {
  makeAgentChangeEntry,
  makeAgentChangesController,
  makeAgentChangesList
} from '../../__tests__/makeAgentChangesState'

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
    changes: makeAgentChangesController({ view: { kind: 'recording', startedAt: 1, list } }),
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
    expect(agentChangesApi.revertAgentChange).toHaveBeenCalledWith('src/a.txt')
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
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@')
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      'a.txt の次のハンクを実行前の状態に戻しますか？この操作は元に戻せません。\n\n@@ -1 +1 @@'
    )
    expect(agentChangesApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch')
    expect(options.reloadOpenFile).toHaveBeenCalledWith('/repo/a.txt')
    expect(options.refreshDiff).toHaveBeenCalledOnce()
  })

  it('失敗したら読み直さずエラーを出す', async () => {
    vi.mocked(agentChangesApi.revertAgentChangeHunk).mockRejectedValue(new Error('合いません'))
    const options = makeOptions()
    const { result } = renderHook(() => useAgentChangesRevert(options))
    await act(async () => {
      await result.current.revertHunk('a.txt', 'patch', '@@ -1 +1 @@')
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
    expect(agentChangesApi.revertAllAgentChanges).toHaveBeenCalledWith([
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', status: 'A' },
      { path: 'gone.txt', status: 'D' }
    ])
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
    else if (operation === 'ハンク') await state.revertHunk('a.txt', 'patch', '@@ -1 +1 @@')
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
