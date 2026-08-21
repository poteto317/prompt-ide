// パス区切りは main 側の OS に依存するため、'/' に正規化してから判定する。
// 両辺とも末尾の区切りを先に取り除いておかないと、以下のような誤判定が起きる:
// - parentPath が末尾区切り(例: ルートフォルダの '/' や 'C:\\')だと「親 + 区切り」が
//   二重区切りになり、本来内部にあるパスを誤って false 判定する
// - childPath が末尾区切りだと、parentPath と実質同一パスなのに「内部にある」と
//   誤って true 判定してしまう(例: '/project/src/' は '/project/src' の内部ではなく同一)
/**
 * 利用者が入力した文字列のパス区切りを '/' に揃える。
 * 検索クエリのように「'\\' は区切りのつもりで打たれている」場面で使う。
 * ファイルパスの比較には使わない(POSIX の '\\' はファイル名の一部になり得る)。
 */
export const toForwardSlashes = (path: string): string => path.replace(/\\/g, '/')

/**
 * Windows のパス(ドライブ文字 or UNC)か。
 *
 * UNC は区切りが揃っている形だけを認める。'/\\server\\share' のように先頭の区切りが
 * 混在する形は、POSIX では「ルート直下の \\server\\share という名前」であり、
 * UNC と誤認すると保護したいファイル名を壊す。全て '/' の '//server/share' も
 * POSIX として有効なため UNC とはみなさない(この形に '\\' は含まれないので、
 * 変換しなくても Windows 側の判定は変わらない)。
 */
const isWindowsPath = (path: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\/]+\\/.test(path)

/**
 * パス比較のために区切りを '/' へ揃える。
 *
 * POSIX では '\\' はファイル名に使える文字なので変換しない。変換すると
 * '/project/foo\\bar.ts' と '/project/foo/bar.ts' が同一視され、履歴やロックが
 * 衝突したり、削除の影響判定で別のファイルのタブを閉じたりする。
 */
export const normalizePathSeparators = (path: string): string =>
  isWindowsPath(path) ? path.replace(/\\/g, '/') : path

/**
 * 末尾の区切り文字を落とす。'/a/b/' と '/a/b' を同じ path として扱うため。
 * 区切りを揃えたあとに使う前提で、落とすのは '/' だけにする
 * (POSIX では末尾の '\\' もファイル名の一部)。
 */
export const stripTrailingSeparators = (path: string): string => path.replace(/\/+$/, '')

/**
 * ルート('/')そのものか。
 * POSIX では '\\' はルートではなく、そういう名前のパスなので、区切りを揃えてから見る。
 */
const isRootPath = (path: string): boolean => /^\/+$/.test(normalizePathSeparators(path))

/**
 * 2 つのパスを比較用に正規化する。
 *
 * Windows は大文字小文字を区別しないため、'C:\\Project' と 'c:\\project' は
 * 同じ実体を指す。区別したまま比較すると、case-only rename の最中に旧表記の
 * 削除が予約の重複判定や「開いているファイルが対象か」の判定をすり抜け、
 * 削除済みのファイルがエディタに残って保存で作り直されてしまう。
 * 一方 POSIX は区別するため、両方が Windows 形式(ドライブ文字 or UNC)のときだけ畳む。
 * 片方だけを見て畳むと、POSIX として扱うと定めた '//Server/Share/Foo' のような形が
 * Windows の UNC と同一視される。ドライブ文字は '/' 区切りでも判定できるため、
 * 'C:\\project' と 'C:/project' のような表記違いはこの条件でも突き合わせられる。
 */
const normalizePair = (a: string, b: string): [string, string] => {
  // Windows かどうかは正規化前の文字列で判定する。正規化後の文字列で見ると、
  // POSIX の '//server/share' のような形まで Windows と誤認してしまう
  const isWindows = isWindowsPath(a) && isWindowsPath(b)
  const normalizedA = stripTrailingSeparators(normalizePathSeparators(a))
  const normalizedB = stripTrailingSeparators(normalizePathSeparators(b))
  if (!isWindows) return [normalizedA, normalizedB]
  return [normalizedA.toLowerCase(), normalizedB.toLowerCase()]
}

export const isPathInside = (childPath: string, parentPath: string): boolean => {
  const [normalizedChild, normalizedParent] = normalizePair(childPath, parentPath)
  // parentPath がルート('/')や空文字列など、正規化すると空になる場合は
  // 「親 + '/'」が単なる '/' に退化し、あらゆる絶対パスを内部と誤判定してしまう。
  // 同一パス(等値)も「内部」ではないため、あわせて明示的に false とする。
  if (normalizedParent.length === 0 || normalizedChild === normalizedParent) return false
  return normalizedChild.startsWith(`${normalizedParent}/`)
}

/**
 * path が targetPath 自身か、その配下にあるか。
 *
 * `isPathInside` はルートを親として渡された場合に false を返す(空文字列など
 * 正規化すると空になる値と区別できず、あらゆる絶対パスを配下と誤判定するため)。
 * ファイル操作の予約では、ルート直下のリネームが同じルート配下の保存・作成と
 * 重なることを検出できないと競合対策そのものが無効になる。ルートを明示的に
 * 「すべての絶対パスの親」として扱うのはこの判定だけに閉じる。
 */
export const isPathAtOrInside = (path: string, targetPath: string): boolean => {
  if (isRootPath(targetPath)) return normalizePathSeparators(path).startsWith('/')
  const [normalizedPath, normalizedTarget] = normalizePair(path, targetPath)
  return normalizedPath === normalizedTarget || isPathInside(normalizedPath, normalizedTarget)
}

/**
 * 2 つのパスが同じ実体を指すか。区切り文字・末尾の区切り・
 * (Windows のみ)大文字小文字の違いを無視して比較する。
 */
export const isSamePath = (a: string, b: string): boolean => {
  const [normalizedA, normalizedB] = normalizePair(a, b)
  return normalizedA === normalizedB
}

/**
 * 比較・キーとして使うための正規化済みパス。区切り文字と末尾の区切りを揃え、
 * Windows(ドライブ文字 or UNC)なら大文字小文字も畳む。
 * Map のキーなど、2 つ組で比較できない場面で使う。
 */
export const toComparablePath = (path: string): string => normalizePair(path, path)[0]
