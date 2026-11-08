import { describe, it, expect } from 'vitest'
import type { FileTreeNode } from '../../types'
import { isSameFileTree } from '../fileTreeEquality'

const tree = (): FileTreeNode[] => [
  {
    name: 'src',
    path: '/p/src',
    type: 'directory',
    children: [{ name: 'a.ts', path: '/p/src/a.ts', type: 'file' }]
  },
  { name: 'b.txt', path: '/p/b.txt', type: 'file' }
]

// 構造の比べの規則(undefined のキー・配列の順・undefined と空の配列)そのものは plainDataEquality.test.ts で確かめる。
// ここでは、ツリーのノードの欄と children の違いを見落とさないことを確かめる
describe('isSameFileTree', () => {
  it('中身が同じ別の配列 → true', () => {
    expect(isSameFileTree(tree(), tree())).toBe(true)
  })

  it('同じ参照 → true', () => {
    const t = tree()
    expect(isSameFileTree(t, t)).toBe(true)
  })

  it.each<[string, (t: FileTreeNode[]) => FileTreeNode[]]>([
    ['名前が違う', (t) => [{ ...t[0], name: 'lib' }, t[1]]],
    ['パスが違う', (t) => [t[0], { ...t[1], path: '/p/c.txt' }]],
    [
      '種類と子の欄が違う(ファイル → 子が空のフォルダ)',
      (t) => [t[0], { ...t[1], type: 'directory', children: [] }]
    ],
    [
      '子が違う',
      (t) => [{ ...t[0], children: [{ name: 'x.ts', path: '/p/src/x.ts', type: 'file' }] }, t[1]]
    ],
    ['子が無い(undefined)と子がある', (t) => [{ ...t[0], children: undefined }, t[1]]],
    ['順が違う', (t) => [t[1], t[0]]],
    ['長さが違う', (t) => [t[0]]]
  ])('%s → false', (_label, change) => {
    expect(isSameFileTree(tree(), change(tree()))).toBe(false)
  })
})
