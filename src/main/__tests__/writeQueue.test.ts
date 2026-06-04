import { describe, it, expect, vi } from 'vitest'
import { WriteQueue } from '../writeQueue'

describe('WriteQueue', () => {
  describe('直列実行', () => {
    it('タスクが順番に実行される', async () => {
      const queue = new WriteQueue()
      const order: number[] = []

      await Promise.all([
        queue.enqueue(async () => { order.push(1) }),
        queue.enqueue(async () => { order.push(2) }),
        queue.enqueue(async () => { order.push(3) })
      ])

      expect(order).toEqual([1, 2, 3])
    })

    it('先行タスクが完了するまで後続タスクは開始しない', async () => {
      const queue = new WriteQueue()
      let firstStarted = false
      let secondStarted = false

      let resolveFirst!: () => void
      const p1 = queue.enqueue(() => new Promise<void>((resolve) => {
        firstStarted = true
        resolveFirst = resolve
      }))
      const p2 = queue.enqueue(async () => { secondStarted = true })

      await vi.waitFor(() => expect(firstStarted).toBe(true))
      expect(secondStarted).toBe(false)

      resolveFirst()
      await Promise.all([p1, p2])
      expect(secondStarted).toBe(true)
    })
  })

  describe('エラーハンドリング', () => {
    it('先行タスクが失敗しても後続タスクは実行される', async () => {
      const queue = new WriteQueue()
      const executed: string[] = []

      const p1 = queue.enqueue(async () => {
        executed.push('first')
        throw new Error('失敗')
      })
      const p2 = queue.enqueue(async () => { executed.push('second') })

      await expect(p1).rejects.toThrow('失敗')
      await expect(p2).resolves.toBeUndefined()
      expect(executed).toEqual(['first', 'second'])
    })

    it('enqueue した Promise 自体はエラーを伝播する', async () => {
      const queue = new WriteQueue()
      await expect(
        queue.enqueue(async () => { throw new Error('タスクエラー') })
      ).rejects.toThrow('タスクエラー')
    })

    it('複数タスクが失敗しても残りは実行される', async () => {
      const queue = new WriteQueue()
      const results: string[] = []

      const tasks = [
        queue.enqueue(async () => { results.push('ok1') }),
        queue.enqueue(async () => { throw new Error('fail') }),
        queue.enqueue(async () => { results.push('ok2') })
      ]

      await Promise.allSettled(tasks)
      expect(results).toEqual(['ok1', 'ok2'])
    })
  })

  describe('戻り値', () => {
    it('タスクの戻り値を返す', async () => {
      const queue = new WriteQueue()
      const result = await queue.enqueue(async () => 42)
      expect(result).toBe(42)
    })
  })

  describe('インスタンス独立性', () => {
    it('別インスタンスのキューは独立している', async () => {
      const qA = new WriteQueue()
      const qB = new WriteQueue()
      const order: string[] = []

      let resolveA!: () => void
      const pA = qA.enqueue(() => new Promise<void>((r) => { resolveA = r }))
      qA.enqueue(async () => { order.push('A2') })
      qB.enqueue(async () => { order.push('B1') })

      await vi.waitFor(() => expect(order).toContain('B1'))
      expect(order).not.toContain('A2')

      resolveA()
      await pA
      await vi.waitFor(() => expect(order).toContain('A2'))
    })
  })
})
