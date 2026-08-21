import { describe, it, expect } from 'vitest'
import { isPathAtOrInside, isPathInside, isSamePath, toComparablePath } from '../pathUtils'

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

describe('POSIX のバックスラッシュ', () => {
  // POSIX では '\\' はファイル名に使える文字。区切りへ変換すると別ファイルが
  // 同一視され、履歴やロックが衝突したり、削除の影響判定で別のタブを閉じたりする
  it('ファイル名に含まれる \\ を区切りとして扱わない', () => {
    expect(isSamePath('/project/foo\\bar.ts', '/project/foo/bar.ts')).toBe(false)
    expect(isPathInside('/project/foo\\bar.ts', '/project/foo')).toBe(false)
    expect(isPathAtOrInside('/project/foo\\bar.ts', '/project/foo')).toBe(false)
  })

  it('比較用キーでも \\ を含む名前と区切りを区別する', () => {
    expect(toComparablePath('/project/foo\\bar.ts')).not.toBe(
      toComparablePath('/project/foo/bar.ts')
    )
  })

  it('同じ名前どうしは一致する', () => {
    expect(isSamePath('/project/foo\\bar.ts', '/project/foo\\bar.ts')).toBe(true)
    expect(isPathAtOrInside('/project/foo\\bar.ts', '/project')).toBe(true)
  })

  it('先頭区切りが混在する形を UNC とみなさない', () => {
    // POSIX の '/\\server\\share' は「ルート直下の \\server\\share という名前」。
    // UNC と誤認して変換すると、この名前が '//server/share' と同一視される
    expect(isSamePath('/\\server\\share', '//server/share')).toBe(false)
    // キーとしても UNC の '\\\\server\\share'(正規化すると '//server/share')と別物になる
    expect(toComparablePath('/\\server\\share')).not.toBe(toComparablePath('\\\\server\\share'))
    expect(toComparablePath('/\\server\\share')).toContain('/\\server\\share')
  })

  it('片方が POSIX の全スラッシュ形なら Windows として畳まない', () => {
    // '//Server/Share/Foo' は POSIX として扱うと定めた形。相手が UNC だからと
    // いって小文字化すると、別物のパスを同一視してしまう
    expect(isSamePath('//Server/Share/Foo', '\\\\server\\share\\foo')).toBe(false)
  })

  it('両方が Windows 形式なら表記が違っても一致する', () => {
    expect(isSamePath('C:\\project\\a.ts', 'C:/project/a.ts')).toBe(true)
    expect(isPathAtOrInside('\\\\Server\\Share\\A.ts', '\\\\server\\share')).toBe(true)
  })

  it('POSIX の全スラッシュ形と UNC を別のキーにする', () => {
    // '\\\\server\\share\\foo' は正規化すると '//server/share/foo' になる。
    // 種別を持たないキーだと POSIX のパスと衝突し、履歴や Map の存在確認で混ざる
    expect(isSamePath('//server/share/foo', '\\\\server\\share\\foo')).toBe(false)
    expect(toComparablePath('//server/share/foo')).not.toBe(
      toComparablePath('\\\\server\\share\\foo')
    )
  })

  it('種別が違うパスは配下ともみなさない', () => {
    expect(isPathInside('\\\\server\\share\\foo\\a.ts', '//server/share/foo')).toBe(false)
    expect(isPathAtOrInside('\\\\server\\share\\foo', '//server/share')).toBe(false)
  })

  it('バックスラッシュだけの文字列をルートとみなさない', () => {
    // POSIX では '\\' はルートではなく、そういう名前の相対パス
    expect(isPathAtOrInside('/etc/passwd', '\\')).toBe(false)
    expect(isPathAtOrInside('/etc/passwd', '/')).toBe(true)
  })

  it('Windows のパスでは従来どおり \\ を区切りとして扱う', () => {
    expect(isSamePath('C:\\project\\a.ts', 'C:/project/a.ts')).toBe(true)
    expect(isPathInside('C:\\project\\a.ts', 'C:\\project')).toBe(true)
    expect(isPathAtOrInside('\\\\server\\share\\a.ts', '\\\\server\\share')).toBe(true)
  })
})
