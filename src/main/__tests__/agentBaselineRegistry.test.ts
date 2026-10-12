import { describe, it, expect, vi } from 'vitest'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'
import { makeBaselineSnapshot } from './helpers/agentBaselineFixtures'
import type {
  AgentChangesRun,
  AgentChangesState,
  AgentChangesUnavailableReason
} from '@shared/types'

// startedAt の既定値 100 は、このファイルの期待値が前提にしている
const snapshotOf = (folderPath: string, tempDir: string, startedAt = 100): BaselineSnapshot =>
  makeBaselineSnapshot({ folderPath, tempDir, startedAt })

// 記録を取る偽物。release で結果を返し、isCanceled・写しの元を控える。now は 500 を返す
function setup(): {
  registry: AgentBaselineRegistry
  takeSnapshot: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  /** index 番目(既定は最後)の記録の依頼に結果を返す */
  release: (result: BaselineSnapshotResult, index?: number) => void
  canceled: () => boolean
  /** 記録の依頼ごとの写しの元(累積の始点は undefined) */
  baseIndexPaths: () => (string | undefined)[]
} {
  const resolvers: ((result: BaselineSnapshotResult) => void)[] = []
  const baseIndexPaths: (string | undefined)[] = []
  let isCanceled: () => boolean = () => false
  const takeSnapshot = vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>(
    (_folder, options) =>
      new Promise<BaselineSnapshotResult>((r) => {
        resolvers.push(r)
        isCanceled = options.isCanceled
        baseIndexPaths.push(options.baseIndexPath)
      })
  )
  const removeDir = vi.fn<AgentBaselineRegistryDeps['removeDir']>(async () => undefined)
  const removeDirSync = vi.fn<AgentBaselineRegistryDeps['removeDirSync']>()
  const registry = new AgentBaselineRegistry({
    takeSnapshot,
    removeDir,
    removeDirSync,
    now: () => 500
  })
  return {
    registry,
    takeSnapshot,
    removeDir,
    removeDirSync,
    release: (result, index = resolvers.length - 1) => resolvers[index](result),
    canceled: () => isCanceled(),
    baseIndexPaths: () => [...baseIndexPaths]
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
  const begun = s.registry.begin(ownerId, folder, 'manual')
  await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
  s.release(recorded(folder, tempDir))
  await begun
  s.takeSnapshot.mockClear()
}

describe('AgentBaselineRegistry', () => {
  it('記録を取ると recording を返し、所有者ごとに分ける', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo', 'manual')
    s.release(recorded('/repo', '/tmp/a', 42))
    await expect(begun).resolves.toEqual({ kind: 'recording', startedAt: 42, runs: [] })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'recording', startedAt: 42, runs: [] })
    expect(s.registry.getState(2, '/repo')).toEqual({ kind: 'none' })
    await expect(s.registry.withRecord(2, '/repo', async () => 'used')).resolves.toBeNull()
  })

  it('記録がある間の begin は記録を取り直さない(累積)', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    await expect(s.registry.begin(1, '/repo', 'manual')).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: []
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('同じ世代の記録の途中の begin は 1 つにまとめる', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'manual')
    const second = s.registry.begin(1, '/repo', 'manual')
    s.release(recorded('/repo', '/tmp/a'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'recording', startedAt: 100, runs: [] },
      { kind: 'recording', startedAt: 100, runs: [] }
    ])
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('記録できない結果はそのまま返し、記録を持たない', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo', 'manual')
    s.release({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-toplevel' } })
    await expect(begun).resolves.toEqual({ kind: 'unavailable', reason: 'not-toplevel' })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('記録の途中に clear が来たら取り消し、取れた記録の一時ディレクトリを消して none を返す(パターン 141)', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo', 'manual')
    await s.registry.clear(1)
    expect(s.canceled()).toBe(true)
    s.release(recorded('/repo', '/tmp/a'))
    await expect(begun).resolves.toEqual({ kind: 'none' })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })

  it('取り消された世代の記録の途中の依頼には、新しい begin をまとめない', async () => {
    const s = setup()
    const old = s.registry.begin(1, '/repo', 'manual')
    await s.registry.clear(1)
    const fresh = s.registry.begin(1, '/repo', 'manual')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
    s.release({ kind: 'canceled' }, 0)
    s.release(recorded('/repo', '/tmp/b'), 1)
    await expect(old).resolves.toEqual({ kind: 'none' })
    await expect(fresh).resolves.toEqual({ kind: 'recording', startedAt: 100, runs: [] })
  })

  it('別のフォルダの記録の途中の依頼にはまとめない', async () => {
    const s = setup()
    void s.registry.begin(1, '/repo', 'manual')
    void s.registry.begin(1, '/other', 'manual')
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
    const first = s.registry.withRecord(1, '/repo', async (record) => {
      order.push(`start1:${record.baseline.tempDir}`)
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
    expect(s.registry.getState(1, '/b')).toEqual({ kind: 'recording', startedAt: 100, runs: [] })
    releaseSlow()
    await expect(slow).resolves.toBe('slow')
    await expect(queuedOld).resolves.toBeNull()
    await cleared
    expect(oldTask).not.toHaveBeenCalled()
    expect(s.registry.getState(1, '/b')).toEqual({ kind: 'recording', startedAt: 100, runs: [] })
    expect(s.removeDir.mock.calls).toEqual([['/tmp/A']])
    await expect(
      s.registry.withRecord(1, '/b', async (record) => record.baseline.tempDir)
    ).resolves.toBe('/tmp/B')
  })

  it('記録と違うフォルダの withRecord は task を呼ばずに null を返し、記録を捨てない', async () => {
    const s = setup()
    await recordFor(s, 1, '/b', '/tmp/B')
    const task = vi.fn(async () => 'x')
    await expect(s.registry.withRecord(1, '/a', task)).resolves.toBeNull()
    expect(task).not.toHaveBeenCalled()
    expect(s.removeDir).not.toHaveBeenCalled()
    expect(s.registry.getState(1, '/b')).toEqual({ kind: 'recording', startedAt: 100, runs: [] })
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
    await expect(s.registry.begin(1, '/repo', 'manual')).resolves.toEqual({ kind: 'none' })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('記録の途中に close したら、取れた記録を捨てる', async () => {
    const s = setup()
    const begun = s.registry.begin(1, '/repo', 'manual')
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
    const old = s.registry.begin(1, '/repo', 'manual')
    const fresh = s.registry.begin(1, '/other', 'manual')
    expect(s.takeSnapshot).toHaveBeenCalledTimes(2)
    const results = [recorded('/repo', '/tmp/a'), recorded('/other', '/tmp/b')]
    for (const i of order) {
      s.release(results[i], i)
      await Promise.resolve()
    }
    await expect(old).resolves.toEqual({ kind: 'none' })
    await expect(fresh).resolves.toEqual({ kind: 'recording', startedAt: 100, runs: [] })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(s.removeDir).not.toHaveBeenCalledWith('/tmp/b')
    expect(s.registry.getState(1, '/other')).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: []
    })
    expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
  })
})

// 実行の区切り(設計書「依頼の流れ」)。send は記録が無ければ累積の始点 + 実行 1、記録があれば列の中で区切りを取り実行を足す
describe('AgentBaselineRegistry の実行の区切り', () => {
  const runOf = (
    runId: number,
    number: number,
    startedAt: number,
    endedAt: number | null,
    availability: AgentChangesRun['availability'] = { kind: 'available' }
  ): AgentChangesRun => ({ runId, number, startedAt, endedAt, availability })

  const failed = (
    reason: AgentChangesUnavailableReason = 'too-many-untracked'
  ): BaselineSnapshotResult => ({ kind: 'unavailable', state: { kind: 'unavailable', reason } })

  // 所有者 1・'/repo' に send を 1 回送り、記録(始点か区切り)の依頼が届いたら result を返す。begin の結果を返す
  async function send(
    s: ReturnType<typeof setup>,
    result: BaselineSnapshotResult
  ): Promise<AgentChangesState> {
    const calls = s.takeSnapshot.mock.calls.length
    const begun = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(calls + 1))
    s.release(result)
    return begun
  }

  const numbersOf = (state: AgentChangesState): number[] =>
    state.kind === 'recording' ? state.runs.map((run) => run.number) : []

  it('記録が無い send は累積の始点を取り、それを開始とする実行 1 を足す', async () => {
    const s = setup()
    const expected = { kind: 'recording', startedAt: 100, runs: [runOf(1, 1, 100, null)] }
    await expect(send(s, recorded('/repo', '/tmp/base', 100))).resolves.toEqual(expected)
    expect(s.baseIndexPaths()).toEqual([undefined])
    expect(s.registry.getState(1, '/repo')).toEqual(expected)
  })

  it('manual は実行を足さず、記録がある間の manual は区切りを取らない', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/base')
    await expect(s.registry.begin(1, '/repo', 'manual')).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: []
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('記録がある send は、直前の取れた記録のインデックスを写しの元にして区切りを取り、実行を足す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await expect(send(s, recorded('/repo', '/tmp/r2', 200))).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, 200), runOf(2, 2, 200, null)]
    })
    await send(s, recorded('/repo', '/tmp/r3', 300))
    expect(s.baseIndexPaths()).toEqual([undefined, '/tmp/base/index', '/tmp/r2/index'])
  })

  it('累積の始点と区切りの取得に、区切りを取れなかった実行と同じ時計(deps.now)を渡す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    const clocks = s.takeSnapshot.mock.calls.map(([, options]) => options.now())
    expect(clocks).toEqual([500, 500])
  })

  it('manual の記録の後の最初の send が実行 1 になる(開始は区切り)', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/base')
    await expect(send(s, recorded('/repo', '/tmp/r1', 200))).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 200, null)]
    })
  })

  it('区切りを取れなかったら failed の実行を足し(開始の時刻は取得を始めた時刻)、その実行と 1 つ前の実行を選べなくする。次の写しの元は取れた記録', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await expect(send(s, failed())).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [
        runOf(1, 1, 100, 500, { kind: 'end-not-recorded' }),
        runOf(2, 2, 500, null, { kind: 'start-not-recorded', reason: 'too-many-untracked' })
      ]
    })
    await send(s, recorded('/repo', '/tmp/r3', 600))
    expect(s.baseIndexPaths()).toEqual([undefined, '/tmp/base/index', '/tmp/base/index'])
    expect(s.registry.getState(1, '/repo')).toMatchObject({
      runs: [
        { availability: { kind: 'end-not-recorded' } },
        { availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' } },
        { runId: 3, number: 3, availability: { kind: 'available' } }
      ]
    })
  })

  it('send の始点の取得中に届いた send は合流せず、始点を取り終えてから区切りを取り実行 2 にする', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'send')
    const second = s.registry.begin(1, '/repo', 'send')
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
    s.release(recorded('/repo', '/tmp/base', 100), 0)
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
    s.release(recorded('/repo', '/tmp/r2', 200), 1)
    await expect(first).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, null)]
    })
    await expect(second).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, 200), runOf(2, 2, 200, null)]
    })
    expect(s.baseIndexPaths()).toEqual([undefined, '/tmp/base/index'])
  })

  it('manual の始点の取得中に届いた send は、始点の完了の後に区切りを取り実行 1 にする', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'manual')
    const second = s.registry.begin(1, '/repo', 'send')
    s.release(recorded('/repo', '/tmp/base', 100), 0)
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
    s.release(recorded('/repo', '/tmp/r1', 200), 1)
    await expect(first).resolves.toEqual({ kind: 'recording', startedAt: 100, runs: [] })
    await expect(second).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 200, null)]
    })
  })

  it('始点が取れなければ、待っていた send は区切りを取らずにその状態を返す', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'send')
    const second = s.registry.begin(1, '/repo', 'send')
    s.release(failed('timeout'), 0)
    await expect(first).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' })
    await expect(second).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' })
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('manual は取得中の始点(send の依頼)に合流する', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'send')
    const second = s.registry.begin(1, '/repo', 'manual')
    s.release(recorded('/repo', '/tmp/base', 100), 0)
    const expected = { kind: 'recording', startedAt: 100, runs: [runOf(1, 1, 100, null)] }
    await expect(first).resolves.toEqual(expected)
    await expect(second).resolves.toEqual(expected)
    expect(s.takeSnapshot).toHaveBeenCalledOnce()
  })

  it('11 件目を足したら一番古い実行を外し、外した実行の区切りの一時ディレクトリだけを消す(累積の始点は消さない。L-003・L-004)', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    for (let n = 2; n <= 10; n++) await send(s, recorded('/repo', `/tmp/r${n}`, n * 100))
    expect(s.removeDir).not.toHaveBeenCalled()
    // 11 件目: 外すのは累積の始点を開始とする実行 1(消すものが無い)
    const eleventh = await send(s, recorded('/repo', '/tmp/r11', 1100))
    expect(numbersOf(eleventh)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(s.removeDir).not.toHaveBeenCalled()
    // 12 件目: 外すのは区切りを開始とする実行 2
    await send(s, recorded('/repo', '/tmp/r12', 1200))
    expect(s.removeDir.mock.calls).toEqual([['/tmp/r2']])
    await expect(
      s.registry.withRecord(1, '/repo', async (record) => record.baseline.tempDir)
    ).resolves.toBe('/tmp/base')
  })

  it('記録できなかった実行も 1 件に数え、外すときに消すものは無い', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/base')
    await send(s, failed())
    for (let n = 2; n <= 10; n++) await send(s, recorded('/repo', `/tmp/r${n}`, n * 100))
    const eleventh = await send(s, recorded('/repo', '/tmp/r11', 1100))
    expect(numbersOf(eleventh)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(s.removeDir).not.toHaveBeenCalled()
  })

  it.each<[string, (s: ReturnType<typeof setup>) => unknown]>([
    ['確認を終える(clear)', (s) => s.registry.clear(1)],
    ['フォルダの切り替え(別のフォルダの getState)', (s) => s.registry.getState(1, '/other')]
  ])(
    '区切りの取得中の %s で、実行を足さず、取れた区切りの一時ディレクトリを消す',
    async (_label, interrupt) => {
      const s = setup()
      await send(s, recorded('/repo', '/tmp/base', 100))
      const begun = s.registry.begin(1, '/repo', 'send')
      await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
      // clear は列の後ろで一時ディレクトリを消すため、取得中の区切りの完了を待つ。ここでは待たない
      void interrupt(s)
      expect(s.canceled()).toBe(true)
      s.release(recorded('/repo', '/tmp/r2', 200))
      await expect(begun).resolves.toEqual({ kind: 'none' })
      await vi.waitFor(() => expect(s.removeDir).toHaveBeenCalledWith('/tmp/base'))
      expect(s.removeDir).toHaveBeenCalledWith('/tmp/r2')
      expect(s.registry.getState(1, '/repo')).toEqual({ kind: 'none' })
    }
  )

  it('区切りの取得は所有者の列に並び、先に並んだ操作の後に行う', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    let releaseTask: () => void = () => undefined
    let started = false
    const running = s.registry.withRecord(1, '/repo', async () => {
      started = true
      await new Promise<void>((r) => (releaseTask = r))
    })
    await vi.waitFor(() => expect(started).toBe(true))
    const begun = s.registry.begin(1, '/repo', 'send')
    await Promise.resolve()
    await Promise.resolve()
    expect(s.takeSnapshot).toHaveBeenCalledTimes(1)
    releaseTask()
    await running
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalledTimes(2))
    s.release(recorded('/repo', '/tmp/r2', 200))
    await expect(begun).resolves.toMatchObject({ runs: [{ runId: 1 }, { runId: 2 }] })
  })

  it('clear はすべての区切りの一時ディレクトリを消し、1 つの削除が失敗しても残りを試す(L-010)', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    await send(s, failed())
    await send(s, recorded('/repo', '/tmp/r4', 400))
    s.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    await s.registry.clear(1)
    expect(s.removeDir.mock.calls).toEqual([['/tmp/base'], ['/tmp/r2'], ['/tmp/r4']])
  })

  it('close はすべての区切りの一時ディレクトリを待たずに消し、1 つが投げても残りを試す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    s.removeDirSync.mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    s.registry.close()
    expect(s.removeDirSync.mock.calls).toEqual([['/tmp/base'], ['/tmp/r2']])
  })

  it('runId は確認を終えた後の新しい記録でも重ならず、番号は 1 から振り直す(L-037)', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    await s.registry.clear(1)
    await expect(send(s, recorded('/repo', '/tmp/base2', 300))).resolves.toEqual({
      kind: 'recording',
      startedAt: 300,
      runs: [runOf(3, 1, 300, null)]
    })
  })

  it('withRecord は記録全体(累積の始点と実行の一覧)を渡す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await send(s, recorded('/repo', '/tmp/r2', 200))
    await expect(
      s.registry.withRecord(1, '/repo', async (record) => ({
        base: record.baseline.tempDir,
        starts: record.runs.map((run) => run.start.kind)
      }))
    ).resolves.toEqual({ base: '/tmp/base', starts: ['baseline', 'snapshot'] })
  })
})
