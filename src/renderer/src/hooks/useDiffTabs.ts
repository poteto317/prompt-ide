import { useState } from 'react'

export interface DiffTabKey {
  path: string
  staged: boolean
}

export interface DiffTabsState {
  diffTabs: DiffTabKey[]
  activeDiffTab: DiffTabKey | null
  openDiffTab: (key: DiffTabKey) => void
  closeDiffTab: (key: DiffTabKey) => void
  activateDiffTab: (key: DiffTabKey) => void
  /** diff タブをどれもアクティブでない状態に戻す(実ファイルタブへ切り替えるときに使う) */
  deactivateDiffTab: () => void
}

function isSameKey(a: DiffTabKey, b: DiffTabKey): boolean {
  return a.path === b.path && a.staged === b.staged
}

export function useDiffTabs(): DiffTabsState {
  const [diffTabs, setDiffTabs] = useState<DiffTabKey[]>([])
  const [activeDiffTab, setActiveDiffTab] = useState<DiffTabKey | null>(null)

  const openDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => (prev.some((t) => isSameKey(t, key)) ? prev : [...prev, key]))
    setActiveDiffTab(key)
  }

  const closeDiffTab = (key: DiffTabKey): void => {
    setDiffTabs((prev) => {
      const index = prev.findIndex((t) => isSameKey(t, key))
      if (index === -1) return prev
      const next = prev.filter((t) => !isSameKey(t, key))
      setActiveDiffTab((current) => {
        if (current === null || !isSameKey(current, key)) return current
        if (next.length === 0) return null
        return next[Math.max(0, index - 1)]
      })
      return next
    })
  }

  const activateDiffTab = (key: DiffTabKey): void => {
    setActiveDiffTab(key)
  }

  const deactivateDiffTab = (): void => {
    setActiveDiffTab(null)
  }

  return { diffTabs, activeDiffTab, openDiffTab, closeDiffTab, activateDiffTab, deactivateDiffTab }
}

export function encodeDiffTabPath(key: DiffTabKey): string {
  return `diff:${key.staged ? 'staged' : 'unstaged'}:${key.path}`
}

export function isDiffTabPath(path: string): boolean {
  return path.startsWith('diff:staged:') || path.startsWith('diff:unstaged:')
}

export function decodeDiffTabPath(encodedPath: string): DiffTabKey {
  const staged = encodedPath.startsWith('diff:staged:')
  const prefix = staged ? 'diff:staged:' : 'diff:unstaged:'
  return { path: encodedPath.slice(prefix.length), staged }
}
