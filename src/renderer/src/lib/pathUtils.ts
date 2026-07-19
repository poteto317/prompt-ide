// パス区切りは main 側の OS に依存するため、'/' に正規化してから判定する。
// 両辺とも末尾の区切りを先に取り除いておかないと、以下のような誤判定が起きる:
// - parentPath が末尾区切り(例: ルートフォルダの '/' や 'C:\\')だと「親 + 区切り」が
//   二重区切りになり、本来内部にあるパスを誤って false 判定する
// - childPath が末尾区切りだと、parentPath と実質同一パスなのに「内部にある」と
//   誤って true 判定してしまう(例: '/project/src/' は '/project/src' の内部ではなく同一)
const toForwardSlashes = (path: string): string => path.replace(/\\/g, '/')
const stripTrailingSeparators = (path: string): string => path.replace(/[/\\]+$/, '')

export const isPathInside = (childPath: string, parentPath: string): boolean => {
  const normalizedChild = stripTrailingSeparators(toForwardSlashes(childPath))
  const normalizedParent = stripTrailingSeparators(toForwardSlashes(parentPath))
  // parentPath がルート('/')や空文字列など、正規化すると空になる場合は
  // 「親 + '/'」が単なる '/' に退化し、あらゆる絶対パスを内部と誤判定してしまう。
  // 同一パス(等値)も「内部」ではないため、あわせて明示的に false とする。
  if (normalizedParent.length === 0 || normalizedChild === normalizedParent) return false
  return normalizedChild.startsWith(`${normalizedParent}/`)
}
