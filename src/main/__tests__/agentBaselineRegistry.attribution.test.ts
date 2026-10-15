import { describe, expect, it, vi } from 'vitest'
import type { AgentChangeAuthor, AgentChangeEntry } from '@shared/types'
import { AgentBaselineRegistry } from '../agentBaselineRegistry'
import type { AgentBaselineRegistryDeps } from '../agentBaselineRegistry'
import { summarizeAttribution } from '../agentChangesAttribution'
import type { BaselineSnapshotResult } from '../agentBaselineSnapshot'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentChangesUndoCapture } from '../agentChangesUndoModel'
import type { AgentToolActivitySignal } from '../agentToolActivity'
import {
  createFakeAttributionSource,
  makeBaselineSnapshot,
  makeFakeProtectionDeps
} from './helpers/agentBaselineFixtures'
import type { FakeAttributionSource } from './helpers/agentBaselineFixtures'

// 記録の利用者の変更との区別(設計書「利用者の変更の判定」)を、偽の takeSnapshot(完了を外から解決する)・偽の差分・偽の追跡で試す。
// 実 git の結合は agentChangesAttribution.integration.test.ts

const FOLDER = '/repo'

interface SnapshotCall {
  baseIndexPath: string | undefined
  isCanceled: () => boolean
  resolve: (result: BaselineSnapshotResult) => void
  /** 予期しない例外(takeSnapshot の reject) */
  reject: (err: Error) => void
}

interface Harness {
  registry: AgentBaselineRegistry
  source: FakeAttributionSource
  /** takeSnapshot の呼び出し(呼ばれた順。0 番目は累積の始点) */
  calls: SnapshotCall[]
  collectBetween: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['collectBetween']>>
  collectCurrent: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['collectCurrent']>>
  removeDir: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDir']>>
  removeDirSync: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['removeDirSync']>>
  devLog: ReturnType<typeof vi.fn<(line: string) => void>>
  warn: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['attributionWarn']>>
  executeUndo: ReturnType<typeof vi.fn<AgentBaselineRegistryDeps['executeUndo']>>
}

function setup(initial: Partial<AgentToolActivitySignal> = { phase: 'idle' }): Harness {
  const calls: SnapshotCall[] = []
  const takeSnapshot = vi.fn<AgentBaselineRegistryDeps['takeSnapshot']>(
    (_folderPath, options) =>
      new Promise<BaselineSnapshotResult>((resolve, reject) => {
        calls.push({
          baseIndexPath: options.baseIndexPath,
          isCanceled: options.isCanceled,
          resolve,
          reject
        })
      })
  )
  const collectBetween = vi.fn<AgentBaselineRegistryDeps['collectBetween']>(async () => [])
  const collectCurrent = vi.fn<AgentBaselineRegistryDeps['collectCurrent']>(async () => [])
  const removeDir = vi.fn<AgentBaselineRegistryDeps['removeDir']>(async () => undefined)
  const removeDirSync = vi.fn<AgentBaselineRegistryDeps['removeDirSync']>()
  const devLog = vi.fn<(line: string) => void>()
  const warn = vi.fn<AgentBaselineRegistryDeps['attributionWarn']>()
  const executeUndo = vi.fn<AgentBaselineRegistryDeps['executeUndo']>(async () => {
    throw new Error('取り消しの結果が用意されていません')
  })
  const source = createFakeAttributionSource(initial)
  const registry = new AgentBaselineRegistry({
    takeSnapshot,
    collectBetween,
    collectCurrent,
    removeDir,
    removeDirSync,
    now: () => 500,
    protection: makeFakeProtectionDeps(),
    executeUndo,
    attributionSource: source,
    attributionDevLog: devLog,
    attributionWarn: warn
  })
  return {
    registry,
    source,
    calls,
    collectBetween,
    collectCurrent,
    removeDir,
    removeDirSync,
    devLog,
    warn,
    executeUndo
  }
}

/** 区切り n(n = 0 は累積の始点。tempDir は /tmp/cp-<n>、indexPath は /tmp/cp-<n>/index、startedAt は 100 + n) */
const checkpointResult = (n: number): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot: makeBaselineSnapshot({
    folderPath: FOLDER,
    tempDir: `/tmp/cp-${n}`,
    tree: `tree-${n}`,
    startedAt: 100 + n
  })
})

/** index 番目の takeSnapshot の呼び出しが来るまで待つ */
async function snapshotCall(h: Harness, index: number): Promise<SnapshotCall> {
  await vi.waitFor(() => expect(h.calls.length).toBeGreaterThan(index))
  return h.calls[index]
}

/** 記録を始め(累積の始点は cp-0)、記録を返す。始点の後に同期が並ばない合図で使う */
async function startRecord(h: Harness): Promise<AgentChangesRecord> {
  const begun = h.registry.begin(1, FOLDER, 'manual')
  ;(await snapshotCall(h, 0)).resolve(checkpointResult(0))
  await begun
  const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
  if (record === null) throw new Error('記録が無い')
  return record
}

const entriesOf = (...paths: string[]): AgentChangeEntry[] =>
  paths.map((path) => ({ path, status: 'M', isDirectory: false, notRecorded: false, author: null }))

/** 列の中で一覧の行に author を付ける(handler の agentChanges:list と同じ)。行の author の並びを返す */
async function authorsOfList(
  h: Harness,
  entries: AgentChangeEntry[]
): Promise<(AgentChangeAuthor | null)[]> {
  const result = await h.registry.withRecord(1, FOLDER, (record) =>
    h.registry.attributeEntries(1, record, entries)
  )
  if (result === null) throw new Error('記録が無い')
  return result.entries.map((entry) => entry.author)
}

/** 列の今の後ろまで進める(それまでに並んだ同期を走らせ終える) */
async function flush(h: Harness): Promise<void> {
  await h.registry.withRecord(1, FOLDER, async () => undefined)
}

/** 追跡の合図を変え、変わったときだけ(追跡の publish と同じく)notifyAttributionSignal を呼ぶ */
function change(h: Harness, next: Partial<AgentToolActivitySignal>): void {
  const before = h.source.signal
  h.source.set(next)
  const after = h.source.signal
  if (
    before.phase !== after.phase ||
    before.lost !== after.lost ||
    before.unassignable !== after.unassignable
  ) {
    h.registry.notifyAttributionSignal(1)
  }
}

/** PreToolUse(受け口と同じく、通し番号を進めて段階を通知してから待つ) */
function toolStarts(
  h: Harness,
  controller: AbortController = new AbortController()
): Promise<void> {
  h.source.seq += 1
  change(h, { phase: 'agent' })
  return h.registry.waitForAgentPhase(1, controller.signal)
}

