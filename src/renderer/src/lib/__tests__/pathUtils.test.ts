import { describe, it, expect } from 'vitest'
import {
  isPathAtOrInside,
  isPathInside,
  isSamePath,
  joinPath,
  isSafeEntryName,
  replacePathPrefix
} from '../pathUtils'

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

describe('Windows パスの大文字小文字', () => {
  it('ドライブ文字が違う表記でも同じパスとみなす', () => {
    // Windows は大文字小文字を区別しない。区別すると case-only rename 中に
    // 旧表記の削除が mutex の重複判定をすり抜ける
    expect(isPathAtOrInside('C:\\Project\\Foo.ts', 'c:\\project\\foo.ts')).toBe(true)
    expect(isPathInside('C:\\Project\\Foo.ts', 'c:\\project')).toBe(true)
    expect(isPathAtOrInside('c:\\project\\sub\\a.ts', 'C:\\Project')).toBe(true)
  })

  it('UNC パスでも大文字小文字を無視する', () => {
    expect(isPathAtOrInside('\\\\Server\\Share\\A.ts', '\\\\server\\share')).toBe(true)
  })

  it('別ドライブは表記を揃えても配下とみなさない', () => {
    expect(isPathAtOrInside('D:\\project\\a.ts', 'c:\\project')).toBe(false)
  })

  it('POSIX パスは大文字小文字を区別したままにする', () => {
    expect(isPathInside('/Project/Foo.ts', '/project')).toBe(false)
    expect(isPathAtOrInside('/a/B.ts', '/a/b.ts')).toBe(false)
  })
})

describe('isSamePath', () => {
  it('末尾の区切りや区切り文字の違いを無視する', () => {
    expect(isSamePath('/a/b', '/a/b/')).toBe(true)
    expect(isSamePath('C:\\dir\\a.ts', 'C:/dir/a.ts')).toBe(true)
  })

  it('Windows は大文字小文字を無視する', () => {
    expect(isSamePath('C:\\Project\\Foo.ts', 'c:\\project\\foo.ts')).toBe(true)
  })

  it('POSIX は大文字小文字を区別する', () => {
    expect(isSamePath('/a/Foo.ts', '/a/foo.ts')).toBe(false)
  })

  it('別のパスは false', () => {
    expect(isSamePath('/a/b', '/a/c')).toBe(false)
  })
})

describe('joinPath', () => {
  it('親のパスと名前をつなぐ', () => {
    expect(joinPath('/project', 'a.ts')).toBe('/project/a.ts')
  })

  it('親が末尾に区切りを持っていても二重にしない', () => {
    expect(joinPath('/project/', 'a.ts')).toBe('/project/a.ts')
  })

  it('POSIX のルート直下でも二重区切りにならない', () => {
    expect(joinPath('/', 'a.ts')).toBe('/a.ts')
  })

  it('Windows のパスでは区切りを引き継ぐ', () => {
    expect(joinPath('C:\\project', 'a.ts')).toBe('C:\\project\\a.ts')
    expect(joinPath('C:\\', 'a.ts')).toBe('C:\\a.ts')
  })

  it('POSIX のディレクトリ名にバックスラッシュが含まれていても "/" でつなぐ', () => {
    // ドライブ文字も UNC も無いパスは POSIX。ディレクトリ名にバックスラッシュを
    // 含めること自体はファイルシステムレベルでは禁止されていないため、
    // parentPath 全体にバックスラッシュがあるかで区切りを決めると誤判定する
    expect(joinPath('/Users/x/a\\b', 'newName.txt')).toBe('/Users/x/a\\b/newName.txt')
  })

  it('先頭が "//" の POSIX パス（一部のマウント構成で起こり得る）でも "/" でつなぐ', () => {
    // UNC パス（\\server\share）と正規化後の見た目が同じになるため、
    // 正規化後の文字列だけで判定すると POSIX の "//" パスを Windows と誤判定する
    expect(joinPath('//mnt/share', 'a.ts')).toBe('//mnt/share/a.ts')
  })

  it('UNC パスでは区切りを引き継ぐ', () => {
    expect(joinPath('\\\\server\\share', 'a.ts')).toBe('\\\\server\\share\\a.ts')
  })
})

describe('isSafeEntryName', () => {
  it('通常の名前は受け付ける', () => {
    expect(isSafeEntryName('index.ts')).toBe(true)
  })

  it('空・空白のみ・. や .. は拒否する', () => {
    expect(isSafeEntryName('')).toBe(false)
    expect(isSafeEntryName('   ')).toBe(false)
    expect(isSafeEntryName('.')).toBe(false)
    expect(isSafeEntryName('..')).toBe(false)
  })

  it('区切り文字を含む名前は拒否する', () => {
    expect(isSafeEntryName('/')).toBe(false)
    expect(isSafeEntryName('\\')).toBe(false)
    expect(isSafeEntryName('sub/a.ts')).toBe(false)
    expect(isSafeEntryName('sub\\a.ts')).toBe(false)
  })

  it('前後に空白がある名前は拒否する', () => {
    expect(isSafeEntryName(' a.ts')).toBe(false)
    expect(isSafeEntryName('a.ts ')).toBe(false)
  })
})

describe('replacePathPrefix', () => {
  it('前方一致する部分を置き換える', () => {
    expect(replacePathPrefix('/project/a.ts', '/project', '/moved')).toBe('/moved/a.ts')
  })

  it('from に末尾区切りが付いていても、二重区切りにならない', () => {
    // isPathAtOrInside は末尾区切りを無視して判定するため、raw な文字数で
    // 切ると from の末尾区切り分だけ余分に削れて壊れたパスになる
    expect(replacePathPrefix('/project/sub/a.ts', '/project/sub/', '/moved')).toBe('/moved/a.ts')
  })

  it('path 自身のセパレータは変えない（Windows のパスをそのまま保つ）', () => {
    expect(replacePathPrefix('C:\\proj\\sub\\a.ts', 'C:\\proj\\sub', 'C:\\moved')).toBe(
      'C:\\moved\\a.ts'
    )
  })
})
