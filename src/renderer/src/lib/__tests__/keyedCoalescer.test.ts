import { describe, it, expect, vi } from 'vitest'
import { createKeyedCoalescer } from '../keyedCoalescer'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const ignoreError = (): void => undefined

// 実行中の非同期の処理を進める
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createKeyedCoalescer', () => {
  it('実行していないキーはすぐに 1 回実行する', async () => {
    const run = vi.fn(async (): Promise<void> => undefined)
    const coalescer = createKeyedCoalescer({
      toKey: (s: string) => s,
      run,
      onError: ignoreError,
      isDisposed: () => false
    })
    coalescer.schedule('a')
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('a')
  })

  it('実行中に同じキーが何度届いても、終わった後の 1 回にまとめる', async () => {
    const first = deferred()
    const run = vi
      .fn<(item: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const coalescer = createKeyedCoalescer({
      toKey: (s: string) => s,
      run,
      onError: ignoreError,
      isDisposed: () => false
    })
    coalescer.schedule('a')
    coalescer.schedule('a')
    coalescer.schedule('a')
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    first.resolve()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    // まとめた後は解放され、次の依頼でまた実行する
    coalescer.schedule('a')
    await flush()
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('比較用のキーが同じなら、最初に届いた値で実行し直す', async () => {
    const first = deferred()
    const run = vi
      .fn<(item: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const coalescer = createKeyedCoalescer({
      toKey: (s: string) => s.toLowerCase(),
      run,
      onError: ignoreError,
      isDisposed: () => false
    })
    coalescer.schedule('/A.md')
    coalescer.schedule('/a.md')
    first.resolve()
    await flush()
    expect(run.mock.calls).toEqual([['/A.md'], ['/A.md']])
  })

  it('別のキーは並行して実行する', async () => {
    const first = deferred()
    const run = vi
      .fn<(item: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const coalescer = createKeyedCoalescer({
      toKey: (s: string) => s,
      run,
      onError: ignoreError,
      isDisposed: () => false
    })
    coalescer.schedule('a')
    coalescer.schedule('b')
    await flush()
    expect(run.mock.calls).toEqual([['a'], ['b']])
    first.resolve()
    await flush()
  })

  it('破棄されたら、まとめた次の実行をしない', async () => {
    const first = deferred()
    let disposed = false
    const run = vi
      .fn<(item: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const coalescer = createKeyedCoalescer({
      toKey: (s: string) => s,
      run,
      onError: ignoreError,
      isDisposed: () => disposed
    })
    coalescer.schedule('a')
    coalescer.schedule('a')
    disposed = true
    first.resolve()
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('例外で終わったら onError に渡し、キーを解放して、まとめた次の実行はしない', async () => {
    const first = deferred()
    const onError = vi.fn()
    const run = vi
      .fn<(item: string) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined)
    const coalescer = createKeyedCoalescer({
      toKey: (s: string) => s,
      run,
      onError,
      isDisposed: () => false
    })
    coalescer.schedule('a')
    coalescer.schedule('a')
    const boom = new Error('boom')
    first.reject(boom)
    await flush()
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom)
    expect(run).toHaveBeenCalledTimes(1)
    coalescer.schedule('a')
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