/** 受け口の 5 秒の打ち切り(signal を中止し、onToolStartTimedOut〈markToolStartTimedOut〉を呼ぶ) */
function timeOut(h: Harness, controller: AbortController): void {
  controller.abort()
  h.registry.markToolStartTimedOut(1)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** 列を塞ぐ(戻す操作・一覧が先に並んでいる状態)。返す関数で列を開け、塞いでいたタスクの終わりを待つ */
function blockQueue(h: Harness): () => Promise<void> {
  const gate = deferred<void>()
  const blocked = h.registry.withRecord(1, FOLDER, () => gate.promise)
  return async () => {
    gate.resolve()
    await blocked
  }
}

/** 解決したかの印(結果は最後に元の Promise を await して受ける。L-178) */
function track(promise: Promise<unknown>): { done: () => boolean } {
  let done = false
  void promise.then(
    () => {
      done = true
    },
    () => {
      done = true
    }
  )
  return { done: () => done }
}

/** 今たまっている microtask・I/O を 1 回分進める(「まだ解決していない」の確認だけに使う) */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('記録の区別の始め方(begin)', () => {
  it('ツールが動いていない(idle)ときに始めると、累積の始点を判定の区切りにした tracking で始め、区別は始点の時刻から', async () => {
    const h = setup({ phase: 'idle' })
    const record = await startRecord(h)
    expect(record.attribution).toEqual({
      kind: 'tracking',
      phase: 'idle',
      periodUnassignable: false,
      timedOutPending: false,
      signalUnassignablePending: false,
      checkpoint: { snapshot: record.baseline, sharedWithBaseline: true },
      userPaths: new Set(),
      agentPaths: new Set(),
      trackingSince: 100,
      hadUnassignedSince: false,
      staleCheckpointDirs: []
    })
    expect(h.calls).toHaveLength(1)
  })

  it('paused で始めると trackingSince は null', async () => {
    const h = setup({ phase: 'paused' })
    const record = await startRecord(h)
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'paused',
      trackingSince: null
    })
  })

  it('区別をやめる合図があれば lost で始める(lostAt は始点の時刻)', async () => {
    const h = setup({ phase: 'agent', lost: 'receiver-unavailable' })
    const record = await startRecord(h)
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'receiver-unavailable',
      lostAt: 100
    })
  })

  it('取り終えた時点で合図の unassignable が立っていれば、最初の区間に印を立てる(trackingSince は null)', async () => {
    const h = setup({ phase: 'idle', unassignable: true })
    const record = await startRecord(h)
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      periodUnassignable: true,
      trackingSince: null
    })
  })

  it('開発版のログに開始の行を出す', async () => {
    const h = setup({ phase: 'idle' })
    await startRecord(h)
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=開始 phase=-→idle user=0 agent=0 unassignable=なし reason=-'
    )
  })

  it('begin・getState の記録中の状態に、記録の区別の要約を入れる', async () => {
    const h = setup({ phase: 'idle' })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 0)).resolve(checkpointResult(0))
    const state = await begun
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    if (record === null) throw new Error('記録が無い')
    expect(state).toMatchObject({
      kind: 'recording',
      attribution: { kind: 'tracking', since: 100, hadUnassignedSince: false }
    })
    expect(h.registry.getState(1, FOLDER)).toMatchObject({
      attribution: summarizeAttribution(record.attribution)
    })
  })
})

