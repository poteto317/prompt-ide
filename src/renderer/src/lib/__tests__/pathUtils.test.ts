import { describe, it, expect } from 'vitest'
import { isPathInside } from '../pathUtils'

describe('isPathInside', () => {
  it('/ 区切りで親の内部にあるとき true を返す', () => {
    expect(isPathInside('/project/src/index.ts', '/project/src')).toBe(true)
  })

  it('\\ 区切りで親の内部にあるとき true を返す', () => {
    expect(isPathInside('C:\\project\\src\\index.ts', 'C:\\project\\src')).toBe(true)
  })

  it('親そのものと同じパスのとき false を返す(内部ではなく等値)', () => {
    expect(isPathInside('/project/src', '/project/src')).toBe(false)
  })

  it('親の外にあるとき false を返す', () => {
    expect(isPathInside('/project/other/index.ts', '/project/src')).toBe(false)
  })

  it('前方一致だが別ディレクトリの偽陽性を返さない（src と src-backup）', () => {
    expect(isPathInside('/project/src-backup/index.ts', '/project/src')).toBe(false)
  })

  it('兄弟パスのとき false を返す', () => {
    expect(isPathInside('/project/lib/index.ts', '/project/src')).toBe(false)
  })
})
