export const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.next'])
export const MAX_DEPTH = 5

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name)
}

type FileEntry = { type: 'file' | 'directory'; name: string }

export function sortFileTree<T extends FileEntry>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
