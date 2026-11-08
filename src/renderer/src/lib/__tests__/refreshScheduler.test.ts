import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRefreshScheduler } from '../refreshScheduler'
import type { RefreshScheduler, RefreshSchedulerOptions } from '../refreshScheduler'

interface Request {
  tree: boolean
}

const WAIT_MS = 50
const MAX_WAIT_MS = 300

function setup(overrides: Partial<RefreshSchedulerOptions<Request>> = {}): {
  scheduler: RefreshScheduler<Request>
  run: ReturnType<typeof vi.fn<RefreshSchedulerOptions<Request>['run']>>
  setAccepting: (value: boolean) => void
} {
  const run = vi.fn<RefreshSchedulerOptions<Request>['run']>(async () => undefined)
  let accepting = true
  const scheduler = createRefreshScheduler<Request>({
    waitMs: WAIT_MS,
    maxWaitMs: MAX_WAIT_MS,
    merge: (a, b) => ({ tree: a.tree || b.tree }),
    run,
    accepts: () => accepting,
    ...overrides
  })
  return {
    scheduler,
    run,
    setAccepting: (value) => {
      accepting = value
    }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: Error) => void } {
  let resolve: () => void = () => undefined
  let reject: (err: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createRefreshScheduler', () => {
  it('最後の依頼から待ちの時間の後に 1 回だけ走らせる', async () => {
    const { scheduler, run } = setup()
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledExactlyOnceWith({ tree: false })
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).toHaveBeenCalledOnce()
  })

  it('依頼が続いても、最初の未処理の依頼から上限で走らせる(L-399)', async () => {
    const { scheduler, run } = setup()
    for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += 40) {
      scheduler.schedule({ tree: false })
      await vi.advanceTimersByTimeAsync(40)
    }
    expect(run).toHaveBeenCalledOnce()
  })

  it('未処理の依頼どうしを merge でまとめる', async () => {
    const { scheduler, run } = setup()
    scheduler.schedule({ tree: false })
    scheduler.schedule({ tree: true })
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledExactlyOnceWith({ tree: true })
  })

  it('実行中に届いた依頼は、終わった後の 1 回にまとめて走らせる', async () => {
    const { scheduler, run } = setup()
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledOnce()
    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run.mock.calls).toEqual([[{ tree: false }], [{ tree: true }]])
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('accepts が偽の間の依頼 → 予約しない(後で真になっても走らない)', async () => {
    const { scheduler, run, setAccepting } = setup()
    setAccepting(false)
    scheduler.schedule({ tree: true })
    setAccepting(true)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('予約の後に accepts が偽になる → 走らせる時に未処理を捨てる', async () => {
    const { scheduler, run, setAccepting } = setup()
    scheduler.schedule({ tree: true })
    setAccepting(false)
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    setAccepting(true)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('reset → 予約と未処理を捨てる', async () => {
    const { scheduler, run } = setup()
    scheduler.schedule({ tree: true })
    scheduler.reset()
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).not.toHaveBeenCalled()
  })

  it('reset の後 → 古い完了がやり直しを起こさず、新しい依頼は待たずに予約できる(L-108)', async () => {
    const { scheduler, run } = setup()
    const first = deferred()
    run.mockReturnValueOnce(first.promise)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.reset()
    first.resolve()
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(run).toHaveBeenCalledOnce()
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reset の後に始めた実行の最中に古い完了が届く → 新しい実行を終えたことにせず、並行して走らせない(L-108)', async () => {
    const { scheduler, run } = setup()
    const first = deferred()
    const second = deferred()
    run.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.reset()
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
    second.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('run が reject → 止まらず、次の依頼を走らせる', async () => {
    const { scheduler, run } = setup()
    run.mockRejectedValueOnce(new Error('failed'))
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('run が同期で投げる → schedule のタイマーから投げず、次の依頼を走らせる', async () => {
    const { scheduler, run } = setup()
    run.mockImplementationOnce(() => {
      throw new Error('sync failure')
    })
    scheduler.schedule({ tree: false })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    scheduler.schedule({ tree: true })
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(run).toHaveBeenCalledTimes(2)
  })
})
