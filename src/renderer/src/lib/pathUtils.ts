// パス区切りは main 側の OS に依存するため、'/' に正規化してから判定する。
// parentPath 末尾の区切り(例: ルートフォルダの '/' や 'C:\\')を先に取り除いて
// おかないと、末尾が区切りの parentPath では「親 + 区切り」が二重区切りになり
// 内部にあるパスを誤って false 判定してしまう。
const toForwardSlashes = (path: string): string => path.replace(/\\/g, '/')
const stripTrailingSeparators = (path: string): string => path.replace(/[/\\]+$/, '')

export const isPathInside = (childPath: string, parentPath: string): boolean => {
  const normalizedChild = toForwardSlashes(childPath)
  const normalizedParent = toForwardSlashes(stripTrailingSeparators(parentPath))
  return normalizedChild.startsWith(`${normalizedParent}/`)
}
