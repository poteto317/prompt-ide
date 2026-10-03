import { renderHook, act, waitFor } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CloneRepositoryResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useCloneRepository } from '../useCloneRepository'
import type { UseCloneRepositoryOptions } from '../useCloneRepository'
import { useFileOperationLock } from '../useFileOperationLock'
import type { FileOperationLock } from '../useFileOperationLock'
import type { CloneRepositoryPanelState } from '../../types'

const mockCloneRepository = vi.mocked(gitApi.cloneRepository)
const mockCancelCloneRepository = vi.mocked(gitApi.cancelCloneRepository)

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

type Overrides = Partial<Omit<UseCloneRepositoryOptions, 'lock'>>
type CloneOptions = Omit<UseCloneRepositoryOptions, 'lock'>
type RenderedClone = RenderHookResult<
  { lock: FileOperationLock; clone: CloneRepositoryPanelState },
  { isGitOperationRunning: boolean }
> & { options: CloneOptions }

// 実物のロック(useFileOperationLock)と組み合わせて描画する
function renderClone(overrides: Overrides = {}): RenderedClone {
  const options: CloneOptions = {
    captureDirtySnapshot: vi.fn<() => string>().mockReturnValue('[]'),
    confirmDiscardAnyDirty: vi.fn<() => boolean>().mockReturnValue(true),
    applyOpenedFolder: vi
      .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
      .mockResolvedValue(undefined),
    isGitOperationRunning: false,
    ...overrides
  }
  const hook = renderHook(
    (props: { isGitOperationRunning: boolean }) => {
      const lock = useFileOperationLock()
      return {
        lock,
        clone: useCloneRepository({ ...options, ...props, lock })
      }
    },
    { initialProps: { isGitOperationRunning: options.isGitOperationRunning } }
  )
  return { ...hook, options }
}

beforeEach(() => {
  // 持続する実装を前のテストから持ち込まない(パターン 103)
  vi.resetAllMocks()
  mockCancelCloneRepository.mockResolvedValue(undefined)
})

