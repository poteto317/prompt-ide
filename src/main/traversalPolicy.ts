export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.next'])
export const MAX_DEPTH = 5

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name)
}

/**
 * 根からの相対パスの段数(根の直下が 1)の項目がツリーに出るか。readDirRecursive は depth(根が 0)のディレクトリの中身を
 * depth + 1 段として読み、MAX_DEPTH を超えた depth は読まないため、ツリーに出るのは MAX_DEPTH + 1 段まで(その段のフォルダは
 * 中身が空で出る)。開いているフォルダの監視の分類(folderChangeClassifier)も、この境界で tree と git を分ける
 */
export function isWithinTreeDepth(segmentCount: number): boolean {
  return segmentCount <= MAX_DEPTH + 1
}

type FileEntry = { type: 'file' | 'directory'; name: string }

export function sortFileTree<T extends FileEntry>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
