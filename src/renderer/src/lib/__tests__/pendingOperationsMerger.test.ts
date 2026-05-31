import { describe, it, expect } from 'vitest'
import type { Prompt } from '../../types'
import { mergePendingOps, type PendingOp } from '../pendingOperationsMerger'

const p = (id: string): Prompt => ({ id, title: `T${id}`, content: `C${id}`, createdAt: 1 })

describe('mergePendingOps', () => {
  it('pending が空のとき loaded をそのまま返す', () => {
    const loaded = [p('a'), p('b')]
    expect(mergePendingOps(loaded, [])).toEqual(loaded)
  })

  it('loaded が空かつ pending も空のとき空配列を返す', () => {
    expect(mergePendingOps([], [])).toEqual([])
  })

  it('add op が適用されてプロンプトが末尾に追加される', () => {
    const loaded = [p('a')]
    const pending: PendingOp[] = [{ type: 'add', prompt: p('b') }]
    const result = mergePendingOps(loaded, pending)
    expect(result).toHaveLength(2)
    expect(result[1].id).toBe('b')
  })

  it('delete op が適用されて指定 ID が削除される', () => {
    const loaded = [p('a'), p('b'), p('c')]
    const pending: PendingOp[] = [{ type: 'delete', id: 'b' }]
    const result = mergePendingOps(loaded, pending)
    expect(result).toHaveLength(2)
    expect(result.map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('add → delete を順に適用してもマージが正しい', () => {
    const loaded = [p('a')]
    const pending: PendingOp[] = [
      { type: 'add', prompt: p('b') },
      { type: 'delete', id: 'b' },
    ]
    const result = mergePendingOps(loaded, pending)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('delete → add を順に適用してもマージが正しい', () => {
    const loaded = [p('a'), p('b')]
    const pending: PendingOp[] = [
      { type: 'delete', id: 'a' },
      { type: 'add', prompt: p('c') },
    ]
    const result = mergePendingOps(loaded, pending)
    expect(result.map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('存在しない ID を delete しても他が変わらない', () => {
    const loaded = [p('a'), p('b')]
    const pending: PendingOp[] = [{ type: 'delete', id: 'non-existent' }]
    const result = mergePendingOps(loaded, pending)
    expect(result).toEqual(loaded)
  })

  it('複数の add が順番通りに追加される', () => {
    const loaded: Prompt[] = []
    const pending: PendingOp[] = [
      { type: 'add', prompt: p('x') },
      { type: 'add', prompt: p('y') },
      { type: 'add', prompt: p('z') },
    ]
    const result = mergePendingOps(loaded, pending)
    expect(result.map((x) => x.id)).toEqual(['x', 'y', 'z'])
  })

  it('add と delete が混在しても最終状態が正しい', () => {
    const loaded = [p('a'), p('b')]
    const pending: PendingOp[] = [
      { type: 'add', prompt: p('c') },
      { type: 'delete', id: 'a' },
      { type: 'add', prompt: p('d') },
      { type: 'delete', id: 'c' },
    ]
    const result = mergePendingOps(loaded, pending)
    expect(result.map((x) => x.id)).toEqual(['b', 'd'])
  })

  it('loaded を変更せず新しい配列を返す（副作用なし）', () => {
    const loaded = [p('a')]
    const pending: PendingOp[] = [{ type: 'add', prompt: p('b') }]
    const result = mergePendingOps(loaded, pending)
    expect(loaded).toHaveLength(1)
    expect(result).toHaveLength(2)
  })

  it('update op が適用されて title と content が更新される', () => {
    const loaded = [p('a'), p('b')]
    const pending: PendingOp[] = [{ type: 'update', id: 'a', title: '新Ta', content: '新Ca' }]
    const result = mergePendingOps(loaded, pending)
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('新Ta')
    expect(result[0].content).toBe('新Ca')
    expect(result[0].id).toBe('a')
  })

  it('update op は createdAt を変更しない', () => {
    const loaded = [{ id: 'a', title: 'T', content: 'C', createdAt: 999 }]
    const pending: PendingOp[] = [{ type: 'update', id: 'a', title: '新T', content: '新C' }]
    const result = mergePendingOps(loaded, pending)
    expect(result[0].createdAt).toBe(999)
  })

  it('存在しない ID を update しても他が変わらない', () => {
    const loaded = [p('a')]
    const pending: PendingOp[] = [{ type: 'update', id: 'non-existent', title: '新T', content: '新C' }]
    const result = mergePendingOps(loaded, pending)
    expect(result).toEqual(loaded)
  })

  it('add → update を順に適用してもマージが正しい', () => {
    const loaded: Prompt[] = []
    const pending: PendingOp[] = [
      { type: 'add', prompt: p('x') },
      { type: 'update', id: 'x', title: '更新Tx', content: '更新Cx' },
    ]
    const result = mergePendingOps(loaded, pending)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('更新Tx')
    expect(result[0].content).toBe('更新Cx')
  })
})
