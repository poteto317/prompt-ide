import { describe, it, expect, vi } from 'vitest'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'
import type { AgentChangesUndoCapture, AgentChangesUndoExecution } from '../agentChangesUndoModel'
import {
  createFakeProtectionGit,
  FAKE_PROTECTION_INSTANCE_ID,
  makeAttributionOffDeps,
  makeBaselineSnapshot,
  makeFakeProtectionDeps
} from './helpers/agentBaselineFixtures'
import type { FakeProtectionGit } from './helpers/agentBaselineFixtures'
import type {
  AgentChangesRun,
  AgentChangesState,
  AgentChangesUnavailableReason,
  AgentChangesUndoOperation,
  AgentChangesUndoSummary
} from '@shared/types'

// startedAt の既定値 100 は、このファイルの期待値が前提にしている
const snapshotOf = (folderPath: string, tempDir: string, startedAt = 100): BaselineSnapshot =>
  makeBaselineSnapshot({ folderPath, tempDir, startedAt })

// 記録を取る偽物。release で結果を返し、isCanceled・写しの元を控える。now は 500 を返す。保護の git は偽物
function setup(
  options: {
    isProcessAlive?: (pid: number) => boolean
    executeUndo?: AgentBaselineRegistryDeps['executeUndo']
  } = {}
): {
  registry: AgentBaselineRegistry
  takeSnapshot: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  /** index 番目(既定は最後)の記録の依頼に結果を返す */
  release: (result: BaselineSnapshotResult, index?: number) => void
  canceled: () => boolean
  /** 記録の依頼ごとの写しの元(累積の始点は undefined) */
  baseIndexPaths: () => (string | undefined)[]
  /** 保護の git の偽物 */
  protection: FakeProtectionGit
  /** 書き戻しの偽物(既定は控えの全項目を書き戻した done) */
  executeUndo: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['executeUndo']>>
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
  const protection = createFakeProtectionGit()
  // ファイルの書き戻しは executeAgentChangesUndo のテストで見るため、registry のテストでは結果だけを返す偽物にする
  const executeUndo = vi.fn<AgentBaselineRegistryDeps['executeUndo']>(
    options.executeUndo ??
      (async (_folderPath, undo) => ({
        kind: 'done',
        restoredPaths: undo.items.map((item) => item.path),
        trashedPaths: []
      }))
  )
  const registry = new AgentBaselineRegistry({
    takeSnapshot,
    removeDir,
    removeDirSync,
    now: () => 500,
    executeUndo,
    ...makeAttributionOffDeps(),
    protection: {
      ...makeFakeProtectionDeps(protection),
      ...(options.isProcessAlive ? { isProcessAlive: options.isProcessAlive } : {})
    }
  })
  return {
    registry,
    takeSnapshot,
    removeDir,
    removeDirSync,
    release: (result, index = resolvers.length - 1) => resolvers[index](result),
    canceled: () => isCanceled(),
    baseIndexPaths: () => [...baseIndexPaths],
    protection,
    executeUndo
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
    await expect(begun).resolves.toEqual({ kind: 'recording', startedAt: 42, runs: [], undo: null })
    expect(s.registry.getState(1, '/repo')).toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: [],
      undo: null
    })
    expect(s.registry.getState(2, '/repo')).toEqual({ kind: 'none' })
    await expect(s.registry.withRecord(2, '/repo', async () => 'used')).resolves.toBeNull()
  })

  it('記録がある間の begin は記録を取り直さない(累積)', async () => {
    const s = setup()
    await recordFor(s, 1, '/repo', '/tmp/a')
    await expect(s.registry.begin(1, '/repo', 'manual')).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('同じ世代の記録の途中の begin は 1 つにまとめる', async () => {
    const s = setup()
    const first = s.registry.begin(1, '/repo', 'manual')
    const second = s.registry.begin(1, '/repo', 'manual')
    s.release(recorded('/repo', '/tmp/a'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'recording', startedAt: 100, runs: [], undo: null },
      { kind: 'recording', startedAt: 100, runs: [], undo: null }
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
    await expect(fresh).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
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
    expect(s.registry.getState(1, '/b')).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
    releaseSlow()
    await expect(slow).resolves.toBe('slow')
    await expect(queuedOld).resolves.toBeNull()
    await cleared
    expect(oldTask).not.toHaveBeenCalled()
    expect(s.registry.getState(1, '/b')).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
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
    expect(s.registry.getState(1, '/b')).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
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
    await expect(fresh).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(s.removeDir).not.toHaveBeenCalledWith('/tmp/b')
    expect(s.registry.getState(1, '/other')).toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
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
    const expected = {
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, null)],
      undo: null
    }
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
      runs: [],
      undo: null
    })
    expect(s.takeSnapshot).not.toHaveBeenCalled()
  })

  it('記録がある send は、直前の取れた記録のインデックスを写しの元にして区切りを取り、実行を足す', async () => {
    const s = setup()
    await send(s, recorded('/repo', '/tmp/base', 100))
    await expect(send(s, recorded('/repo', '/tmp/r2', 200))).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, 200), runOf(2, 2, 200, null)],
      undo: null
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
      runs: [runOf(1, 1, 200, null)],
      undo: null
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
      ],
      undo: null
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
      runs: [runOf(1, 1, 100, null)],
      undo: null
    })
    await expect(second).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, 200), runOf(2, 2, 200, null)],
      undo: null
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
    await expect(first).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: null
    })
    await expect(second).resolves.toEqual({
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 200, null)],
      undo: null
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
    const expected = {
      kind: 'recording',
      startedAt: 100,
      runs: [runOf(1, 1, 100, null)],
      undo: null
    }
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
      runs: [runOf(3, 1, 300, null)],
      undo: null
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