describe('区別の同期(syncAttribution・notifyAttributionSignal)', () => {
  it('段階が同じで印が無ければ区切りを取らない(git を呼ばない)', async () => {
    const h = setup()
    await startRecord(h)
    h.registry.notifyAttributionSignal(1)
    await flush(h)
    expect(h.calls).toHaveLength(1)
    expect(h.collectBetween).not.toHaveBeenCalled()
  })

  it('idle → agent: 前の区切りを写しの元に区切りを取り、閉じた区間の差分を利用者の集合に入れて段階を agent にする(始点と共有の前の区切りは消さない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('c.txt'))
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    expect(call.baseIndexPath).toBe('/tmp/cp-0/index')
    call.resolve(checkpointResult(1))
    await flush(h)
    expect(h.collectBetween).toHaveBeenCalledWith(
      record.baseline,
      expect.objectContaining({ tempDir: '/tmp/cp-1' })
    )
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'agent',
      userPaths: new Set(['c.txt']),
      agentPaths: new Set(),
      periodUnassignable: false,
      checkpoint: { snapshot: { tempDir: '/tmp/cp-1' }, sharedWithBaseline: false }
    })
    expect(h.removeDir).not.toHaveBeenCalled()
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=同期 phase=idle→agent user=1 agent=0 unassignable=なし reason=-'
    )
  })

  it('agent → idle: 差分をエージェントの集合に入れ、前の区切りは新しい区切りに置き換えた後に消す(L-003)', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    const checkpointAtRemoval: string[] = []
    h.removeDir.mockImplementation(async () => {
      if (record.attribution.kind === 'tracking') {
        checkpointAtRemoval.push(record.attribution.checkpoint.snapshot.tempDir)
      }
    })
    h.collectBetween.mockResolvedValueOnce(entriesOf('b.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(['b.txt'])
    })
    expect(h.removeDir).toHaveBeenCalledExactlyOnceWith('/tmp/cp-1')
    expect(checkpointAtRemoval).toEqual(['/tmp/cp-2'])
  })

  it('paused の区間の差分はどちらにも入れず、区別を始めた後なら hadUnassignedSince を立てる', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('x.txt'))
    change(h, { phase: 'paused' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    h.collectBetween.mockResolvedValueOnce(entriesOf('y.txt'))
    await flush(h)
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(['x.txt']),
      agentPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('新しい段階は区切りを取り終えた時点(手順 8)の段階で決める(区切りの最中に終わったツールを反映する)', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    change(h, { phase: 'idle' })
    call.resolve(checkpointResult(1))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({ phase: 'idle' })
    // 後ろに並んだ同期は段階が同じで印も無いため、区切りを取らない
    expect(h.calls).toHaveLength(2)
  })

  it('前の区切りを消せなければ削除待ちに入れ、clear で消す(L-428)', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({ staleCheckpointDirs: ['/tmp/cp-1'] })
    h.removeDir.mockClear()
    await h.registry.clear(1)
    expect(h.removeDir.mock.calls.map(([dir]) => dir)).toEqual(
      expect.arrayContaining(['/tmp/cp-0', '/tmp/cp-2', '/tmp/cp-1'])
    )
  })

  it('close で判定の区切りと削除待ちを同期で消す', async () => {
    const h = setup()
    await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    h.registry.close()
    expect(h.removeDirSync.mock.calls.map(([dir]) => dir)).toEqual(
      expect.arrayContaining(['/tmp/cp-0', '/tmp/cp-2', '/tmp/cp-1'])
    )
  })

  it('区切りを取れなければ(unavailable)区別をやめ(lost・checkpoint-failed)、同期は reject しない', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    ;(await snapshotCall(h, 1)).resolve({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    await expect(synced).resolves.toBe('skipped')
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 500
    })
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=checkpoint-failed'
    )
  })

  it('同期の予期しない例外(区切りの取得の reject)は、注入した失敗のログに出して区別をやめ(lost・checkpoint-failed)、開発版のログに lost を出し、同期は reject しない', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    const err = new Error('予期しない失敗')
    ;(await snapshotCall(h, 1)).reject(err)
    await expect(synced).resolves.toBe('skipped')
    expect(h.warn).toHaveBeenCalledExactlyOnceWith('[agent-attribution] 同期に失敗しました:', err)
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    // 予期しない例外の後始末の結果も、手順の結果と同じく開発版のログに lost として出す
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=checkpoint-failed'
    )
  })

  it('合図の通知の受け取りで追跡が投げても、注入した失敗のログに出すだけで投げない(L-053)', async () => {
    const h = setup()
    await startRecord(h)
    const err = new Error('追跡の失敗')
    vi.spyOn(h.source, 'activityOf').mockImplementationOnce(() => {
      throw err
    })
    expect(() => h.registry.notifyAttributionSignal(1)).not.toThrow()
    expect(h.warn).toHaveBeenCalledExactlyOnceWith(
      '[agent-attribution] 段階の通知の受け取りに失敗しました:',
      err
    )
  })

  it('差分を求められなければ、取れた区切りを消して区別をやめる(空の差分として扱わない。L-002)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockRejectedValueOnce(new Error('fatal: bad object'))
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await expect(synced).resolves.toBe('skipped')
    expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
  })

  it('区別をやめる合図があれば区切りを取らずに lost にし、その後の合図では何もしない', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { lost: 'hooks-not-confirmed' })
    await flush(h)
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
    change(h, { lost: null, phase: 'agent' })
    await flush(h)
    expect(h.calls).toHaveLength(1)
  })

  it('区別をやめるとき、始点と共有でない判定の区切りを消し、消せなければ削除待ちに入れる', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.removeDir.mockRejectedValueOnce(new Error('EBUSY'))
    change(h, { lost: 'hooks-not-confirmed' })
    await flush(h)
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      staleCheckpointDirs: ['/tmp/cp-1']
    })
    h.removeDir.mockClear()
    await h.registry.clear(1)
    expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1')
  })

  it('区切りの途中で記録を捨てたら(clear)、取れた区切りを消して記録を変えない', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { phase: 'agent' })
    const call = await snapshotCall(h, 1)
    const cleared = h.registry.clear(1)
    expect(call.isCanceled()).toBe(true)
    call.resolve(checkpointResult(1))
    await cleared
    expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'idle',
      checkpoint: { sharedWithBaseline: true }
    })
  })

  it('区切りを取っている最中に close すると、取れた区切りを同期で消して記録を変えない(L-435)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    const call = await snapshotCall(h, 1)
    h.registry.close()
    call.resolve(checkpointResult(1))
    await expect(synced).resolves.toBe('skipped')
    expect(h.removeDirSync).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      checkpoint: { sharedWithBaseline: true }
    })
  })

  it('差分を求めている最中(手順 7)に close すると、取れた区切りを同期で消して記録を変えない(世代を進めない close を見落とさない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const gate = deferred<AgentChangeEntry[]>()
    h.collectBetween.mockImplementationOnce(() => gate.promise)
    h.source.set({ phase: 'agent' })
    const synced = h.registry.syncAttribution(1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await vi.waitFor(() => expect(h.collectBetween).toHaveBeenCalledOnce())
    h.registry.close()
    gate.resolve(entriesOf('c.txt'))
    await expect(synced).resolves.toBe('skipped')
    expect(h.removeDirSync).toHaveBeenCalledWith('/tmp/cp-1')
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      checkpoint: { sharedWithBaseline: true }
    })
  })

  it('close の後の notifyAttributionSignal・markToolStartTimedOut は何もしない(投げない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.registry.close()
    h.source.set({ phase: 'agent', unassignable: true })
    expect(() => h.registry.notifyAttributionSignal(1)).not.toThrow()
    expect(() => h.registry.markToolStartTimedOut(1)).not.toThrow()
    await settle()
    expect(record.attribution).toMatchObject({ periodUnassignable: false, timedOutPending: false })
    expect(h.calls).toHaveLength(1)
  })

  it.each([
    {
      name: '記録が無い',
      prepare: async (): Promise<Harness> => setup({ phase: 'agent' }),
      snapshots: 0
    },
    {
      name: '区別していない(lost)',
      prepare: async (): Promise<Harness> => {
        const h = setup({ phase: 'agent', lost: 'receiver-unavailable' })
        await startRecord(h)
        return h
      },
      snapshots: 1
    },
    {
      name: '終了中(close の後)',
      prepare: async (): Promise<Harness> => {
        const h = setup()
        await startRecord(h)
        h.registry.close()
        h.source.set({ phase: 'agent' })
        return h
      },
      snapshots: 1
    }
  ])(
    '$name なら、区別の入口(合図の通知・打ち切り・同期・PreToolUse の待ち)はどれも区切りを取らず、記録の区別を変えない(同期は skipped、待ちはすぐ解決)',
    async ({ prepare, snapshots }) => {
      const h = await prepare()
      const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
      const before = record === null ? null : structuredClone(record.attribution)
      h.registry.notifyAttributionSignal(1)
      h.registry.markToolStartTimedOut(1)
      await expect(h.registry.syncAttribution(1)).resolves.toBe('skipped')
      await h.registry.waitForAgentPhase(1, new AbortController().signal)
      await settle()
      expect(h.calls).toHaveLength(snapshots)
      if (record !== null) expect(record.attribution).toStrictEqual(before)
    }
  )

  it('同期の依頼は、待っている同期があれば同じ Promise を返し(L-101・L-434)、走り始めた後の依頼は新しく並べる', async () => {
    const h = setup()
    await startRecord(h)
    const open = blockQueue(h)
    h.source.set({ phase: 'agent' })
    const first = h.registry.syncAttribution(1)
    expect(h.registry.syncAttribution(1)).toBe(first)
    await open()
    const call = await snapshotCall(h, 1)
    const third = h.registry.syncAttribution(1)
    expect(third).not.toBe(first)
    call.resolve(checkpointResult(1))
    await expect(first).resolves.toBe('synced')
    await expect(third).resolves.toBe('skipped')
  })

  it('idle の間の利用者の編集 → 打ち切りで印 → 同期が閉じた区間を割り当てず、手順 8 が agent なら、新しい区間に印は無いが hadUnassignedSince が立つ', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    timeOut(h, controller)
    await waited
    h.collectBetween.mockResolvedValueOnce(entriesOf('user.txt'))
    await open()
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'agent',
      userPaths: new Set(),
      agentPaths: new Set(),
      periodUnassignable: false,
      timedOutPending: false,
      hadUnassignedSince: true
    })
    expect(h.calls).toHaveLength(2)
  })

  it('合図の unassignable を見た notifyAttributionSignal は、列の外で同期的に今の区間の印と signalUnassignablePending を立てる', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { unassignable: true })
    expect(record.attribution).toMatchObject({
      periodUnassignable: true,
      signalUnassignablePending: true
    })
  })

  it('手順 5〜7 の最中に合図の unassignable が立って下りても(手順 2・8 では下りている)、手順 8 が idle なら次の区間に印が残り、その間の利用者の編集は利用者の集合に入らず、下りたときに並んだ同期で印が下りる。区切りはその 1 回の分しか増えない', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 窓の中の利用者の編集は、同期の区切り(cp-1)からの差分に出る
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-1' ? entriesOf('window.txt') : []
    )
    // 手順 2 は agent(ツールが始まった)
    change(h, { phase: 'agent' })
    const s1 = await snapshotCall(h, 1)
    // 区切りを取っている最中に合図が立って下り、ツールも終わる(下りた・idle の通知の同期は、立ったときの同期に合流する)
    change(h, { unassignable: true })
    change(h, { unassignable: false })
    change(h, { phase: 'idle' })
    s1.resolve(checkpointResult(1))
    // 立ったときに並んだ同期が、印のある区間として片付ける
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    await settle()
    expect(h.calls).toHaveLength(3)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: false,
      signalUnassignablePending: false,
      userPaths: new Set(),
      agentPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('手順 4 より前に立った合図の印は、その同期の次の区間には残さない(次の区間の利用者の編集は利用者の集合に入る)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-1' ? entriesOf('user.txt') : entriesOf('held.txt')
    )
    // 列で待っている同期に、下りた通知が合流する(同期が走り始める前に立って下りた)
    change(h, { unassignable: true })
    change(h, { unassignable: false })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    expect(record.attribution).toMatchObject({
      periodUnassignable: false,
      signalUnassignablePending: false,
      userPaths: new Set()
    })
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({ phase: 'agent', userPaths: new Set(['user.txt']) })
  })
})

