import { describe, it, expect, vi } from 'vitest'
import { createRecursiveFolderWatch } from '../recursiveFolderWatch'
import type { RecursiveFsWatch } from '../recursiveFolderWatch'

describe('createRecursiveFolderWatch', () => {
  const makeFsWatch = (): ReturnType<typeof vi.fn<RecursiveFsWatch>> =>
    vi.fn<RecursiveFsWatch>(() => ({ close: vi.fn(), on: vi.fn() }))

  it('Linux → null(監視しない。設計書 2 章)', () => {
    const fsWatch = makeFsWatch()
    expect(createRecursiveFolderWatch('linux', fsWatch)).toBeNull()
    expect(fsWatch).not.toHaveBeenCalled()
  })

  it.each(['darwin', 'win32'] as const)(
    '%s → recursive・persistent: false で張り、listener をそのまま渡す',
    (platform) => {
      const fsWatch = makeFsWatch()
      const listener = vi.fn()
      const watchFolder = createRecursiveFolderWatch(platform, fsWatch)
      expect(watchFolder).not.toBeNull()
      const created = watchFolder?.('/repo', listener)
      expect(fsWatch).toHaveBeenCalledExactlyOnceWith(
        '/repo',
        { recursive: true, persistent: false },
        listener
      )
      expect(created).toBe(fsWatch.mock.results[0].value)
    }
  )
})
