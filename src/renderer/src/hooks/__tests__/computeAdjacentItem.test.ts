import { describe, it, expect } from 'vitest'
import { computeAdjacentItem } from '../computeAdjacentItem'

describe('computeAdjacentItem', () => {
  it('removedIndex が -1 のとき先頭要素を返す', () => {
    expect(computeAdjacentItem(['a', 'b', 'c'], -1)).toBe('a')
  })

  it('removedIndex が -1 で配列が空のとき null を返す', () => {
    expect(computeAdjacentItem([], -1)).toBeNull()
  })

  it('removedIndex の位置に要素が残っていれば右隣(同じ位置に来た要素)を返す', () => {
    // 元は ['a', 'b', 'c'] から index 1 ('b') を削除 → next = ['a', 'c']
    expect(computeAdjacentItem(['a', 'c'], 1)).toBe('c')
  })

  it('removedIndex が末尾を超えるとき左隣を返す', () => {
    // 元は ['a', 'b', 'c'] から index 2 ('c'、末尾)を削除 → next = ['a', 'b']
    expect(computeAdjacentItem(['a', 'b'], 2)).toBe('b')
  })

  it('削除後に配列が空になったとき null を返す', () => {
    expect(computeAdjacentItem([], 0)).toBeNull()
  })
})
