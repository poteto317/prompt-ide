import { describe, it, expect } from 'vitest'
import { toDirtySnapshot } from '../dirtySnapshot'
import type { DirtySnapshotSource } from '../dirtySnapshot'

const tab = (path: string, content: string, savedContent = content): DirtySnapshotSource => ({
  path,
  content,
  savedContent
})

describe('toDirtySnapshot', () => {
  it('タブが無ければ空の表現になる', () => {
    expect(toDirtySnapshot([])).toBe('[]')
  })

  it('未保存のタブが無ければ、保存済みのタブがあっても空の表現になる', () => {
    expect(toDirtySnapshot([tab('/p/a.md', 'a'), tab('/p/b.md', 'b')])).toBe('[]')
  })

  it('未保存のタブだけを、path と内容の組で表す', () => {
    expect(toDirtySnapshot([tab('/p/a.md', 'a'), tab('/p/b.md', 'edited', 'b')])).toBe(
      JSON.stringify([['/p/b.md', 'edited']])
    )
  })

  it('タブの並び(並べ替え)では値が変わらない(path の順に並べる)', () => {
    const a = tab('/p/a.md', 'A', 'a')
    const b = tab('/p/b.md', 'B', 'b')
    const c = tab('/p/c.md', 'C', 'c')
    const snapshot = toDirtySnapshot([a, b, c])
    expect(toDirtySnapshot([c, a, b])).toBe(snapshot)
    expect(toDirtySnapshot([b, c, a])).toBe(snapshot)
    expect(snapshot).toBe(
      JSON.stringify([
        ['/p/a.md', 'A'],
        ['/p/b.md', 'B'],
        ['/p/c.md', 'C']
      ])
    )
  })

  it('未保存の内容が変わると値が変わる', () => {
    expect(toDirtySnapshot([tab('/p/a.md', 'edit 1', 'a')])).not.toBe(
      toDirtySnapshot([tab('/p/a.md', 'edit 2', 'a')])
    )
  })

  it('未保存のタブの追加・保存・閉じるで値が変わる', () => {
    const before = toDirtySnapshot([tab('/p/a.md', 'A', 'a'), tab('/p/b.md', 'b')])
    // 追加(別のタブが未保存になる)
    expect(toDirtySnapshot([tab('/p/a.md', 'A', 'a'), tab('/p/b.md', 'B', 'b')])).not.toBe(before)
    // 保存(savedContent が内容に追いつく)
    expect(toDirtySnapshot([tab('/p/a.md', 'A'), tab('/p/b.md', 'b')])).not.toBe(before)
    // 閉じる
    expect(toDirtySnapshot([tab('/p/b.md', 'b')])).not.toBe(before)
  })
})
