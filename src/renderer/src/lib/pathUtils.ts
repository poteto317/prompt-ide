// パス区切りは main 側の OS に依存するため両方を許容して包含判定する
export const isPathInside = (childPath: string, parentPath: string): boolean =>
  childPath.startsWith(parentPath + '/') || childPath.startsWith(parentPath + '\\')