describe('ツールの開始の待ち(waitForAgentPhase)', () => {
  it('記録の段階が agent で同期が無ければ、区切りを取らずにすぐ解決する', async () => {
    const h = setup()
    await startRecord(h)
    const first = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await first
    h.source.seq += 1
    await h.registry.waitForAgentPhase(1, new AbortController().signal)
    expect(h.calls).toHaveLength(2)
  })

  it('1 つ目の区切りの最中に 2 つ目の PreToolUse が届いても、2 つ目も区切りの完了まで解決しない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const first = toolStarts(h)
    const call = await snapshotCall(h, 1)
    // 2 つ目のツール(段階は agent のままなので、追跡は通知しない)
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, new AbortController().signal)
    const firstState = track(first)
    const secondState = track(second)
    await settle()
    expect(firstState.done()).toBe(false)
    expect(secondState.done()).toBe(false)
    call.resolve(checkpointResult(1))
    await first
    await second
    expect(record.attribution).toMatchObject({ phase: 'agent' })
    expect(h.calls).toHaveLength(2)
  })

  it('古い記録のときに並んだ同期が待っている間に記録を作り直しても(clear → begin)、新しい記録の待ちは新しい記録の区切りを取ってから解決する', async () => {
    const h = setup()
    await startRecord(h)
    const open = blockQueue(h)
    h.source.set({ phase: 'agent' })
    const old = h.registry.syncAttribution(1)
    const cleared = h.registry.clear(1)
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(10))
    await begun
    const waited = h.registry.waitForAgentPhase(1, new AbortController().signal)
    const waitedState = track(waited)
    await open()
    // 古い記録のときに並んだ同期も、走り始めた時点の記録(新しい記録)で区切りを取る
    const call = await snapshotCall(h, 2)
    expect(call.baseIndexPath).toBe('/tmp/cp-10/index')
    await settle()
    expect(waitedState.done()).toBe(false)
    call.resolve(checkpointResult(11))
    await waited
    await cleared
    await expect(old).resolves.toBe('synced')
  })

  it.each<['idle' | 'paused']>([['idle'], ['paused']])(
    '待ちの間にセッションが外れて段階が %s になると、タイマーを進めなくても待ちが解決する(何もしない同期を回し続けない。L-052)',
    async (next) => {
      const h = setup()
      await startRecord(h)
      const waited = toolStarts(h)
      const call = await snapshotCall(h, 1)
      change(h, { phase: next })
      call.resolve(checkpointResult(1))
      await expect(waited).resolves.toBeUndefined()
    }
  )

  it('待った同期が区切りを取らずに終わった(取り消し)ら、条件を満たさなくてもそれ以上待たない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve({ kind: 'canceled' })
    await expect(waited).resolves.toBeUndefined()
    await flush(h)
    expect(h.calls).toHaveLength(2)
    expect(record.attribution).toMatchObject({ phase: 'idle' })
  })

  it('待ちのループが何周しても、signal の abort の listener は 1 つだけ登録する(周ごとに溜めない)', async () => {
    const h = setup()
    await startRecord(h)
    const controller = new AbortController()
    const addListener = vi.spyOn(controller.signal, 'addEventListener')
    // 1 つ目の待ち: 区切り 1 を待つ(1 周目)
    const first = toolStarts(h, controller)
    const call1 = await snapshotCall(h, 1)
    // 2 つ目の待ち: 走っている区切り 1 の後ろに区切り 2 を並べる
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, new AbortController().signal)
    call1.resolve(checkpointResult(1))
    // 1 つ目の待ちは区切り 1 が synced で戻った後、2 周目で並んでいる同期 2(段階が同じなので何もしない)を待つ
    await first
    await second
    expect(h.calls).toHaveLength(2)
    const aborts = addListener.mock.calls.filter(([type]) => type === 'abort')
    expect(aborts).toHaveLength(1)
  })

  it('signal の中止で待ちをやめて解決する(reject しない)', async () => {
    const h = setup()
    await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    controller.abort()
    await expect(waited).resolves.toBeUndefined()
    await open()
  })

  it('同期の手順 8 の後(前の区切りを消している間)に PreToolUse が届くと、走っている同期が idle で終わっても解決せず、後ろの同期が agent にしてから解決する(ツールの書き込みは利用者の集合に入らない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const first = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await first
    const removal = deferred<void>()
    h.removeDir.mockImplementationOnce(() => removal.promise)
    h.collectBetween.mockResolvedValueOnce(entriesOf('a.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await vi.waitFor(() => expect(h.removeDir).toHaveBeenCalledWith('/tmp/cp-1'))
    const second = toolStarts(h)
    const secondState = track(second)
    removal.resolve()
    const call = await snapshotCall(h, 3)
    await settle()
    expect(secondState.done()).toBe(false)
    call.resolve(checkpointResult(3))
    await second
    expect(record.attribution).toMatchObject({ phase: 'agent' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('b.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 4)).resolve(checkpointResult(4))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(['a.txt', 'b.txt'])
    })
  })

  it('打ち切り → ツールが終わる(猶予が過ぎる)→ 同期: idle → agent → idle が idle にまとまっても、ツールの書き込みは利用者の集合に入らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    timeOut(h, controller)
    await waited
    // ツールが書いて終わり、猶予が過ぎた
    change(h, { phase: 'idle' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('tool.txt'))
    await open()
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    // 打ち切りの後の段階が idle なので、同期がもう 1 回並ぶ
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(),
      periodUnassignable: false,
      timedOutPending: false,
      hadUnassignedSince: true
    })
    expect(h.calls).toHaveLength(3)
  })

  it('区切りの途中で打ち切りがあり、終わりの段階が idle なら、次の区間にも印を残して同期をもう 1 回だけ並べる', async () => {
    const h = setup()
    const record = await startRecord(h)
    const first = toolStarts(h)
    const call = await snapshotCall(h, 1)
    const controller = new AbortController()
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, controller.signal)
    timeOut(h, controller)
    await second
    change(h, { phase: 'idle' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('x.txt'))
    call.resolve(checkpointResult(1))
    await first
    const again = await snapshotCall(h, 2)
    expect(again.baseIndexPath).toBe('/tmp/cp-1/index')
    again.resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: false,
      userPaths: new Set()
    })
    expect(h.calls).toHaveLength(3)
  })

  it('差分を求めている最中(手順 7)に打ち切りがあり、ツールが終わって手順 8 が idle なら、次の区間に印を残して同期を 1 回だけ並べる', async () => {
    const h = setup()
    const record = await startRecord(h)
    const gate = deferred<AgentChangeEntry[]>()
    h.collectBetween.mockImplementationOnce(() => gate.promise)
    h.collectBetween.mockResolvedValueOnce(entriesOf('tool.txt'))
    const first = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await vi.waitFor(() => expect(h.collectBetween).toHaveBeenCalledOnce())
    const controller = new AbortController()
    h.source.seq += 1
    const second = h.registry.waitForAgentPhase(1, controller.signal)
    timeOut(h, controller)
    await second
    change(h, { phase: 'idle' })
    gate.resolve(entriesOf('user.txt'))
    await first
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(['user.txt']),
      agentPaths: new Set(),
      periodUnassignable: false
    })
    expect(h.calls).toHaveLength(3)
  })

  it('同期が始まる前の打ち切り(同期は列で待っている)の後、区切りの最中にツールが書いて終わり手順 8 が idle なら、次の区間に印を残して同期を 1 回だけ並べ、その次の同期で印が下りる', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    const controller = new AbortController()
    const waited = toolStarts(h, controller)
    timeOut(h, controller)
    await waited
    await open()
    const call = await snapshotCall(h, 1)
    // 区切りの最中にツールが書いて終わり、猶予が過ぎた
    change(h, { phase: 'idle' })
    h.collectBetween.mockResolvedValueOnce(entriesOf('before.txt'))
    h.collectBetween.mockResolvedValueOnce(entriesOf('tool.txt'))
    call.resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(),
      periodUnassignable: false,
      timedOutPending: false
    })
    expect(h.calls).toHaveLength(3)
  })

  it('合図の unassignable が立ち続けても区切りを取り続けず、その間の PreToolUse は打ち切られずに解決する。合図が下りた後の同期から割り当てる', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held-1.txt'))
    change(h, { unassignable: true })
    // 列の外で同期的に印が立つ
    expect(record.attribution).toMatchObject({ periodUnassignable: true })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    await flush(h)
    expect(h.calls).toHaveLength(2)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held-2.txt'))
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(waited).resolves.toBeUndefined()
    await flush(h)
    await flush(h)
    expect(h.calls).toHaveLength(3)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held-3.txt'))
    change(h, { unassignable: false })
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await flush(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('agent.txt'))
    change(h, { phase: 'idle' })
    ;(await snapshotCall(h, 4)).resolve(checkpointResult(4))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set(['agent.txt']),
      periodUnassignable: false
    })
  })
})

