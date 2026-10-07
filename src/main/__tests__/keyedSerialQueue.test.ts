import { describe, it, expect, vi } from 'vitest'
import { KeyedSerialQueue } from '../keyedSerialQueue'

// 外から終わらせられる task。started で開始を、release で終わりを制御する
function deferredTask<T>(value: T): {
  task: () => Promise<T>
  started: () => boolean
  release: () => void
  fail: (error: Error) => void
} {
  let started = false
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  return {
    task: () => {
      started = true
      return new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
    },
    started: () => started,
    release: () => resolve(value),
    fail: (error) => reject(error)
  }
}

describe('KeyedSerialQueue', () => {
  it('同じキーの task は積んだ順に 1 つずつ行い、それぞれの結果を返す', async () => {
    const queue = new KeyedSerialQueue()
    const order: string[] = []
    const first = deferredTask('a')
    const p1 = queue.enqueue(1, async () => {
      order.push('start1')
      const value = await first.task()
      order.push('end1')
      return value
    })
    const p2 = queue.enqueue(1, async () => {
      order.push('start2')
      return 'b'
    })
    await vi.waitFor(() => expect(first.started()).toBe(true))
    await Promise.resolve()
    expect(order).toEqual(['start1'])
    first.release()
    await expect(p1).resolves.toBe('a')
    await expect(p2).resolves.toBe('b')
    expect(order).toEqual(['start1', 'end1', 'start2'])
  })

  it('別のキーの task は互いを待たない', async () => {
    const queue = new KeyedSerialQueue()
    const blocked = deferredTask('slow')
    const slow = queue.enqueue(1, blocked.task)
    await expect(queue.enqueue(2, async () => 'fast')).resolves.toBe('fast')
    expect(blocked.started()).toBe(true)
    blocked.release()
    await expect(slow).resolves.toBe('slow')
  })

  it('失敗した task の失敗はその呼び出し元にだけ返り、後続の task は進む', async () => {
    const queue = new KeyedSerialQueue()
    const failing = deferredTask('never')
    const failed = queue.enqueue(1, failing.task)
    const next = queue.enqueue(1, async () => 'next')
    await vi.waitFor(() => expect(failing.started()).toBe(true))
    failing.fail(new Error('boom'))
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('next')
  })

  it('同期で throw した task も列を止めない', async () => {
    const queue = new KeyedSerialQueue()
    const failed = queue.enqueue(1, () => {
      throw new Error('sync')
    })
    await expect(failed).rejects.toThrow('sync')
    await expect(queue.enqueue(1, async () => 'after')).resolves.toBe('after')
  })

  it('列が空になったキーは消え、待ち・実行中のキーは残る', async () => {
    const queue = new KeyedSerialQueue()
    expect(queue.has(1)).toBe(false)
    const first = deferredTask(undefined)
    const second = deferredTask(undefined)
    const p1 = queue.enqueue(1, first.task)
    const p2 = queue.enqueue(1, second.task)
    expect(queue.has(1)).toBe(true)
    expect(queue.has(2)).toBe(false)
    await vi.waitFor(() => expect(first.started()).toBe(true))
    first.release()
    await p1
    // 後ろの task がまだ列にいるので、先の task の終わりではキーを消さない
    await vi.waitFor(() => expect(second.started()).toBe(true))
    await Promise.resolve()
    expect(queue.has(1)).toBe(true)
    second.release()
    await p2
    await vi.waitFor(() => expect(queue.has(1)).toBe(false))
  })

  it('失敗で終わったキーも消える', async () => {
    const queue = new KeyedSerialQueue()
    await expect(
      queue.enqueue(1, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await vi.waitFor(() => expect(queue.has(1)).toBe(false))
  })

  it('消えた後に積んだ task も前の task を待たずに始まる', async () => {
    const queue = new KeyedSerialQueue()
    await queue.enqueue(1, async () => 'a')
    await vi.waitFor(() => expect(queue.has(1)).toBe(false))
    await expect(queue.enqueue(1, async () => 'b')).resolves.toBe('b')
  })
})
