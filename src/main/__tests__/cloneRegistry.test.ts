import { describe, it, expect } from 'vitest'
import { CLONE_ALREADY_RUNNING_MESSAGE, CloneRegistry } from '../cloneRegistry'

describe('CloneRegistry', () => {
  it('begin で実行中になり、end で解ける', () => {
    const registry = new CloneRegistry()
    const controller = registry.begin(1)
    expect(registry.isRunning(1)).toBe(true)
    registry.end(1, controller)
    expect(registry.isRunning(1)).toBe(false)
  })

  it('同じウィンドウで実行中なら拒否し、既存の clone は中止しない', () => {
    const registry = new CloneRegistry()
    const first = registry.begin(1)
    expect(() => registry.begin(1)).toThrow(CLONE_ALREADY_RUNNING_MESSAGE)
    expect(first.signal.aborted).toBe(false)
    expect(registry.isRunning(1)).toBe(true)
  })

  it('別のウィンドウは同時に実行できる', () => {
    const registry = new CloneRegistry()
    registry.begin(1)
    expect(() => registry.begin(2)).not.toThrow()
  })

  it('cancel は実行中の clone を中止する。実行中でなければ何もしない', () => {
    const registry = new CloneRegistry()
    expect(() => registry.cancel(1)).not.toThrow()
    const controller = registry.begin(1)
    registry.cancel(1)
    registry.cancel(1)
    expect(controller.signal.aborted).toBe(true)
  })

  it('古い controller の end は、新しい実行の登録を消さない', () => {
    const registry = new CloneRegistry()
    const first = registry.begin(1)
    registry.end(1, first)
    const second = registry.begin(1)
    registry.end(1, first)
    expect(registry.isRunning(1)).toBe(true)
    registry.cancel(1)
    expect(second.signal.aborted).toBe(true)
  })
})
