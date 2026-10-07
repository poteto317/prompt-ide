import { describe, it, expect, vi } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { hasFilterAttribute, isFilterSetInCheckAttrOutput } from '../agentFilterAttribute'

const out = (value: string): string => `a.nb\0filter\0${value}\0`

describe('isFilterSetInCheckAttrOutput', () => {
  it('unspecified・unset は付いていない', () => {
    expect(isFilterSetInCheckAttrOutput(out('unspecified'))).toBe(false)
    expect(isFilterSetInCheckAttrOutput(out('unset'))).toBe(false)
  })

  it('値あり・set は付いている', () => {
    expect(isFilterSetInCheckAttrOutput(out('strip'))).toBe(true)
    expect(isFilterSetInCheckAttrOutput(out('lfs'))).toBe(true)
    expect(isFilterSetInCheckAttrOutput(out('set'))).toBe(true)
  })

  it('形の違う出力(空・属性名違い・値なし)は付いているとみなす', () => {
    expect(isFilterSetInCheckAttrOutput('')).toBe(true)
    expect(isFilterSetInCheckAttrOutput('a.nb\0diff\0unspecified\0')).toBe(true)
    expect(isFilterSetInCheckAttrOutput('a.nb\0filter')).toBe(true)
  })
})

describe('hasFilterAttribute', () => {
  const gitWith = (
    respond: (args: string[]) => Promise<string>
  ): { git: SimpleGit; raw: ReturnType<typeof vi.fn> } => {
    const raw = vi.fn(respond)
    return { git: { raw } as unknown as SimpleGit, raw }
  }
  const isCached = (args: string[]): boolean => args.includes('--cached')

  it('記録の時点(--cached)と作業ツリーの両方を問い合わせ、パスは -- の後ろにそのまま渡す', async () => {
    const { git, raw } = gitWith(async () => out('unspecified'))
    await expect(hasFilterAttribute(git, '-x.nb')).resolves.toBe(false)
    expect(raw.mock.calls.map(([args]) => args)).toEqual(
      expect.arrayContaining([
        ['check-attr', '--cached', '-z', 'filter', '--', '-x.nb'],
        ['check-attr', '-z', 'filter', '--', '-x.nb']
      ])
    )
    expect(raw).toHaveBeenCalledTimes(2)
  })

  it('記録の時点だけで付いていれば付いている', async () => {
    const { git } = gitWith(async (args) => out(isCached(args) ? 'strip' : 'unspecified'))
    await expect(hasFilterAttribute(git, 'a.nb')).resolves.toBe(true)
  })

  it('作業ツリーだけで付いていれば付いている', async () => {
    const { git } = gitWith(async (args) => out(isCached(args) ? 'unspecified' : 'strip'))
    await expect(hasFilterAttribute(git, 'a.nb')).resolves.toBe(true)
  })

  it('どちらかの問い合わせが失敗したら付いているとみなす', async () => {
    const failCached = gitWith(async (args) => {
      if (isCached(args)) throw new Error('fatal')
      return out('unspecified')
    })
    await expect(hasFilterAttribute(failCached.git, 'a.nb')).resolves.toBe(true)
    const failWorktree = gitWith(async (args) => {
      if (!isCached(args)) throw new Error('fatal')
      return out('unspecified')
    })
    await expect(hasFilterAttribute(failWorktree.git, 'a.nb')).resolves.toBe(true)
  })
})