describe('始点の後の同期(begin の syncNow)', () => {
  it('始点を取っている間にツールが始まったら(通し番号が変わった)、同期を 1 回並べてその区間を割り当てず、次の区間から区別する', async () => {
    const h = setup({ phase: 'idle' })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    const base = await snapshotCall(h, 0)
    h.source.seq += 1
    base.resolve(checkpointResult(0))
    await begun
    const call = await snapshotCall(h, 1)
    expect(call.baseIndexPath).toBe('/tmp/cp-0/index')
    h.collectBetween.mockResolvedValueOnce(entriesOf('q.txt'))
    call.resolve(checkpointResult(1))
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    expect(record?.attribution).toMatchObject({
      kind: 'tracking',
      phase: 'idle',
      periodUnassignable: false,
      userPaths: new Set(),
      trackingSince: 500,
      hadUnassignedSince: false
    })
  })

  it('agent(pending を含む)で始めると、最初の区間に印を立てて同期を 1 回並べる', async () => {
    const h = setup({ phase: 'agent' })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    ;(await snapshotCall(h, 0)).resolve(checkpointResult(0))
    await begun
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    expect(record?.attribution).toMatchObject({
      phase: 'agent',
      periodUnassignable: false,
      trackingSince: 500
    })
  })

  it('始点を取っている間に合図の unassignable が下りたら(保留が解けた)、同期を 1 回並べる', async () => {
    const h = setup({ phase: 'idle', unassignable: true })
    const begun = h.registry.begin(1, FOLDER, 'manual')
    const base = await snapshotCall(h, 0)
    h.source.set({ unassignable: false })
    base.resolve(checkpointResult(0))
    await begun
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    const record = await h.registry.withRecord(1, FOLDER, async (r) => r)
    expect(record?.attribution).toMatchObject({ periodUnassignable: false, trackingSince: 500 })
  })

  it('取り終えた時点で合図の unassignable が立っていれば、同期を並べない(合図が下りたときの同期に任せる)', async () => {
    const h = setup({ phase: 'idle', unassignable: true })
    await startRecord(h)
    await flush(h)
    expect(h.calls).toHaveLength(1)
  })
})

