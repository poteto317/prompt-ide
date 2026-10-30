import { describe, it, expect, vi } from 'vitest'
import { MAX_READ_RETRIES, readFileAfterPendingSaves } from '../readFileAfterPendingSaves'
import type { ReadFileAfterPendingSavesDeps } from '../readFileAfterPendingSaves'

// 保存の状態を手で動かせる偽物。pending は進行中の保存、completions は完了回数
function makeDeps(overrides: Partial<ReadFileAfterPendingSavesDeps> = {}): {
  deps: ReadFileAfterPendingSavesDeps
  state: { pending: Promise<void> | null; completions: number; stale: boolean }
  readFileContent: ReturnType<typeof vi.fn<ReadFileAfterPendingSavesDeps['readFileContent']>>
} {
  const state = { pending: null as Promise<void> | null, completions: 0, stale: false }
  const readFileContent = vi.fn<ReadFileAfterPendingSavesDeps['readFileContent']>(
    async () => 'disk'
  )
  return {
    state,
    readFileContent,
    deps: {
      pendingSaveFor: () => state.pending,
      saveCompletionsFor: () => state.completions,
      readFileContent,
      isStale: () => state.stale,
      ...overrides
    }
  }
}

describe('readFileAfterPendingSaves', () => {
  it('保存が無ければ 1 回だけ読んで内容を返す', async () => {
    const { deps, readFileContent } = makeDeps()
    await expect(readFileAfterPendingSaves('/p/a.ts', deps)).resolves.toEqual({
      kind: 'read',
      content: 'disk'
    })
    expect(readFileContent).toHaveBeenCalledTimes(1)
    expect(readFileContent).toHaveBeenCalledWith('/p/a.ts')
  })

  it('進行中の保存があれば、その完了を待ってから読む', async () => {
    const { deps, state, readFileContent } = makeDeps()
    let finishSave = (): void => undefined
    state.pending = new Promise<void>((resolve) => {
      finishSave = () => {
        state.pending = null
        state.completions += 1
        resolve()
      }
    })
    const result = readFileAfterPendingSaves('/p/a.ts', deps)
    await Promise.resolve()
    expect(readFileContent).not.toHaveBeenCalled()
    finishSave()
    await expect(result).resolves.toEqual({ kind: 'read', content: 'disk' })
    expect(readFileContent).toHaveBeenCalledTimes(1)
  })

  it('読む間に保存が完了したら(完了回数が変わったら)読み直す', async () => {
    const { deps, state, readFileContent } = makeDeps()
    readFileContent
      .mockImplementationOnce(async () => {
        state.completions += 1
        return 'old'
      })
      .mockImplementationOnce(async () => 'new')
    await expect(readFileAfterPendingSaves('/p/a.ts', deps)).resolves.toEqual({
      kind: 'read',
      content: 'new'
    })
    expect(readFileContent).toHaveBeenCalledTimes(2)
  })

  it('読み終えた時点で保存がまだ進行中なら、その完了を待って読み直す', async () => {
    const { deps, state, readFileContent } = makeDeps()
    readFileContent
      .mockImplementationOnce(async () => {
        // 読む間に保存が始まった(完了回数はまだ変わらない)
        state.pending = Promise.resolve().then(() => {
          state.pending = null
          state.completions += 1
        })
        return 'old'
      })
      .mockImplementationOnce(async () => 'new')
    await expect(readFileAfterPendingSaves('/p/a.ts', deps)).resolves.toEqual({
      kind: 'read',
      content: 'new'
    })
  })

  it('読み直しが上限(MAX_READ_RETRIES)まで競合し続けたら conflict を返す(最初の 1 回を含め上限 + 1 回読む)', async () => {
    const { deps, state, readFileContent } = makeDeps()
    readFileContent.mockImplementation(async () => {
      state.completions += 1
      return 'old'
    })
    await expect(readFileAfterPendingSaves('/p/a.ts', deps)).resolves.toEqual({
      kind: 'conflict'
    })
    expect(readFileContent).toHaveBeenCalledTimes(MAX_READ_RETRIES + 1)
  })

  it('上限の最後の 1 回で競合が止めば、その内容を返す', async () => {
    const { deps, state, readFileContent } = makeDeps()
    readFileContent.mockImplementation(async () => {
      if (readFileContent.mock.calls.length <= 2) state.completions += 1
      return `read-${readFileContent.mock.calls.length}`
    })
    await expect(readFileAfterPendingSaves('/p/a.ts', deps, 2)).resolves.toEqual({
      kind: 'read',
      content: 'read-3'
    })
  })

  it('読み終えた時点で結果が要らなくなっていたら stale を返し、読み直さない', async () => {
    const { deps, state, readFileContent } = makeDeps()
    readFileContent.mockImplementation(async () => {
      state.stale = true
      state.completions += 1
      return 'old'
    })
    await expect(readFileAfterPendingSaves('/p/a.ts', deps)).resolves.toEqual({ kind: 'stale' })
    expect(readFileContent).toHaveBeenCalledTimes(1)
  })

  it('読み込みの失敗はそのまま投げる', async () => {
    const { deps, readFileContent } = makeDeps()
    readFileContent.mockRejectedValue(new Error('ENOENT'))
    await expect(readFileAfterPendingSaves('/p/a.ts', deps)).rejects.toThrow('ENOENT')
  })

  it('読み直しの上限が 0 なら、競合したときは 1 回で conflict を返す', async () => {
    const { deps, state, readFileContent } = makeDeps()
    readFileContent.mockImplementation(async () => {
      state.completions += 1
      return 'old'
    })
    await expect(readFileAfterPendingSaves('/p/a.ts', deps, 0)).resolves.toEqual({
      kind: 'conflict'
    })
    expect(readFileContent).toHaveBeenCalledTimes(1)
  })
})
