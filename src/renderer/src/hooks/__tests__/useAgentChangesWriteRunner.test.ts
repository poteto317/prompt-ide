import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgentChangesWriteRunner } from '../useAgentChangesWriteRunner'
import type { AgentChangesWriteRunnerOptions } from '../useAgentChangesWriteRunner'
import type { FileOperationLock } from '../useFileOperationLock'

const makeLock = (): FileOperationLock => ({
  isLocked: vi.fn(() => false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn(() => false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn()
})

function setup(initial: Partial<AgentChangesWriteRunnerOptions> = {}): {
  result: { current: ReturnType<typeof useAgentChangesWriteRunner> }
  rerender: (props: AgentChangesWriteRunnerOptions) => void
  options: AgentChangesWriteRunnerOptions
} {
  const options: AgentChangesWriteRunnerOptions = {
    folderPath: '/repo',
    recordStartedAt: 1,
    fileLock: makeLock(),
    ...initial
  }
  const { result, rerender } = renderHook(
    (props: AgentChangesWriteRunnerOptions) => useAgentChangesWriteRunner(props),
    {
      initialProps: options
    }
  )
  return { result, rerender, options }
}

const noHooks = { onResult: (): void => undefined, onError: (): void => undefined }

describe('useAgentChangesWriteRunner', () => {
  it('全体ロックの中で実行し、結果を返す。onResult は実行中の印を下ろす(ロックを外す)前に呼ぶ', async () => {
    const { result, options } = setup()
    const onResult = vi.fn()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run('file', 'a.txt', async () => 'done', {
        ...noHooks,
        onResult
      })
    })
    expect(outcome).toEqual({ ok: true, result: 'done' })
    expect(onResult).toHaveBeenCalledWith('done')
    expect(onResult.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
    )
    expect(options.fileLock.lockGlobal).toHaveBeenCalledOnce()
    expect(result.current.runningOperation).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it.each([
    ['file', 'revert'],
    ['hunk', 'revert'],
    ['all', 'revert'],
    ['undo', 'undo']
  ] as const)(
    'source %s の実行中の印は %s で、isRunning は同じ描画の中でも真',
    async (source, expected) => {
      const { result } = setup()
      let release: () => void = () => undefined
      let pending: Promise<unknown> = Promise.resolve()
      await act(async () => {
        pending = result.current.run(
          source,
          null,
          () => new Promise<void>((r) => (release = r)),
          noHooks
        )
        expect(result.current.isRunning()).toBe(true)
      })
      expect(result.current.runningOperation).toBe(expected)
      await act(async () => {
        release()
        await pending
      })
      expect(result.current.isRunning()).toBe(false)
    }
  )

  it('失敗したら onError を印を下ろす前に呼び、失敗の表示を出し、世代が同じなら onFailure を呼ぶ', async () => {
    const { result, options } = setup()
    const onError = vi.fn()
    const onFailure = vi.fn()
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run(
        'hunk',
        'a.txt',
        async () => {
          throw new Error('戻せません')
        },
        { onResult: vi.fn(), onError, onFailure }
      )
    })
    expect(outcome).toEqual({ ok: false })
    expect(onError.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(options.fileLock.unlockGlobal).mock.invocationCallOrder[0]
    )
    expect(result.current.error).toEqual({ message: '戻せません', path: 'a.txt', source: 'hunk' })
    expect(onFailure).toHaveBeenCalledWith('戻せません')
  })

  it('次の実行(戻す操作の失敗の後の取り消しなど)は、始めた時点で前の失敗の表示を消す', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.run(
        'file',
        'a.txt',
        async () => {
          throw new Error('戻せません')
        },
        noHooks
      )
    })
    expect(result.current.error).not.toBeNull()
    let resolveUndo: (value: string) => void = () => undefined
    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.run(
        'undo',
        null,
        () =>
          new Promise<string>((resolve) => {
            resolveUndo = resolve
          }),
        noHooks
      )
    })
    expect(result.current.error).toBeNull()
    expect(result.current.runningOperation).toBe('undo')
    await act(async () => {
      resolveUndo('done')
      await pending
    })
    expect(result.current.error).toBeNull()
  })

  it('実行中に記録が変わったら(新しい記録)、失敗を出さず onFailure を呼ばない。onError は呼ぶ', async () => {
    const { result, rerender, options } = setup()
    let reject: (error: Error) => void = () => undefined
    const onError = vi.fn()
    const onFailure = vi.fn()
    let pending: Promise<unknown> = Promise.resolve()
    await act(async () => {
      pending = result.current.run(
        'hunk',
        'a.txt',
        () => new Promise<void>((_r, j) => (reject = j)),
        {
          onResult: vi.fn(),
          onError,
          onFailure
        }
      )
    })
    rerender({ ...options, recordStartedAt: 2 })
    await act(async () => {
      reject(new Error('古い失敗'))
      await pending
    })
    expect(onError).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })

  it.each<[string, Partial<AgentChangesWriteRunnerOptions>]>([
    ['フォルダの変化', { folderPath: '/other' }],
    ['記録の変化', { recordStartedAt: 200 }]
  ])('captureGeneration の世代は%sで古くなり、失敗の表示を消す', async (_label, change) => {
    const { result, rerender, options } = setup()
    await act(async () => {
      await result.current.run(
        'file',
        'a.txt',
        async () => {
          throw new Error('x')
        },
        noHooks
      )
    })
    const generation = result.current.captureGeneration()
    expect(result.current.isCurrentGeneration(generation)).toBe(true)
    rerender({ ...options, ...change })
    expect(result.current.isCurrentGeneration(generation)).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('showWarning は世代が同じときだけ警告を出す(path は null)', () => {
    const { result, rerender, options } = setup()
    const generation = result.current.captureGeneration()
    act(() => result.current.showWarning('途中で失敗', 'all', generation))
    expect(result.current.error).toEqual({ message: '途中で失敗', path: null, source: 'all' })
    rerender({ ...options, recordStartedAt: null })
    act(() => result.current.showWarning('古い警告', 'all', generation))
    expect(result.current.error).toBeNull()
  })
})