describe('戻す操作・取り消しの吸収(withAttributionAbsorbed)', () => {
  /** 列の中で吸収を行う(handler と同じ)。task の結果の applied で作業ツリーを変えたかを決める */
  function absorb(
    h: Harness,
    task: () => Promise<{ applied: number }>
  ): Promise<{ applied: number } | null> {
    return h.registry.withRecord(1, FOLDER, (record) =>
      h.registry.withAttributionAbsorbed(1, record, task, (result) => result.applied > 0)
    )
  }

  it('作業ツリーを変えたら S1・S2 を取り、S1 までの差分は今の段階に割り当て、S1 から S2 の差分はどちらにも入れない(段階は変えない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('u.txt'))
    const task = vi.fn(async () => ({ applied: 1 }))
    const absorbed = absorb(h, task)
    const s1 = await snapshotCall(h, 1)
    expect(s1.baseIndexPath).toBe('/tmp/cp-0/index')
    s1.resolve(checkpointResult(1))
    const s2 = await snapshotCall(h, 2)
    expect(task).toHaveBeenCalledOnce()
    expect(s2.baseIndexPath).toBe('/tmp/cp-1/index')
    s2.resolve(checkpointResult(2))
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(h.collectBetween).toHaveBeenCalledOnce()
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      userPaths: new Set(['u.txt']),
      agentPaths: new Set(),
      checkpoint: { snapshot: { tempDir: '/tmp/cp-2' }, sharedWithBaseline: false }
    })
    expect(h.removeDir).toHaveBeenCalledExactlyOnceWith('/tmp/cp-1')
    expect(h.devLog).toHaveBeenCalledWith(
      '[agent-attribution] owner=1 event=吸収 phase=idle→idle user=1 agent=0 unassignable=なし reason=-'
    )
  })

  it('作業ツリーを変えなかったら(changed が偽)S2 を取らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const absorbed = absorb(h, async () => ({ applied: 0 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await expect(absorbed).resolves.toEqual({ applied: 0 })
    await flush(h)
    expect(h.calls).toHaveLength(2)
    expect(record.attribution).toMatchObject({ checkpoint: { snapshot: { tempDir: '/tmp/cp-1' } } })
  })

  it('task が投げたら(1 件書き換えてから失敗した)S2 を取ってから同じ例外を投げ直し、書き換えた分は利用者の集合に入らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    // S1 から始まる差分には、書き換えた undone.txt が出る(S2 を取らなければ、次の同期で利用者の変更に入る)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-1' ? entriesOf('undone.txt') : []
    )
    const absorbed = absorb(h, async () => {
      throw new Error('途中で失敗しました')
    })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(absorbed).rejects.toThrow('途中で失敗しました')
    change(h, { phase: 'agent' })
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await flush(h)
    expect(record.attribution).toMatchObject({ phase: 'agent', userPaths: new Set() })
  })

  it('(1) の区切りに失敗しても task は行い、区別をやめる(lost・checkpoint-failed)。S2 は取らない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const task = vi.fn(async () => ({ applied: 1 }))
    const absorbed = absorb(h, task)
    ;(await snapshotCall(h, 1)).resolve({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(task).toHaveBeenCalledOnce()
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(h.calls).toHaveLength(2)
  })

  it('(1) の予期しない例外(区切りの取得の reject)は、注入した失敗のログに出して区別をやめ、開発版のログに lost を出し、task は行う', async () => {
    const h = setup()
    const record = await startRecord(h)
    const task = vi.fn(async () => ({ applied: 1 }))
    const absorbed = absorb(h, task)
    const err = new Error('予期しない失敗')
    ;(await snapshotCall(h, 1)).reject(err)
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(task).toHaveBeenCalledOnce()
    expect(h.warn).toHaveBeenCalledExactlyOnceWith('[agent-attribution] 吸収に失敗しました:', err)
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    // 予期しない例外の後始末の結果も、手順の結果と同じく開発版のログに lost として出す
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=checkpoint-failed'
    )
    expect(h.calls).toHaveLength(2)
  })

  it('保留中(合図の unassignable)の吸収の後も、今の区間の印が残る', async () => {
    const h = setup()
    const record = await startRecord(h)
    change(h, { unassignable: true })
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await flush(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('held.txt'))
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await absorbed
    expect(record.attribution).toMatchObject({ periodUnassignable: true, userPaths: new Set() })
  })

  it('(1) の差分を求めている最中の打ち切りの印は、吸収の後も残る(続く同期が片付ける)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const gate = deferred<AgentChangeEntry[]>()
    h.collectBetween.mockImplementationOnce(() => gate.promise)
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await vi.waitFor(() => expect(h.collectBetween).toHaveBeenCalledOnce())
    h.registry.markToolStartTimedOut(1)
    gate.resolve(entriesOf('u.txt'))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await absorbed
    expect(record.attribution).toMatchObject({
      periodUnassignable: true,
      timedOutPending: true,
      userPaths: new Set()
    })
  })

  it('吸収の前の打ち切りの印(戻す操作の後ろで打ち切られた)は吸収の後も残り、timedOutPending も残って続く同期が片付ける', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.registry.markToolStartTimedOut(1)
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await absorbed
    expect(record.attribution).toMatchObject({
      periodUnassignable: true,
      timedOutPending: true,
      hadUnassignedSince: true
    })
    // 続く同期: 打ち切りの後の段階が idle なので印を残してもう 1 回並べ、その次で下ろす
    h.registry.notifyAttributionSignal(1)
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    ;(await snapshotCall(h, 4)).resolve(checkpointResult(4))
    await flush(h)
    await flush(h)
    expect(record.attribution).toMatchObject({ periodUnassignable: false, timedOutPending: false })
  })

  it('S2 を取っている最中の close で、取れた区切りを同期で消し、記録を変えない(L-435)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    const s2 = await snapshotCall(h, 2)
    h.registry.close()
    s2.resolve(checkpointResult(2))
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    expect(h.removeDirSync).toHaveBeenCalledWith('/tmp/cp-2')
    expect(record.attribution).toMatchObject({ checkpoint: { snapshot: { tempDir: '/tmp/cp-1' } } })
  })

  it('区別していない記録(lost)では区切りを取らずに task だけを行う', async () => {
    const h = setup({ phase: 'idle', lost: 'receiver-unavailable' })
    await startRecord(h)
    await expect(absorb(h, async () => ({ applied: 1 }))).resolves.toEqual({ applied: 1 })
    expect(h.calls).toHaveLength(1)
  })

  it('合図が lost の間の戻す操作は、区切りを取らずに記録を lost(合図の理由)にし、task は行う', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 列が戻す操作で埋まっていて、合図の変化の同期がまだ走っていない(合図だけを書き換え、通知しない)
    h.source.set({ lost: 'hooks-not-confirmed' })
    const task = vi.fn(async () => ({ applied: 1 }))
    await expect(absorb(h, task)).resolves.toEqual({ applied: 1 })
    expect(task).toHaveBeenCalledOnce()
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
    expect(h.calls).toHaveLength(1)
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=hooks-not-confirmed'
    )
  })

  it('列が戻す操作で埋まっている間に段階が idle → agent に変わると、(1) は閉じた区間を割り当てず、印が (3) の後も残り、続く同期が片付けてツールの書き込みを利用者の集合に入れない', async () => {
    const h = setup()
    const record = await startRecord(h)
    const open = blockQueue(h)
    // 前の区切り(cp-0)からの差分に、利用者の編集とツールの書き込みが混ざっている
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-0' ? entriesOf('user.txt', 'tool.txt') : []
    )
    const absorbed = absorb(h, async () => ({ applied: 1 }))
    // 吸収の後ろに段階の変化の同期が並ぶ(hooks の効かない claude が書き始めた場合など)
    change(h, { phase: 'agent' })
    await open()
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(absorbed).resolves.toEqual({ applied: 1 })
    // (1)・(3) の両方の吸収のログに印が残っている(続く同期は手順 4 で印を控えて下ろすため、記録の値ではなくログで見る。
    // (1) の 1 行だけで満たす形にすると、(3) が印を下ろす退行を見落とす。L-168)
    const absorbLines = h.devLog.mock.calls
      .map(([line]) => line)
      .filter((line) => line.includes('event=吸収'))
    expect(absorbLines).toEqual([
      '[agent-attribution] owner=1 event=吸収 phase=idle→idle user=0 agent=0 unassignable=あり reason=-',
      '[agent-attribution] owner=1 event=吸収 phase=idle→idle user=0 agent=0 unassignable=あり reason=-'
    ])
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'agent',
      periodUnassignable: false,
      userPaths: new Set(),
      agentPaths: new Set(),
      hadUnassignedSince: true
    })
  })
})

