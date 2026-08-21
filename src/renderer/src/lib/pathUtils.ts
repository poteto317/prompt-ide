// パス区切りは main 側の OS に依存するため、'/' に正規化してから判定する。
// 両辺とも末尾の区切りを先に取り除いておかないと、以下のような誤判定が起きる:
// - parentPath が末尾区切り(例: ルートフォルダの '/' や 'C:\\')だと「親 + 区切り」が
//   二重区切りになり、本来内部にあるパスを誤って false 判定する
// - childPath が末尾区切りだと、parentPath と実質同一パスなのに「内部にある」と
//   誤って true 判定してしまう(例: '/project/src/' は '/project/src' の内部ではなく同一)
const toForwardSlashes = (path: string): string => path.replace(/\\/g, '/')
/** 末尾の区切り文字を落とす。'/a/b/' と '/a/b' を同じ path として扱うため */
const stripTrailingSeparators = (path: string): string => path.replace(/[/\\]+$/, '')

/** 区切り文字だけで構成されるパス(POSIX のルート '/' など)か */
const isRootPath = (path: string): boolean => /^[/\\]+$/.test(path)

/** '/' 正規化後の文字列が Windows のパス(ドライブ文字 or UNC)か */
const isWindowsStyle = (forwardPath: string): boolean =>
  /^([a-zA-Z]:\/|\/\/[^/]+\/)/.test(forwardPath)

/**
 * 2 つのパスを比較用に正規化する。
 *
 * Windows は大文字小文字を区別しないため、'C:\\Project' と 'c:\\project' は
 * 同じ実体を指す。区別したまま比較すると、case-only rename の最中に旧表記の
 * 削除が予約の重複判定や「開いているファイルが対象か」の判定をすり抜け、
 * 削除済みのファイルがエディタに残って保存で作り直されてしまう。
 * 一方 POSIX は区別するため、Windows 形式(ドライブ文字 or UNC)のときだけ畳む。
 * 片方だけが Windows 形式でも突き合わせられるよう、判定は 2 つまとめて行う。
 */
const normalizePair = (a: string, b: string): [string, string] => {
  const forwardA = toForwardSlashes(a)
  const forwardB = toForwardSlashes(b)
  const normalizedA = stripTrailingSeparators(forwardA)
  const normalizedB = stripTrailingSeparators(forwardB)
  if (!isWindowsStyle(forwardA) && !isWindowsStyle(forwardB)) return [normalizedA, normalizedB]
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
  if (isRootPath(targetPath)) return toForwardSlashes(path).startsWith('/')
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