describe('useCloneRepository', () => {
  it('確認 → clone の依頼 → 返ったパスを開く。開き終わるまで実行中で全体ロックを持つ', async () => {
    const clone = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(clone.promise)
    const opened = deferred<void>()
    const { result, options } = renderClone({
      applyOpenedFolder: vi
        .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
        .mockReturnValueOnce(opened.promise)
    })
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => {
      running = result.current.clone.cloneRepository('https://github.com/a/b.git', 'b')
    })
    expect(options.confirmDiscardAnyDirty).toHaveBeenCalledOnce()
    expect(mockCloneRepository).toHaveBeenCalledWith('https://github.com/a/b.git', 'b')
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.lock.isAnyLocked()).toBe(true)
    await act(async () => {
      clone.resolve({ status: 'cloned', path: '/parent/b' })
    })
    expect(options.applyOpenedFolder).toHaveBeenCalledWith('/parent/b', {
      dirtySnapshotAtConfirm: '[]'
    })
    // フォルダの読み込み中も実行中のまま(フォルダの変更・clone を押させない)
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.lock.isAnyLocked()).toBe(true)
    await act(async () => {
      opened.resolve()
      expect(await running).toBe(true)
    })
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('確認の時点の未保存の内容(captureDirtySnapshot)を確認より前に測り、開くときに渡す', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'cloned', path: '/parent/b' })
    const order: string[] = []
    const { result, options } = renderClone({
      captureDirtySnapshot: vi.fn(() => {
        order.push('measure')
        return 'snapshot-at-confirm'
      }),
      confirmDiscardAnyDirty: vi.fn(() => {
        order.push('confirm')
        return true
      })
    })
    await act(async () => {
      await result.current.clone.cloneRepository('u', 'b')
    })
    expect(order).toEqual(['measure', 'confirm'])
    expect(options.applyOpenedFolder).toHaveBeenCalledWith('/parent/b', {
      dirtySnapshotAtConfirm: 'snapshot-at-confirm'
    })
  })

  it('未保存の確認を取り消したら、依頼せずに false', async () => {
    const { result } = renderClone({ confirmDiscardAnyDirty: vi.fn(() => false) })
    let opened = true
    await act(async () => {
      opened = await result.current.clone.cloneRepository('u', 'b')
    })
    expect(opened).toBe(false)
    expect(mockCloneRepository).not.toHaveBeenCalled()
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('canceled(保存先の選択の取り消し・中止)は開かずに false。エラーは出さない', async () => {
    mockCloneRepository.mockResolvedValueOnce({ status: 'canceled' })
    const { result, options } = renderClone()
    let opened = true
    await act(async () => {
      opened = await result.current.clone.cloneRepository('u', 'b')
    })
    expect(opened).toBe(false)
    expect(options.applyOpenedFolder).not.toHaveBeenCalled()
    expect(result.current.clone.error).toBeNull()
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('失敗はエラーにして false。ロックと実行中を解く', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('リポジトリを clone できませんでした: x'))
    const { result } = renderClone()
    let opened = true
    await act(async () => {
      opened = await result.current.clone.cloneRepository('u', 'b')
    })
    expect(opened).toBe(false)
    expect(result.current.clone.error?.message).toBe('リポジトリを clone できませんでした: x')
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.lock.isAnyLocked()).toBe(false)
  })

  it('再試行の開始時に前回のエラーを消す', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = renderClone()
    await act(async () => {
      await result.current.clone.cloneRepository('u', 'b')
    })
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    act(() => {
      void result.current.clone.cloneRepository('u', 'b')
    })
    expect(result.current.clone.error).toBeNull()
    await act(async () => {
      pending.resolve({ status: 'canceled' })
    })
  })

  // clone が cloned で返った後のフォルダの読み込み中は、main に中止する clone がもう無い。isOpening で表し、
  // ダイアログの「キャンセルで中止できます」の案内と押せるのに効かない `キャンセル` を出さない
  it('cloned で返ってから開き終わるまでだけ isOpening が true(isCloning も true)。その間 cancelClone は main へ依頼しない', async () => {
    const clone = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(clone.promise)
    const opened = deferred<void>()
    const { result } = renderClone({
      applyOpenedFolder: vi
        .fn<UseCloneRepositoryOptions['applyOpenedFolder']>()
        .mockReturnValueOnce(opened.promise)
    })
    expect(result.current.clone.isOpening).toBe(false)
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => {
      running = result.current.clone.cloneRepository('u', 'b')
    })
    // clone の実行中(保存先の選択・clone)は開いていない
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.clone.isOpening).toBe(false)
    await act(async () => {
      clone.resolve({ status: 'cloned', path: '/parent/b' })
    })
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.clone.isOpening).toBe(true)
    act(() => result.current.clone.cancelClone())
    expect(mockCancelCloneRepository).not.toHaveBeenCalled()
    await act(async () => {
      opened.resolve()
      await running
    })
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.clone.isOpening).toBe(false)
  })

  // clone の結果を保留にして、保留中と決着の後の isOpening を見る(保存先の選択・clone の間に true にしないことも含む)
  it.each<
    [
      string,
      (settle: { resolve: (r: CloneRepositoryResult) => void; reject: (e: Error) => void }) => void
    ]
  >([
    ['取り消し・中止(canceled)', ({ resolve }) => resolve({ status: 'canceled' })],
    ['失敗', ({ reject }) => reject(new Error('リポジトリを clone できませんでした: x'))]
  ])('%s では isOpening が true にならない', async (_label, settle) => {
    let resolve!: (r: CloneRepositoryResult) => void
    let reject!: (e: Error) => void
    mockCloneRepository.mockReturnValueOnce(
      new Promise<CloneRepositoryResult>((res, rej) => {
        resolve = res
        reject = rej
      })
    )
    const { result, options } = renderClone()
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => {
      running = result.current.clone.cloneRepository('u', 'b')
    })
    expect(result.current.clone.isOpening).toBe(false)
    await act(async () => {
      settle({ resolve, reject })
      await running
    })
    expect(result.current.clone.isOpening).toBe(false)
    expect(result.current.clone.isCloning).toBe(false)
    expect(options.applyOpenedFolder).not.toHaveBeenCalled()
  })

  // useAppState の「Git 操作の実行中」の合成はロックを含むため、clone 自身の全体ロックでも true になる。isBlocked は
  // 契約どおり「他の Git 操作の実行中」だけを表し、clone の実行中は false にする
  it('clone の実行中は、Git 操作の実行中(自身の全体ロックを含む合成)が true でも isBlocked が false', async () => {
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderClone()
    act(() => {
      void result.current.clone.cloneRepository('u', 'b')
    })
    rerender({ isGitOperationRunning: true })
    expect(result.current.clone.isCloning).toBe(true)
    expect(result.current.clone.isBlocked).toBe(false)
    await act(async () => {
      pending.resolve({ status: 'canceled' })
    })
    // clone が終わっても他の Git 操作の実行中なら、isBlocked は true に戻る
    expect(result.current.clone.isCloning).toBe(false)
    expect(result.current.clone.isBlocked).toBe(true)
  })

  // 各シナリオは「始められない状態」を作り、後始末を返す。始められない状態での cloneRepository は false を返し、
  // 確認も main への依頼もしない(呼び出しの回数が状態を作った時点から増えない)
  it.each<[string, (rendered: RenderedClone) => () => Promise<void>]>([
    [
      '他の Git 操作の実行中',
      ({ result, rerender }) => {
        rerender({ isGitOperationRunning: true })
        expect(result.current.clone.isBlocked).toBe(true)
        return async () => undefined
      }
    ],
    [
      'ロック中',
      ({ result }) => {
        act(() => result.current.lock.lock('/project/a.ts'))
        expect(result.current.clone.isBlocked).toBe(false)
        return async () => act(() => result.current.lock.unlock('/project/a.ts'))
      }
    ],
    [
      'clone の実行中',
      ({ result }) => {
        const pending = deferred<CloneRepositoryResult>()
        mockCloneRepository.mockReturnValueOnce(pending.promise)
        act(() => {
          void result.current.clone.cloneRepository('u', 'b')
        })
        return async () => {
          await act(async () => {
            pending.resolve({ status: 'canceled' })
          })
        }
      }
    ]
  ])('%s は何もしない(確認も出さない)', async (_label, arrange) => {
    const rendered = renderClone()
    const cleanup = arrange(rendered)
    const confirmCalls = vi.mocked(rendered.options.confirmDiscardAnyDirty).mock.calls.length
    const cloneCalls = mockCloneRepository.mock.calls.length
    await act(async () => {
      expect(await rendered.result.current.clone.cloneRepository('u', 'c')).toBe(false)
    })
    expect(rendered.options.confirmDiscardAnyDirty).toHaveBeenCalledTimes(confirmCalls)
    expect(mockCloneRepository).toHaveBeenCalledTimes(cloneCalls)
    await cleanup()
  })

  it('cancelClone は実行中だけ main へ中止を依頼し、依頼の失敗は表示しない', async () => {
    const { result } = renderClone()
    act(() => result.current.clone.cancelClone())
    expect(mockCancelCloneRepository).not.toHaveBeenCalled()
    const pending = deferred<CloneRepositoryResult>()
    mockCloneRepository.mockReturnValueOnce(pending.promise)
    mockCancelCloneRepository.mockRejectedValueOnce(new Error('ipc failed'))
    act(() => {
      void result.current.clone.cloneRepository('u', 'b')
    })
    act(() => result.current.clone.cancelClone())
    expect(mockCancelCloneRepository).toHaveBeenCalledOnce()
    await act(async () => {
      pending.resolve({ status: 'canceled' })
    })
    await waitFor(() => expect(result.current.clone.isCloning).toBe(false))
    expect(result.current.clone.error).toBeNull()
  })

  it('clearError でエラーを消す', async () => {
    mockCloneRepository.mockRejectedValueOnce(new Error('失敗'))
    const { result } = renderClone()
    await act(async () => {
      await result.current.clone.cloneRepository('u', 'b')
    })
    act(() => result.current.clone.clearError())
    expect(result.current.clone.error).toBeNull()
  })
})
