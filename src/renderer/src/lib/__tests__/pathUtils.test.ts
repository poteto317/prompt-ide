import { describe, it, expect } from 'vitest'
import { isPathAtOrInside, isPathInside } from '../pathUtils'

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

  it('parentPath の末尾に区切りが付いていても内部にあるパスを true と判定する', () => {
    expect(isPathInside('/project/src/index.ts', '/project/src/')).toBe(true)
  })

  it('parentPath の末尾が \\ でも内部にあるパスを true と判定する', () => {
    expect(isPathInside('C:\\project\\src\\index.ts', 'C:\\project\\src\\')).toBe(true)
  })

  it('親子で区切り文字が混在していても内部にあるパスを true と判定する', () => {
    expect(isPathInside('C:/project/src/index.ts', 'C:\\project\\src')).toBe(true)
  })

  it('childPath の末尾に区切りが付いていて親と実質同一パスのとき false を返す(内部ではなく同一パス)', () => {
    expect(isPathInside('/project/src/', '/project/src')).toBe(false)
  })

  it('parentPath がファイルシステムルート "/" のとき、ルート自身は内部ではないため false を返す', () => {
    expect(isPathInside('/', '/')).toBe(false)
  })

  it('parentPath がファイルシステムルート "/" のとき、退化してあらゆる絶対パスを内部と誤判定しない', () => {
    expect(isPathInside('/etc/passwd', '/')).toBe(false)
  })

  it('parentPath が空文字列のとき、退化してあらゆる絶対パスを内部と誤判定しない', () => {
    expect(isPathInside('/project/src/index.ts', '')).toBe(false)
  })
})

describe('isPathAtOrInside', () => {
  it('同一パスを配下とみなす', () => {
    expect(isPathAtOrInside('/a/b', '/a/b')).toBe(true)
  })

  it('末尾の区切りが違っても同一とみなす', () => {
    expect(isPathAtOrInside('/a/b', '/a/b/')).toBe(true)
  })

  it('配下のパスを true にする', () => {
    expect(isPathAtOrInside('/a/b/c.ts', '/a/b')).toBe(true)
  })

  it('無関係なパスは false', () => {
    expect(isPathAtOrInside('/a/bc.ts', '/a/b')).toBe(false)
  })

  it('ルートはすべての絶対パスの親として扱う', () => {
    // isPathInside はルート特例で false を返すため、予約の判定はこちらを使う
    expect(isPathAtOrInside('/a.ts', '/')).toBe(true)
    expect(isPathAtOrInside('/a/b/c.ts', '/')).toBe(true)
    expect(isPathAtOrInside('/', '/')).toBe(true)
  })

  it('Windows の区切りでも判定できる', () => {
    expect(isPathAtOrInside('C:\\dir\\a.ts', 'C:\\dir')).toBe(true)
  })

  it('Windows のドライブルートも配下判定できる', () => {
    // 'C:\\' は正規化で 'C:' になり、'C:/a.ts' の接頭辞判定が成立する
    expect(isPathAtOrInside('C:\\a.ts', 'C:\\')).toBe(true)
    expect(isPathAtOrInside('C:\\dir\\a.ts', 'C:\\')).toBe(true)
    expect(isPathAtOrInside('C:/a.ts', 'C:/')).toBe(true)
    expect(isPathAtOrInside('C:\\', 'C:\\')).toBe(true)
  })

  it('別のドライブは配下とみなさない', () => {
    expect(isPathAtOrInside('D:\\a.ts', 'C:\\')).toBe(false)
  })

  it('空文字列を親にしても配下とみなさない', () => {
    expect(isPathAtOrInside('/a.ts', '')).toBe(false)
  })
})