const TB = 'b'.repeat(40)
const TR = 'c'.repeat(40)
const REF1 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/1`
const recordedTree = (
  folderPath: string,
  tempDir: string,
  tree: string
): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: makeBaselineSnapshot({ folderPath, tempDir, startedAt: 100, tree })
})

// begin(send) を記録まで進め、保護の同期が終わるのを待つ
async function sendFor(
  s: ReturnType<typeof setup>,
  ownerId: number,
  tree: string,
  tempDir: string
): Promise<void> {
  const begun = s.registry.begin(ownerId, '/repo', 'send')
  await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
  s.release(recordedTree('/repo', tempDir, tree))
  await begun
  s.takeSnapshot.mockClear()
}

describe('AgentBaselineRegistry の保護の ref', () => {
  it('累積の始点を取ると ref を作る。begin は作成を待たない', async () => {
    const s = setup()
    const release = s.protection.holdNext('create')
    await sendFor(s, 1, TB, '/tmp/a')
    expect(s.protection.refs.size).toBe(0)
    release()
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB})`))
    expect(s.protection.calls).toEqual(['filter', 'mktree', 'sweep', `create ${REF1}`])
  })

  it('実行を足すと区切りの tree を足した値に更新し、10 件を超えて外した実行の項目を除く', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    const added = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
    s.release(recordedTree('/repo', '/tmp/r2', TR))
    await added
    await vi.waitFor(() =>
      expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB},run-2=${TR})`)
    )
    // 実行 3〜11 を足すと実行 1・2 が外れる(区切りの tree は一意に)
    for (let n = 3; n <= 12; n++) {
      s.takeSnapshot.mockClear()
      const next = s.registry.begin(1, '/repo', 'send')
      await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
      s.release(recordedTree('/repo', `/tmp/r${n}`, n.toString(16).padStart(40, '0')))
      await next
    }
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).not.toContain(`run-2=`))
    expect(s.protection.refs.get(REF1)).toContain(`baseline=${TB}`)
    expect(s.protection.refs.get(REF1)).toContain('run-12=')
  })

  it('あるべき値が前に書けた値と同じなら update-ref を呼ばない(区切りを取れなかった実行)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.calls.length = 0
    const added = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
    s.release({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } })
    await added
    await vi.waitFor(() => expect(s.protection.calls).toEqual(['filter', 'mktree']))
  })

  it('clear で ref を消してから一時ディレクトリを消す', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    // 一時ディレクトリを消す時点で ref が残っているかを控える(順序の検査)
    const refsAtRemoveDir: number[] = []
    s.removeDir.mockImplementation(async () => {
      refsAtRemoveDir.push(s.protection.refs.size)
    })
    await s.registry.clear(1)
    expect(s.protection.refs.size).toBe(0)
    expect(s.protection.calls.at(-1)).toBe(`remove ${REF1}`)
    expect(s.removeDir).toHaveBeenCalledWith('/tmp/a')
    expect(refsAtRemoveDir).toEqual([0])
  })

  it('掃除は作る前の 1 回だけで、更新・削除では掃除しない。捨てた記録の削除は tree を作らない', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.calls.length = 0
    const added = s.registry.begin(1, '/repo', 'send')
    await vi.waitFor(() => expect(s.takeSnapshot).toHaveBeenCalled())
    s.release(recordedTree('/repo', '/tmp/r2', TR))
    await added
    await vi.waitFor(() =>
      expect(s.protection.calls).toEqual(['filter', 'mktree', `update ${REF1}`])
    )
    s.protection.calls.length = 0
    await s.registry.clear(1)
    expect(s.protection.calls).toEqual([`remove ${REF1}`])
  })

  it('作成の実行中に clear しても、作成の成功の後に後ろの同期で消える', async () => {
    const s = setup()
    const release = s.protection.holdNext('create')
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`create ${REF1}`))
    const cleared = s.registry.clear(1)
    release()
    await cleared
    expect(s.protection.refs.size).toBe(0)
  })

  it('失敗の後の読み直しがあるべき値なら成功として扱う', async () => {
    const s = setup()
    s.protection.failNext.add('create')
    s.protection.refs.set(REF1, `tree(baseline=${TB})`)
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    // 成功として扱ったので、clear で消す(protectedRecords に入っている)
    await s.registry.clear(1)
    expect(s.protection.refs.size).toBe(0)
  })

  it('削除の失敗の後の読み直しで ref が無ければ成功として扱い、protectedRecords から外す(close で消そうとしない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    // 別の経路で先に消えていた(削除の compare-and-swap は失敗する)
    s.protection.refs.delete(REF1)
    await s.registry.clear(1)
    expect(s.protection.calls).toContain(`read ${REF1}`)
    // 成功として扱った(保護をやめた扱いではない)ので、後の掃除の残す番号に 1 は入らない
    await sendFor(s, 2, TR, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.sweptKeeps).toHaveLength(2))
    expect(s.protection.sweptKeeps[1]).toEqual([2])
    s.registry.close()
    expect(s.protection.calls).not.toContain(`removeSync ${REF1}`)
  })

  it('失敗の後の読み直しが前の値なら次の同期で試し直す', async () => {
    const s = setup()
    s.protection.failNext.add('create')
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    expect(s.protection.refs.size).toBe(0)
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() =>
      expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB},run-2=${TR})`)
    )
  })

  it('捨てた記録の削除が一時的に失敗したら、同じ所有者の次の同期で(新しい記録の作成より先に)試し直す', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    // 確認を終えたときの削除が一時的に失敗する(読み直しは前の値のまま)
    s.protection.failNext.add('remove')
    await s.registry.clear(1)
    expect(s.protection.refs.has(REF1)).toBe(true)
    s.protection.calls.length = 0
    // 同じ所有者で次の記録を取ると、その同期の中で前の記録の ref を消してから新しい記録の ref を作る
    await sendFor(s, 1, TR, '/tmp/b')
    const ref2 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/2`
    await vi.waitFor(() => expect(s.protection.refs.has(ref2)).toBe(true))
    expect(s.protection.refs.has(REF1)).toBe(false)
    expect(s.protection.calls.indexOf(`remove ${REF1}`)).toBeLessThan(
      s.protection.calls.indexOf(`create ${ref2}`)
    )
    // protectedRecords から外れた(close で消そうとしない)
    s.registry.close()
    expect(s.protection.calls).not.toContain(`removeSync ${REF1}`)
  })

  it('捨てた記録の削除の試し直しがまた失敗したら、その次の同期で試し直す(他の所有者の同期では試さない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.failNext.add('remove')
    await s.registry.clear(1)
    // 他の所有者の同期では試さない(所有者 1 の列の外で所有者 1 の記録を書き換えない)
    s.protection.calls.length = 0
    await sendFor(s, 2, TR, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.refs.size).toBe(2))
    expect(s.protection.calls).not.toContain(`remove ${REF1}`)
    // 所有者 1 の次の記録の同期での試し直しも失敗する(読み直しの失敗: 何も変えない)
    s.protection.failNext.add('remove')
    s.protection.failNext.add('read')
    s.protection.calls.length = 0
    await sendFor(s, 1, 'e'.repeat(40), '/tmp/c')
    const ref3 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/3`
    await vi.waitFor(() => expect(s.protection.refs.has(ref3)).toBe(true))
    expect(s.protection.calls.filter((call) => call === `remove ${REF1}`)).toHaveLength(1)
    expect(s.protection.refs.has(REF1)).toBe(true)
    // 実行を足したときの同期で試し直して消える
    await sendFor(s, 1, 'f'.repeat(40), '/tmp/c2')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(false))
  })

  it('clear の削除が一時的に失敗し、その所有者がもう同期しないなら、他の所有者の同期では消えず close で消える', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.failNext.add('remove')
    await s.registry.clear(1)
    expect(s.protection.refs.has(REF1)).toBe(true)
    // 所有者 1 は次の記録を取らない。他の所有者の同期では消えない
    await sendFor(s, 2, TR, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.refs.size).toBe(2))
    expect(s.protection.refs.has(REF1)).toBe(true)
    s.protection.calls.length = 0
    s.registry.close()
    expect(s.protection.calls).toContain(`removeSync ${REF1}`)
    expect(s.protection.refs.size).toBe(0)
  })

  it('読み直しが前の値でもあるべき値でもない(利用者が消した・書き換えた)なら保護をやめ、以後は作り直さず消さない', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.refs.set(REF1, 'user-value')
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    s.protection.calls.length = 0
    await sendFor(s, 1, 'e'.repeat(40), '/tmp/r3')
    await s.registry.clear(1)
    s.registry.close()
    expect(s.protection.refs.get(REF1)).toBe('user-value')
    expect(s.protection.calls).toEqual([])
  })

  it('読み直し自体が失敗したら何も変えずに次で試し直す(保護をやめない・空を「無い」と読まない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.failNext.add('update')
    s.protection.failNext.add('read')
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    expect(s.protection.refs.get(REF1)).toBe(`tree(baseline=${TB})`)
    await sendFor(s, 1, 'e'.repeat(40), '/tmp/r3')
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toContain('run-3='))
  })

  it('無い項目を除いて作り、1 つも無ければ作らない(保護はやめない。後の clear で前の ref を消す)', async () => {
    const s = setup()
    s.protection.missingTrees.add(TB)
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toEqual(['filter']))
    expect(s.protection.refs.size).toBe(0)
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.refs.get(REF1)).toBe(`tree(run-2=${TR})`))
    s.protection.missingTrees.add(TR)
    await sendFor(s, 1, TB, '/tmp/r3')
    // 項目が 1 つも無い同期は ref を変えない(同期が filter で止まるのを待ってから見る)
    await vi.waitFor(() => expect(s.protection.calls.at(-1)).toBe('filter'))
    expect(s.protection.refs.get(REF1)).toBe(`tree(run-2=${TR})`)
    await s.registry.clear(1)
    expect(s.protection.refs.size).toBe(0)
  })

  it.each(['filter', 'mktree'] as const)(
    '%s の失敗では何も変えずに次の同期で試し直す',
    async (op) => {
      const s = setup()
      s.protection.failNext.add(op)
      await sendFor(s, 1, TB, '/tmp/a')
      await vi.waitFor(() => expect(s.protection.calls).toContain(op))
      expect(s.protection.refs.size).toBe(0)
      await sendFor(s, 1, TR, '/tmp/r2')
      await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    }
  )

  it('close は ref を同期で消し、1 つが失敗しても残りを試す', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await sendFor(s, 2, TR, '/tmp/b')
    const ref2 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/2`
    await vi.waitFor(() => expect(s.protection.refs.size).toBe(2))
    s.protection.failNext.add('removeSync')
    s.registry.close()
    expect(s.protection.calls.filter((call) => call.startsWith('removeSync'))).toEqual([
      `removeSync ${REF1}`,
      `removeSync ${ref2}`
    ])
    expect([...s.protection.refs.keys()]).toEqual([REF1])
    expect(s.removeDirSync).toHaveBeenCalledWith('/tmp/a')
  })

  it('作成が close の後に成功したら、その場で新しい値の ref を同期で消す', async () => {
    const s = setup()
    const release = s.protection.holdNext('create')
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`create ${REF1}`))
    s.registry.close()
    release()
    await vi.waitFor(() => expect(s.protection.calls).toContain(`removeSync ${REF1}`))
    expect(s.protection.refs.size).toBe(0)
  })

  it('終了中に走っていた同期は ref を作らない(終了の後に書き込みへ進まない)', async () => {
    const s = setup()
    const release = s.protection.holdNext('filter')
    await sendFor(s, 1, TB, '/tmp/a')
    s.registry.close()
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(s.protection.calls).toEqual(['filter', 'mktree'])
    expect(s.protection.refs.size).toBe(0)
  })

  it('掃除の残す番号は、すべての所有者の今の記録・削除を待つ記録の番号(一覧の後に作る)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    // 所有者 1 の記録の削除を待たせる(削除待ち)
    const releaseRemove = s.protection.holdNext('remove')
    const cleared = s.registry.clear(1)
    await vi.waitFor(() => expect(s.protection.calls).toContain(`remove ${REF1}`))
    // 所有者 2 の掃除の一覧の取得を待たせ、その間に所有者 3 の記録の作成を終わらせる
    const releaseSweep = s.protection.holdNext('sweep')
    await sendFor(s, 2, TR, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.calls.filter((c) => c === 'sweep')).toHaveLength(2))
    const ref3 = `refs/prompt-ide/agent-changes/${FAKE_PROTECTION_INSTANCE_ID}/3`
    await sendFor(s, 3, 'e'.repeat(40), '/tmp/c')
    await vi.waitFor(() => expect(s.protection.refs.has(ref3)).toBe(true))
    // 所有者 1 の最初の掃除と、待たずに終わった所有者 3 の掃除
    expect(s.protection.sweptKeeps).toEqual([[1], [1, 2, 3]])
    releaseSweep()
    await vi.waitFor(() => expect(s.protection.sweptKeeps).toHaveLength(3))
    // 所有者 2 の掃除の残す番号: 削除待ちの 1・自分の 2・一覧の取得中に作られた 3
    expect(s.protection.sweptKeeps[2]).toEqual([1, 2, 3])
    releaseRemove()
    await cleared
  })

  it('保護をやめた記録の番号は、掃除の残す番号に入る(利用者が書き換えた ref を消さない)', async () => {
    const s = setup()
    await sendFor(s, 1, TB, '/tmp/a')
    await vi.waitFor(() => expect(s.protection.refs.has(REF1)).toBe(true))
    s.protection.refs.set(REF1, 'user-value')
    await sendFor(s, 1, TR, '/tmp/r2')
    await vi.waitFor(() => expect(s.protection.calls).toContain(`read ${REF1}`))
    await s.registry.clear(1)
    await sendFor(s, 2, TB, '/tmp/b')
    await vi.waitFor(() => expect(s.protection.sweptKeeps).toHaveLength(2))
    expect(s.protection.sweptKeeps[1]).toEqual([1, 2])
  })
})

describe('AgentBaselineRegistry の取り消しの控え', () => {
  // registry は控えのファイルを読み書きしない(一時ディレクトリの削除は偽物の removeDir)ため、フォルダは実在しなくてよい
  const folder = '/repo'
  let nextUndoDir = 0

  // 戻す操作で取れた控え(path を書き戻す 1 項目)。控えを取るファイルの扱いは agentChangesUndo のテストで見るため、
  // registry のテストでは控えの値だけを作る。一時ディレクトリは呼ぶごとに別のパスにする
  const savedCaptureOf = (path: string): Extract<AgentChangesUndoCapture, { kind: 'saved' }> => ({
    kind: 'saved',
    dir: `/tmp/agent-registry-undo-${++nextUndoDir}`,
    items: [
      {
        path,
        before: { kind: 'file', savedName: '0', mode: 0o644 },
        after: { kind: 'file', size: 4, sha256: 'a'.repeat(64), mode: 0o644 }
      }
    ]
  })
  // 列の中で commitRevertUndo を呼ぶ(handler と同じ)。記録が無くて呼べなかったら例外(commitRevertUndo の null と区別する)
  async function commit(
    s: ReturnType<typeof setup>,
    capture: AgentChangesUndoCapture,
    operation: AgentChangesUndoOperation = 'file'
  ): Promise<AgentChangesUndoSummary | null> {
    let called = false
    const result = await s.registry.withRecord(1, folder, (record) => {
      called = true
      return s.registry.commitRevertUndo(1, record, { operation, capture, applied: 1 })
    })
    if (!called || result === null) throw new Error('記録が無い')
    return result.undoSummary
  }
  const undoOfRecord = (s: ReturnType<typeof setup>): Promise<unknown> =>
    s.registry.withRecord(1, folder, async (record) => record.undo)

  it('取れた控えは undoId 1 の要約を返し、記録に持つ', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const capture = savedCaptureOf('a.txt')
    await expect(commit(s, capture)).resolves.toEqual({
      undoId: 1,
      operation: 'file',
      entries: [{ path: 'a.txt', action: 'rewrite' }]
    })
    await expect(undoOfRecord(s)).resolves.toMatchObject({
      undoId: 1,
      operation: 'file',
      dir: capture.dir
    })
  })

  it('控えがあれば getState・begin(manual) の recording に要約を入れる', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    await commit(s, savedCaptureOf('a.txt'))
    const expected = {
      kind: 'recording',
      startedAt: 100,
      runs: [],
      undo: { undoId: 1, operation: 'file', entries: [{ path: 'a.txt', action: 'rewrite' }] }
    }
    expect(s.registry.getState(1, folder)).toEqual(expected)
    await expect(s.registry.begin(1, folder, 'manual')).resolves.toEqual(expected)
  })

  it('次の取れた控えは undoId 2 になり、前の控えの一時ディレクトリを消す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const first = savedCaptureOf('a.txt')
    await commit(s, first)
    expect(s.removeDir).not.toHaveBeenCalledWith(first.dir)
    const second = savedCaptureOf('b.txt')
    await expect(commit(s, second, 'hunk')).resolves.toMatchObject({
      undoId: 2,
      operation: 'hunk'
    })
    expect(s.removeDir).toHaveBeenCalledWith(first.dir)
    expect(s.removeDir).not.toHaveBeenCalledWith(second.dir)
  })

  it('取れなかった控えは null を返し、記録の控えを null にして前の一時ディレクトリを消す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const first = savedCaptureOf('a.txt')
    await commit(s, first)
    await expect(commit(s, { kind: 'unavailable', reason: 'too-large' })).resolves.toBeNull()
    await expect(undoOfRecord(s)).resolves.toBeNull()
    expect(s.removeDir).toHaveBeenCalledWith(first.dir)
  })

  it('undoId は clear の後の新しい記録でも重ならない(L-037)', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    await expect(commit(s, savedCaptureOf('a.txt'))).resolves.toMatchObject({
      undoId: 1
    })
    await s.registry.clear(1)
    await recordFor(s, 1, folder, '/tmp/b')
    await expect(commit(s, savedCaptureOf('a.txt'))).resolves.toMatchObject({
      undoId: 2
    })
  })

  it('戻す操作の途中に clear されたら、新しい控えを記録に付けずに消して discarded・null の要約を返す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const capture = savedCaptureOf('a.txt')
    let cleared: Promise<void> = Promise.resolve()
    const result = await s.registry.withRecord(1, folder, (record) => {
      cleared = s.registry.clear(1)
      return s.registry.commitRevertUndo(1, record, { operation: 'file', capture, applied: 1 })
    })
    expect(result).toEqual({ undo: { kind: 'discarded' }, undoSummary: null })
    expect(s.removeDir).toHaveBeenCalledWith(capture.dir)
    await cleared
    // 捨てた記録の一時ディレクトリの削除にも控えは入らない(付けていない)
    expect(s.removeDir.mock.calls.filter(([dir]) => dir === capture.dir)).toHaveLength(1)
  })

  it('close の後の commitRevertUndo は、新しい控えを同期で消して discarded・null の要約を返す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const capture = savedCaptureOf('a.txt')
    const result = await s.registry.withRecord(1, folder, (record) => {
      s.registry.close()
      return s.registry.commitRevertUndo(1, record, { operation: 'file', capture, applied: 1 })
    })
    expect(result).toEqual({ undo: { kind: 'discarded' }, undoSummary: null })
    expect(s.removeDirSync).toHaveBeenCalledWith(capture.dir)
    expect(s.removeDir).not.toHaveBeenCalledWith(capture.dir)
  })

  it('clear は控えの一時ディレクトリも消し、close は同期で消す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const first = savedCaptureOf('a.txt')
    await commit(s, first)
    await s.registry.clear(1)
    expect(s.removeDir).toHaveBeenCalledWith(first.dir)
    await recordFor(s, 1, folder, '/tmp/b')
    const second = savedCaptureOf('a.txt')
    await commit(s, second)
    s.registry.close()
    expect(s.removeDirSync).toHaveBeenCalledWith(second.dir)
  })

  it('undoLastRevert は書き戻しの done を結果にし、控えを捨てて一時ディレクトリを消す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const capture = savedCaptureOf('a.txt')
    await commit(s, capture)
    await expect(s.registry.undoLastRevert(1, folder, 1)).resolves.toEqual({
      status: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: [],
      undoSummary: null
    })
    await expect(undoOfRecord(s)).resolves.toBeNull()
    expect(s.removeDir).toHaveBeenCalledWith(capture.dir)
  })

  it('同じ undoId の 2 回目は失敗する(L-101)', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    await commit(s, savedCaptureOf('a.txt'))
    await s.registry.undoLastRevert(1, folder, 1)
    await expect(s.registry.undoLastRevert(1, folder, 1)).rejects.toThrow(
      '取り消せる操作が変わりました。一覧を更新してください'
    )
  })

  it('undoId が違えば何も変えずに失敗し、控えは残る(L-035)', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const capture = savedCaptureOf('a.txt')
    await commit(s, capture)
    await expect(s.registry.undoLastRevert(1, folder, 2)).rejects.toThrow(
      '取り消せる操作が変わりました。一覧を更新してください'
    )
    expect(s.executeUndo).not.toHaveBeenCalled()
    await expect(undoOfRecord(s)).resolves.toMatchObject({ undoId: 1 })
    expect(s.removeDir).not.toHaveBeenCalledWith(capture.dir)
  })

  it('記録が無ければ(別のフォルダ) null', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    await commit(s, savedCaptureOf('a.txt'))
    await expect(s.registry.undoLastRevert(1, '/other', 1)).resolves.toBeNull()
  })

  it('適用が 0 件なら前の控えを残してその要約を返し、新しい控えの一時ディレクトリは消す', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    const first = savedCaptureOf('a.txt')
    await commit(s, first)
    const unused = savedCaptureOf('b.txt')
    const result = await s.registry.withRecord(1, folder, (record) =>
      s.registry.commitRevertUndo(1, record, { operation: 'all', capture: unused, applied: 0 })
    )
    expect(result?.undoSummary).toEqual({
      undoId: 1,
      operation: 'file',
      entries: [{ path: 'a.txt', action: 'rewrite' }]
    })
    await expect(undoOfRecord(s)).resolves.toMatchObject({ undoId: 1, dir: first.dir })
    expect(s.removeDir).not.toHaveBeenCalledWith(first.dir)
    expect(s.removeDir).toHaveBeenCalledWith(unused.dir)
  })

  it('適用が 0 件で控えが取れていなければ、前の控えを残す(capture-failed で前の控えを捨てない)', async () => {
    const s = setup()
    await recordFor(s, 1, folder, '/tmp/a')
    await commit(s, savedCaptureOf('a.txt'))
    const result = await s.registry.withRecord(1, folder, (record) =>
      s.registry.commitRevertUndo(1, record, {
        operation: 'all',
        capture: { kind: 'unavailable', reason: 'capture-failed' },
        applied: 0
      })
    )
    expect(result?.undoSummary).toMatchObject({ undoId: 1 })
    await expect(undoOfRecord(s)).resolves.toMatchObject({ undoId: 1 })
  })

  // 書き戻しを差し替えて、結果ごとの控えの扱い(registry の規則)だけを見る
  describe('書き戻しの結果ごとの控えの扱い', () => {
    const undoWith = async (
      execution: AgentChangesUndoExecution
    ): Promise<{ s: ReturnType<typeof setup>; dir: string }> => {
      const s = setup({ executeUndo: async () => execution })
      await recordFor(s, 1, folder, '/tmp/a')
      const capture = savedCaptureOf('a.txt')
      await commit(s, capture)
      return { s, dir: capture.dir }
    }

    it('記録のフォルダと今の控えを渡す', async () => {
      const { s, dir } = await undoWith({
        kind: 'done',
        restoredPaths: ['a.txt'],
        trashedPaths: []
      })
      await s.registry.undoLastRevert(1, folder, 1)
      expect(s.executeUndo).toHaveBeenCalledWith(
        folder,
        expect.objectContaining({ undoId: 1, operation: 'file', dir })
      )
    })

    // 0 件の failed は作業ツリーを変えていない。読み込めない・書き換えの失敗(keepUndo: true)なら控えを残し、もう一度取り消せる
    it.each<AgentChangesUndoExecution>([
      { kind: 'rejected', message: 'keep', keepUndo: true },
      { kind: 'failed', message: 'keep', keepUndo: true }
    ])(
      '$kind で控えを残すなら、文言で失敗し、控えと一時ディレクトリを残してもう一度取り消せる',
      async (execution) => {
        const { s, dir } = await undoWith(execution)
        await expect(s.registry.undoLastRevert(1, folder, 1)).rejects.toThrow('keep')
        await expect(undoOfRecord(s)).resolves.toMatchObject({ undoId: 1 })
        expect(s.removeDir).not.toHaveBeenCalledWith(dir)
        s.executeUndo.mockResolvedValueOnce({
          kind: 'done',
          restoredPaths: ['a.txt'],
          trashedPaths: []
        })
        await expect(s.registry.undoLastRevert(1, folder, 1)).resolves.toMatchObject({
          status: 'done'
        })
        expect(s.executeUndo).toHaveBeenCalledTimes(2)
        await expect(undoOfRecord(s)).resolves.toBeNull()
        expect(s.removeDir).toHaveBeenCalledWith(dir)
      }
    )

    it.each<AgentChangesUndoExecution>([
      { kind: 'rejected', message: 'drop', keepUndo: false },
      { kind: 'failed', message: 'drop', keepUndo: false }
    ])('$kind なら文言で失敗し、控えを捨てて一時ディレクトリを消す', async (execution) => {
      const { s, dir } = await undoWith(execution)
      await expect(s.registry.undoLastRevert(1, folder, 1)).rejects.toThrow('drop')
      await expect(undoOfRecord(s)).resolves.toBeNull()
      expect(s.removeDir).toHaveBeenCalledWith(dir)
    })

    it('partial なら結果を返し、控えを捨てて一時ディレクトリを消す', async () => {
      const { s, dir } = await undoWith({
        kind: 'partial',
        message: 'p',
        restoredPaths: ['a.txt'],
        trashedPaths: []
      })
      await expect(s.registry.undoLastRevert(1, folder, 1)).resolves.toEqual({
        status: 'partial',
        message: 'p',
        restoredPaths: ['a.txt'],
        trashedPaths: [],
        undoSummary: null
      })
      await expect(undoOfRecord(s)).resolves.toBeNull()
      expect(s.removeDir).toHaveBeenCalledWith(dir)
    })
  })
})
