import { describe, it, expect, vi } from 'vitest'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'
import { makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

// startedAt の既定値 100 は、このファイルの期待値が前提にしている
const snapshotOf = (folderPath: string, tempDir: string, startedAt = 100): BaselineSnapshot =>
  makeBaselineSnapshot({ folderPath, tempDir, startedAt })

// 記録を取る偽物。release で結果を返し、isCanceled を控える
function setup(): {
  registry: AgentBaselineRegistry
  takeSnapshot: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  /** index 番目(既定は最後)の記録の依頼に結果を返す */
  release: (result: BaselineSnapshotResult, index?: number) => void
  canceled: () => boolean
} {
  const resolvers: ((result: BaselineSnapshotResult) => void)[] = []
  let isCanceled: () => boolean = () => false
  const takeSnapshot = vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>(
    (_folder, options) =>
      new Promise<BaselineSnapshotResult>((r) => {
        resolvers.push(r)
        isCanceled = options.isCanceled
      })
  )
  const removeDir = vi.fn<AgentBaselineRegistryDeps['removeDir']>(async () => undefined)
  const removeDirSync = vi.fn<AgentBaselineRegistryDeps['removeDirSync']>()
  const registry = new AgentBaselineRegistry({ takeSnapshot, removeDir, removeDirSync })
  return {
    registry,
    takeSnapshot,
    removeDir,
    removeDirSync,
    release: (result, index = resolvers.length - 1) => resolvers[index](result),
    canceled: () => isCanceled()
  }
}

const recorded = (
  folderPath: string,
  tempDir: string,
  startedAt = 100
): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: snapshotOf(folderPath, tempDir, startedAt)
})

// begin を記録まで進める
async function recordFor(
  s: ReturnType<typeof setup>,
  ownerId: number,
  folder: string,
  tempDir: string
): Promise<void> {
  const begun = s.registry.begin(ownerId, folder)
  await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
  s.release(recorded(folder, tempDir))
  await begun
  s.takeSnapshot.mockClear()
}