describe('戻した操作の取り消しの吸収(undoLastRevert)', () => {
  const capture: Extract<AgentChangesUndoCapture, { kind: 'saved' }> = {
    kind: 'saved',
    dir: '/tmp/undo-1',
    items: [
      {
        path: 'a.txt',
        before: { kind: 'file', savedName: '0', mode: 0o644 },
        after: { kind: 'file', size: 4, sha256: 'a'.repeat(64), mode: 0o644 }
      }
    ]
  }
  /** 戻す操作の控えを記録に持たせる(undoId 1) */
  async function withUndo(h: Harness): Promise<void> {
    await h.registry.withRecord(1, FOLDER, (record) =>
      h.registry.commitRevertUndo(1, record, { operation: 'file', capture, applied: 1 })
    )
  }

  it('書き戻したら S1・S2 を取る(取り消しで戻った内容を利用者の変更にしない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    await withUndo(h)
    h.executeUndo.mockResolvedValueOnce({
      kind: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: []
    })
    const undone = h.registry.undoLastRevert(1, FOLDER, 1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(undone).resolves.toMatchObject({ status: 'done', restoredPaths: ['a.txt'] })
    expect(record.attribution).toMatchObject({ checkpoint: { snapshot: { tempDir: '/tmp/cp-2' } } })
  })

  it('取り消しが途中で失敗して投げても、S2 を取ってから投げ直す', async () => {
    const h = setup()
    await startRecord(h)
    await withUndo(h)
    h.executeUndo.mockResolvedValueOnce({
      kind: 'failed',
      message: '取り消しに失敗しました: a.txt',
      keepUndo: false
    })
    const undone = h.registry.undoLastRevert(1, FOLDER, 1)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await expect(undone).rejects.toThrow('取り消しに失敗しました: a.txt')
  })

  it('控えの undoId が違えば、区切りを取らずに投げる(作業ツリーを変えない例外は吸収の外)', async () => {
    const h = setup()
    await startRecord(h)
    await withUndo(h)
    await expect(h.registry.undoLastRevert(1, FOLDER, 99)).rejects.toThrow(
      '取り消せる操作が変わりました'
    )
    expect(h.calls).toHaveLength(1)
  })
})

