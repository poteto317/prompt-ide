import { describe, it, expect } from 'vitest'
import { BRANCH_MENU_ARIA_KEYSHORTCUTS, getBranchMenuShortcut } from '../branchMenuShortcut'

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}
): { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean } => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods
})

describe('getBranchMenuShortcut', () => {
  it('Delete は修飾キー無しで delete', () => {
    expect(getBranchMenuShortcut(key('Delete'))).toBe('delete')
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'Delete は %s が付いていても delete',
    (mod) => {
      expect(getBranchMenuShortcut(key('Delete', { [mod]: true }))).toBe('delete')
    }
  )

  it.each(['m', 'M'])('%s は修飾キー無しで merge(Shift 付きの M も含む)', (k) => {
    expect(getBranchMenuShortcut(key(k))).toBe('merge')
  })

  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'm は %s が単独で付いているとき null(Cmd+M 等を奪わない)',
    (mod) => {
      expect(getBranchMenuShortcut(key('m', { [mod]: true }))).toBeNull()
      expect(getBranchMenuShortcut(key('M', { [mod]: true }))).toBeNull()
    }
  )

  it.each(['Enter', 'ArrowDown', 'Backspace', 'a', ' ', 'Escape'])('%s は null', (k) => {
    expect(getBranchMenuShortcut(key(k))).toBeNull()
  })

  // 告知(aria-keyshortcuts)と判定の食い違いを防ぐ
  it('告知文字列の各トークンをそのままキーとして渡すと、すべてショートカットとして判定される', () => {
    const tokens = BRANCH_MENU_ARIA_KEYSHORTCUTS.split(' ')
    expect(tokens.length).toBeGreaterThan(0)
    for (const token of tokens) {
      expect(getBranchMenuShortcut(key(token))).not.toBeNull()
    }
  })
})