describe('AgentBaselineRegistry', () => {
  it('記録を取ると recording を返し、所有者ごとに分ける', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    s.release(recorded('/repo', '/tmp/a', 42))
    await expect(begun).resolves.toEqual({ kind: 'recording', startedAt: 42 })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'recording', startedAt: 42 })
    expect(s.registry.getState(2, '/repo')).toEqual({ kind: 'none' })
    await expect(s.registry.withRecord(2, '/repo', async () => 'used')).resolves.toBeNull()
  })

  it('記録がある間の begin は記録を取り直さない(累積)', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    await expect(s.registry.begin(1, '/repo')).resolves.toEqual({
      kind: 'recording',
      startedAt: 100
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('同じ世代の記録の途中の begin は 1 つにまとめる', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo')
    const second = s.registry.begin(1, '/repo')
    s.release(recorded('/repo', '/tmp/a'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'recording', startedAt: 100 },
      { kind: 'recording', startedAt: 100 }
    ])
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('記録できない結果はそのまま返し、記録を持たない', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    s.release({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-toplevel' } })
    await expect(begun).resolves.toEqual({ kind: 'unavailable', reason: 'not-toplevel' })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('記録の途中に clear が来たら取り消し、取れた記録の一時ディレクトリを消して none を返す(パターン 141)', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    await s.registry.clear(1)
    expect(s.canceled()).toBe(true)
    s.release(recorded('/repo', '/tmp/a'))
    await expect(begun).resolves.toEqual({ kind: 'none' })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('取り消された世代の記録の途中の依頼には、新しい begin をまとめない', async () => {
    const s = setup()
    const old = s.registry.begin(1, '/repo')
    await s.registry.clear(1)
    const fresh = s.registry.begin(1, '/repo')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
    s.release({ kind: 'canceled' }, 0)
    s.release(recorded('/repo', '/tmp/b'), 1)
    await expect(old).resolves.toEqual({ kind: 'none' })
    await expect(fresh).resolves.toEqual({ kind: 'recording', startedAt: 100 })
  })

  it('別のフォルダの記録の途中の依頼にはまとめない', async () => {
    const s = setup()
    void s.registry.begin(1, '/repo')
    void s.registry.begin(1, '/other')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
  })

  it('記録のフォルダがいまの許可のフォルダと違えば none とし、記録を捨てる', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    expect(s.registry.getState(1, '/other')).toEqual({ kind: 'none' })
    await vi.waitFor(() => expect(s.removeDir).toHaveBeenCalledWith('/tmp/a'))
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('記録を使う操作は所有者ごとに 1 本の列で順に行う', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const first = s.registry.withRecord(1, '/repo', async (snapshot) => {
      order.push(`start1:${snapshot.tempDir}`)
      await new Promise<void>((r) => (releaseFirst = r))
      order.push('end1')
    })
    const second = s.registry.withRecord(1, '/repo', async () => {
      order.push('start2')
    })
    await vi.waitFor(() => expect(order).toEqual(['start1:/tmp/a']))
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['start1:/tmp/a', 'end1', 'start2'])
  })

  it('操作の途中に clear が来たら、以後の依頼は記録なしにし、一時ディレクトリは操作の後に消す', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    let releaseTask: () => void = () => undefined
    let started = false
    const running = s.registry.withRecord(1, '/repo', async () => {
      started = true
      await new Promise<void>((r) => (releaseTask = r))
      return 'done'
    })
    await vi.waitFor(() => expect(started).toBe(true))
    const cleared = s.registry.clear(1)
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
    const later = s.registry.withRecord(1, '/repo', async () => 'used')
    expect(s.removeDir).not.toHaveBeenCalled()
    releaseTask()
    await expect(running).resolves.toBe('done')
    await cleared
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    await expect(later).resolves.toBeNull()
  })

  // PR #47 レビュー A-2: ハンドラーは入り口で許可のフォルダを取り、withRecord は列の番が来てから照合する。列で待っていた古いフォルダの
  // 依頼が、フォルダの切り替えの後に作られた新しい記録を「フォルダが違う」として捨て、一時ディレクトリも消していた
  it('列で待っていた古いフォルダの依頼は、フォルダを切り替えた後の新しい記録を捨てない(null を返すだけ)', async () => {
    const s = setup()
    await recordFor(s, 1, '/a', '/tmp/A')
    let releaseSlow: () => void = () => undefined
    let started = false
    const slow = s.registry.withRecord(1, '/a', async () => {
      started = true
      await new Promise<void>((r) => (releaseSlow = r))
      return 'slow'
    })
    const oldTask = vi.fn(async () => 'old')
    const queuedOld = s.registry.withRecord(1, '/a', oldTask)
    await vi.waitFor(() => expect(started).toBe(true))
    const cleared = s.registry.clear(1)
    await recordFor(s, 1, '/b', '/tmp/B')
    expect(s.registry.getState(1, '/b')).toEqual({ kind: 'recording', startedAt: 100 })
    releaseSlow()
    await expect(slow).resolves.toBe('slow')
    await expect(queuedOld).resolves.toBeNull()
    await cleared
    expect(oldTask).not.toHaveBeenCalled()
    expect(s.registry.getState(1, '/b')).toEqual({ kind: 'recording', startedAt: 100 })
    expect(s.removeDir.mock.calls).toEqual([['/tmp/A']])
    await expect(
      s.registry.withRecord(1, '/b', async (snapshot) => snapshot.tempDir)
    ).resolves.toBe('/tmp/B')
  })

  it('記録と違うフォルダの withRecord は task を呼ばずに null を返し、記録を捨てない', async () => {
    const s = setup()
    await recordFor(s, 1, '/b', '/tmp/B')
    const task = vi.fn(async () => 'x')
    await expect(s.registry.withRecord(1, '/a', task)).resolves.toBeNull()
    expect(task).not.toHaveBeenCalled()
    expect(s.removeDir).not.toHaveBeenCalled()
    expect(s.registry.getState(1, '/b')).toEqual({ kind: 'recording', startedAt: 100 })
  })

  it('失敗した操作の後も列は進む', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    const failed = s.registry.withRecord(1, '/repo', async () => {
      throw new Error('git failed')
    })
    await expect(failed).rejects.toThrow('git failed')
    await expect(s.registry.withRecord(1, '/repo', async () => 'next')).resolves.toBe('next')
  })

  it('列で待っている操作の途中に close したら、その操作は記録なしになり task を呼ばない', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    let releaseFirst: () => void = () => undefined
    let started = false
    const first = s.registry.withRecord(1, '/repo', async () => {
      started = true
      await new Promise<void>((r) => (releaseFirst = r))
      return 'first'
    })
    const waitingTask = vi.fn(async () => 'used')
    const waiting = s.registry.withRecord(1, '/repo', waitingTask)
    await vi.waitFor(() => expect(started).toBe(true))
    s.registry.close()
    expect(s.removeDirSync).toHaveBeenCalledWith('/tmp/a')
    releaseFirst()
    await expect(first).resolves.toBe('first')
    await expect(waiting).resolves.toBeNull()
    expect(waitingTask).not.toHaveBeenCalled()
  })

  it('close はすべての一時ディレクトリを待たずに消し、以後は記録を取らない', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    await recordFor(s, 2, '/repo2', '/tmp/b')
    s.registry.close()
    expect(s.removeDirSync.mock.calls).toEqual([['/tmp/a'], ['/tmp/b']])
    await expect(s.registry.begin(1, '/repo')).resolves.toEqual({ kind: 'none' })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('記録の途中に close したら、取れた記録を捨てる', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo')
    s.registry.close()
    expect(s.canceled()).toBe(true)
    s.release(recorded('/repo', '/tmp/a'))
    await expect(begun).resolves.toEqual({ kind: 'none' })
    expect(s.removeDirSync).toHaveBeenCalledWith('/tmp/a')
    expect(s.removeDir).not.toHaveBeenCalled()
  })

  it.each([
    ['古い取得が先に終わる', [0, 1]],
    ['新しい取得が先に終わる', [1, 0]]
  ])('記録の途中に別のフォルダの begin が来たら、古い取得を取り消す(%s)', async (_n, order) => {
    const s = setup()
    const old = s.registry.begin(1, '/repo')
    const fresh = s.registry.begin(1, '/other')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
    const results = [recorded('/repo', '/tmp/a'), recorded('/other', '/tmp/b')]
    for (const i of order) {
      s.release(results[i], i)
      await Promise.resolve()
    }
    await expect(old).resolves.toEqual({ kind: 'none' })
    await expect(fresh).resolves.toEqual({ kind: 'recording', startedAt: 100 })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(s.removeDir).not.toHaveBeenCalledWith('/tmp/b')
    expect(s.registry.getState(1, '/other')).toEqual({ kind: 'recording', startedAt: 100 })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })
})