describe('一覧の行の author(attributeEntries)', () => {
  it('区別をまだ始めていない記録(paused で始めた)は、すべて null', async () => {
    const h = setup({ phase: 'paused' })
    await startRecord(h)
    expect(await authorsOfList(h, entriesOf('a.txt'))).toEqual([null])
  })

  it('idle の今の区間(区切りが始点と共有)の行は user。比較は渡した行で行い、collectCurrent を呼ばない', async () => {
    const h = setup()
    await startRecord(h)
    expect(await authorsOfList(h, entriesOf('u.txt', 'v.txt'))).toEqual(['user', 'user'])
    expect(h.collectCurrent).not.toHaveBeenCalled()
  })

  it('agent の今の区間の行は agent、閉じた区間で利用者の集合に入ったパスも今の区間にあれば mixed(区切りからの行は collectCurrent で求める)', async () => {
    const h = setup()
    await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('m.txt'))
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    h.collectCurrent.mockResolvedValueOnce(entriesOf('m.txt', 't.txt'))
    expect(await authorsOfList(h, entriesOf('m.txt', 't.txt', 'x.txt'))).toEqual([
      'mixed',
      'agent',
      'agent'
    ])
    expect(h.collectCurrent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tempDir: '/tmp/cp-1' })
    )
  })

  it('今の区間の比較に失敗したら、区別をやめて(lost・checkpoint-failed)集合だけで付け、開発版のログに lost を出す(一覧は失敗にしない。L-002・L-424)', async () => {
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockResolvedValueOnce(entriesOf('m.txt'))
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    h.collectCurrent.mockRejectedValueOnce(new Error('記録が見つかりません'))
    expect(await authorsOfList(h, entriesOf('m.txt', 't.txt'))).toEqual(['user', 'agent'])
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=agent→- user=1 agent=0 unassignable=なし reason=checkpoint-failed'
    )
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('手順の予期しない例外は、注入した失敗のログに出して区別をやめ、今の区間なしで付ける(投げない。L-450)', async () => {
    const h = setup()
    const record = await startRecord(h)
    const err = new Error('予期しない失敗')
    h.source.activityOf = () => {
      throw err
    }
    expect(await authorsOfList(h, entriesOf('a.txt'))).toEqual([null])
    expect(h.warn).toHaveBeenCalledExactlyOnceWith(
      '[agent-attribution] 一覧の区別に失敗しました:',
      err
    )
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(h.devLog).toHaveBeenLastCalledWith(
      '[agent-attribution] owner=1 event=lost phase=idle→- user=0 agent=0 unassignable=なし reason=checkpoint-failed'
    )
  })

  it('段階の変化の同期より先に一覧が列で走ると、記録に印を立てずに今の区間を割り当てず、そのとき限りの unassignedNow を返す(利用者の変更と誤らない。待たない)', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 段階は agent に変わったが、通知(同期)はまだ届いていない
    h.source.set({ phase: 'agent' })
    const result = await h.registry.withRecord(1, FOLDER, (r) =>
      h.registry.attributeEntries(1, r, entriesOf('u.txt'))
    )
    expect(result?.entries.map((entry) => entry.author)).toEqual(['agent'])
    expect(result?.unassignedNow).toBe(true)
    expect(record.attribution).toMatchObject({ phase: 'idle', periodUnassignable: false })
    expect(h.calls).toHaveLength(1)
  })

  it('agent → idle の合図の変化と同期の間に一覧が走っても、続く同期がエージェントの区間を agentPaths に割り当てる(利用者の集合にもある行は mixed になる)', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 利用者が c.txt を変え(cp-0 → cp-1)、エージェントも c.txt を編集する(cp-1 → cp-2)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-0' || start.tempDir === '/tmp/cp-1' ? entriesOf('c.txt') : []
    )
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    expect(record.attribution).toMatchObject({ phase: 'agent', userPaths: new Set(['c.txt']) })
    // 自動の取り直しの一覧が列に並び、その最中に合図が idle になる(同期は一覧の後ろに並ぶ)
    const open = blockQueue(h)
    const listed = h.registry.withRecord(1, FOLDER, async (r) => {
      const result = await h.registry.attributeEntries(1, r, entriesOf('c.txt'))
      // 一覧は記録に印を立てない(続く同期が手順 4 で印を控えて下ろす前に、列の中で見る)
      const marked = r.attribution.kind === 'tracking' && r.attribution.periodUnassignable
      return { authors: result.entries.map((entry) => entry.author), marked, ...result }
    })
    change(h, { phase: 'idle' })
    await open()
    expect(await listed).toMatchObject({ authors: ['user'], marked: false, unassignedNow: true })
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    await flush(h)
    expect(record.attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: false,
      userPaths: new Set(['c.txt']),
      agentPaths: new Set(['c.txt']),
      hadUnassignedSince: false
    })
    expect(await authorsOfList(h, entriesOf('c.txt'))).toEqual(['mixed'])
  })

  it('すべて戻すが列で待つ間に段階が変わると、一覧(そのとき限りの印)と吸収の中の一覧(吸収の (1) の記録の印)が同じ author と要約になる', async () => {
    // 前提: 通知のない h.source.set で段階だけを変える(同期は列に並ばない)。実際に吸収の (1) が段階の違いで印を立てるのは、
    // すべて戻すが列で待つ間に段階が変わったときだけ。窓の一覧の後に押したすべて戻すは、先に並んだ同期が走るため下のテストの結果になる
    const h = setup()
    const record = await startRecord(h)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-0' ? entriesOf('c.txt') : entriesOf('c.txt', 't.txt')
    )
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    // 合図は idle に変わったが、同期はまだ走っていない
    h.source.set({ phase: 'idle' })
    const entries = entriesOf('c.txt', 't.txt')
    const listed = await h.registry.withRecord(1, FOLDER, async (r) => {
      const { entries: authored, unassignedNow } = await h.registry.attributeEntries(1, r, entries)
      return {
        authors: authored.map((entry) => entry.author),
        summary: summarizeAttribution(r.attribution, { unassignedNow })
      }
    })
    const reverted = h.registry.withRecord(1, FOLDER, (r) =>
      h.registry.withAttributionAbsorbed(
        1,
        r,
        async () => {
          const { entries: authored } = await h.registry.attributeEntries(1, r, entries)
          return {
            applied: 0,
            authors: authored.map((entry) => entry.author),
            summary: summarizeAttribution(r.attribution)
          }
        },
        (result) => result.applied > 0
      )
    )
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    const absorbed = await reverted
    expect(listed).toEqual({
      authors: ['user', 'agent'],
      summary: { kind: 'tracking', since: 100, hadUnassignedSince: true }
    })
    expect(absorbed).toMatchObject({ authors: listed?.authors, summary: listed?.summary })
    expect(record.attribution).toMatchObject({ periodUnassignable: true })
  })

  it('通知つきの合図の変化の窓の一覧の後に押したすべて戻すでは、先に走る同期が閉じた区間を割り当て、吸収の中の author は mixed になる(確認の一覧の user と食い違い、照合で中止の条件になる)', async () => {
    const h = setup()
    const record = await startRecord(h)
    // 利用者が c.txt を変え(cp-0 → cp-1)、エージェントも c.txt を編集する(cp-1 → cp-2)
    h.collectBetween.mockImplementation(async (start) =>
      start.tempDir === '/tmp/cp-0' || start.tempDir === '/tmp/cp-1' ? entriesOf('c.txt') : []
    )
    const waited = toolStarts(h)
    ;(await snapshotCall(h, 1)).resolve(checkpointResult(1))
    await waited
    expect(record.attribution).toMatchObject({ phase: 'agent', userPaths: new Set(['c.txt']) })
    // 一覧が列に並び、その最中に合図が idle に変わる(通知つき。同期は一覧の後ろに並ぶ)
    const open = blockQueue(h)
    const listed = h.registry.withRecord(1, FOLDER, async (r) => {
      const result = await h.registry.attributeEntries(1, r, entriesOf('c.txt'))
      return result.entries.map((entry) => entry.author)
    })
    change(h, { phase: 'idle' })
    // 窓の一覧を見てから押したすべて戻す(同期の後ろに並ぶ)
    const reverted = h.registry.withRecord(1, FOLDER, (r) =>
      h.registry.withAttributionAbsorbed(
        1,
        r,
        async () => {
          const result = await h.registry.attributeEntries(1, r, entriesOf('c.txt'))
          return { applied: 0, authors: result.entries.map((entry) => entry.author) }
        },
        (result) => result.applied > 0
      )
    )
    await open()
    expect(await listed).toEqual(['user'])
    ;(await snapshotCall(h, 2)).resolve(checkpointResult(2))
    ;(await snapshotCall(h, 3)).resolve(checkpointResult(3))
    const absorbed = await reverted
    // 同期が閉じた区間を agentPaths に割り当てたため、吸収の (1) は印を立てず、c.txt は mixed になる
    expect(absorbed?.authors).toEqual(['mixed'])
    expect(record.attribution).toMatchObject({ periodUnassignable: false })
  })

  it('渡した配列と行を変えず、author を入れた新しい配列を返す', async () => {
    const h = setup()
    await startRecord(h)
    const input = entriesOf('u.txt')
    const result = await h.registry.withRecord(1, FOLDER, (record) =>
      h.registry.attributeEntries(1, record, input)
    )
    expect(result?.entries).not.toBe(input)
    expect(result?.entries[0]).toEqual({ ...input[0], author: 'user' })
    expect(result?.unassignedNow).toBe(false)
    expect(input[0].author).toBeNull()
  })
})
