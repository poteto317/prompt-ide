import { describe, it, expect, vi } from 'vitest'
import { AgentSession } from '../agentSession'
import type { StopTree } from '../agentSession'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { AGENT_MAX_SESSIONS_PER_WINDOW, AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type { AgentSessionCreation } from '../agentSessionRegistry'
import { makeFakePty } from './helpers/fakePty'
import type { FakePty } from './helpers/fakePty'

// stop で pty の終了を起こす偽の stopTree を持つセッション
function makeSession(id: string): {
  session: AgentSession
  pty: FakePty
  stopTree: ReturnType<typeof vi.fn<StopTree>>
} {
  const pty = makeFakePty()
  const stopTree = vi.fn<StopTree>(async (_pty, exited) => {
    pty.emitExit(0, 15)
    await exited
  })
  const session = new AgentSession({
    id,
    pty,
    callbacks: { onData: vi.fn(), onExit: vi.fn() },
    stopTree
  })
  return { session, pty, stopTree }
}

const created = (session: AgentSession): (() => Promise<AgentSessionCreation>) =>
  vi.fn(async () => ({ kind: 'created' as const, session }))

// release を呼ぶまで停止が終わらないセッション(SIGTERM の猶予を待っている間を再現する)
function makeSlowStoppingSession(id: string): {
  session: AgentSession
  stopTree: ReturnType<typeof vi.fn<StopTree>>
  release: () => void
} {
  const pty = makeFakePty()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const stopTree = vi.fn<StopTree>(async (_pty, exited) => {
    await gate
    pty.emitExit(0, 15)
    await exited
  })
  const session = new AgentSession({
    id,
    pty,
    callbacks: { onData: vi.fn(), onExit: vi.fn() },
    stopTree
  })
  return { session, stopTree, release: () => release() }
}

// 保留中の Promise の続きを進める
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('AgentSessionRegistry', () => {
  it('起動して started と sessionId を返し、snapshot と hasAny に出る', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await expect(registry.start(1, 'a', created(session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's1'
    })
    expect(registry.snapshot(1)).toEqual([{ slotId: 'a', sessionId: 's1' }])
    expect(registry.hasAny()).toBe(true)
  })

  it('同じ枠に生きているセッションがあれば新しく起動せず already-running を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    const second = vi.fn(
      async (): Promise<AgentSessionCreation> => ({
        kind: 'created',
        session: makeSession('s2').session
      })
    )
    await expect(registry.start(1, 'a', second)).resolves.toEqual({
      kind: 'already-running',
      sessionId: 's1'
    })
    expect(second).not.toHaveBeenCalled()
  })

  it('同じ枠で起動中に 2 回目の依頼が来たら、1 回目の結果を already-running で返す(StrictMode の二重の依頼)', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = vi.fn(
      () =>
        new Promise<AgentSessionCreation>((resolve) => {
          release = () => resolve({ kind: 'created', session })
        })
    )
    const other = vi.fn(
      async (): Promise<AgentSessionCreation> => ({
        kind: 'created',
        session: makeSession('s2').session
      })
    )
    const first = registry.start(1, 'a', slow)
    const second = registry.start(1, 'a', other)
    release()
    await expect(first).resolves.toEqual({ kind: 'started', sessionId: 's1' })
    await expect(second).resolves.toEqual({ kind: 'already-running', sessionId: 's1' })
    expect(other).not.toHaveBeenCalled()
  })

  it('起動の失敗はそのまま返し、登録しない', async () => {
    const registry = new AgentSessionRegistry()
    const result = {
      kind: 'error' as const,
      error: 'command-not-found' as const,
      shellPathUnavailable: false
    }
    await expect(registry.start(1, 'a', async () => ({ kind: 'failed', result }))).resolves.toEqual(
      result
    )
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(false)
  })

  it('別の所有者のセッションとは独立している', async () => {
    const registry = new AgentSessionRegistry()
    await registry.start(1, 'a', created(makeSession('s1').session))
    await expect(registry.start(2, 'a', created(makeSession('s2').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's2'
    })
  })

  it('書き込み・リサイズは sessionId が一致するときだけ渡す(古い画面からの書き込みを捨てる)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    registry.write(1, 'old', 'x')
    registry.write(2, 's1', 'x')
    registry.resize(1, 'old', 10, 10)
    expect(pty.write).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
    registry.write(1, 's1', 'ok')
    registry.resize(1, 's1', 90, 20)
    expect(pty.write).toHaveBeenCalledWith('ok')
    expect(pty.resize).toHaveBeenCalledWith(90, 20)
  })

  it('stop は止めて登録を消す。sessionId が違えば止めない(枠の stop)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    await registry.stop(1, 'stopped', 'other')
    expect(stopTree).not.toHaveBeenCalled()
    await registry.stop(1, 'stopped', 's1')
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(false)
  })

  it('エージェント自身が終了したら登録を消し、次の start で新しく起動する', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    pty.emitExit(0)
    await session.exited
    expect(registry.snapshot(1)).toEqual([])
    await expect(registry.start(1, 'a', created(makeSession('s2').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's2'
    })
  })

  it('起動の途中で所有者全体の停止(stopOwner)が来たら、できたセッションを止めて登録しない(所有者のいないセッションを残さない)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, 'a', slow)
    const stopping = registry.stopOwner(1, 'stopped')
    release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await stopping
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('所有者全体の停止中に届いた start は、古い sessionId を返さず、停止の完了を待って新しいセッションを started で返す', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const stopping = registry.stopOwner(1, 'folder-changed')
    const next = created(makeSession('s2').session)
    const starting = registry.start(1, 'a', next)
    await flush()
    expect(next).not.toHaveBeenCalled()
    old.release()
    await expect(starting).resolves.toEqual({ kind: 'started', sessionId: 's2' })
    await stopping
    expect(old.session.isAlive()).toBe(false)
    expect(registry.snapshot(1)).toEqual([{ slotId: 'a', sessionId: 's2' }])
  })

  it('所有者全体の停止中に同じ枠へ同時に届いた複数の start は、1 つだけ起動する(StrictMode の二重の依頼)', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const stopping = registry.stopOwner(1, 'stopped')
    const first = created(makeSession('s2').session)
    const second = created(makeSession('s3').session)
    const a = registry.start(1, 'a', first)
    const b = registry.start(1, 'a', second)
    old.release()
    await expect(a).resolves.toEqual({ kind: 'started', sessionId: 's2' })
    await expect(b).resolves.toEqual({ kind: 'already-running', sessionId: 's2' })
    expect(second).not.toHaveBeenCalled()
    await stopping
  })

  it('起動中に所有者全体の停止(stopOwner)が来た後の start は、取り消された起動の結果を受け取らず、新しく起動して started を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, 'a', slow)
    const stopping = registry.stopOwner(1, 'stopped')
    const other = created(makeSession('s2').session)
    const restarting = registry.start(1, 'a', other)
    release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await expect(restarting).resolves.toEqual({ kind: 'started', sessionId: 's2' })
    await stopping
    expect(other).toHaveBeenCalledOnce()
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toEqual([{ slotId: 'a', sessionId: 's2' }])
  })

  it('所有者全体の停止中に届いた start は、待っている間に再び stopOwner が来たら(ウィンドウの破棄)、起動せず取り消しを返す', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const firstStop = registry.stopOwner(1, 'folder-changed')
    const next = created(makeSession('new').session)
    const starting = registry.start(1, 'a', next)
    const destroyStop = registry.stopOwner(1, 'stopped')
    old.release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await firstStop
    await destroyStop
    expect(next).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(false)
  })

  it('取り消された起動を待っている間に再び stopOwner が来たら、起動せず取り消しを返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('a')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, 'a', slow)
    const firstStop = registry.stopOwner(1, 'stopped')
    const other = created(makeSession('b').session)
    const restarting = registry.start(1, 'a', other)
    const secondStop = registry.stopOwner(1, 'stopped')
    release()
    const canceled = {
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    }
    await expect(starting).resolves.toEqual(canceled)
    await expect(restarting).resolves.toEqual(canceled)
    await firstStop
    await secondStop
    expect(other).not.toHaveBeenCalled()
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(false)
  })

  it('stopAll はすべての所有者のセッションを止める', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('a')
    const b = makeSession('b')
    await registry.start(1, 'a', created(a.session))
    await registry.start(2, 'a', created(b.session))
    await registry.stopAll('stopped')
    expect(a.stopTree).toHaveBeenCalledOnce()
    expect(b.stopTree).toHaveBeenCalledOnce()
    expect(registry.hasAny()).toBe(false)
  })

  it('所有者全体の停止中のセッションは hasAny に出て、stopAll はその停止の完了を待つ(終了の引き止めから漏れない)', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const stopping = registry.stopOwner(1, 'stopped')
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(true)
    let allStopped = false
    const stoppingAll = registry.stopAll('stopped').then(() => {
      allStopped = true
    })
    await flush()
    expect(allStopped).toBe(false)
    old.release()
    await stoppingAll
    await stopping
    expect(allStopped).toBe(true)
    expect(registry.hasAny()).toBe(false)
  })

  it('起動中の依頼は hasAny に出て、stopAll はその起動を取り消す(終了の引き止めから漏れない)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, 'a', slow)
    expect(registry.hasAny()).toBe(true)
    const stoppingAll = registry.stopAll('stopped')
    release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await stoppingAll
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(false)
  })

  it('close の後の start は、起動せず(create を呼ばず)取り消しを返す(アプリの終了を始めた後の起動)', async () => {
    const registry = new AgentSessionRegistry()
    registry.close()
    const next = created(makeSession('s1').session)
    await expect(registry.start(1, 'a', next)).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    expect(next).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
    expect(registry.hasAny()).toBe(false)
  })

  it('停止の完了を待っている間に close されたら、起動せず取り消しを返す', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const stopping = registry.stopOwner(1, 'folder-changed')
    const next = created(makeSession('new').session)
    const starting = registry.start(1, 'a', next)
    await flush()
    registry.close()
    old.release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await stopping
    expect(next).not.toHaveBeenCalled()
    expect(registry.hasAny()).toBe(false)
  })
})

describe('枠(タブ)ごとのセッション', () => {
  it('同じ所有者でも、枠が違えば別のセッションを起動する', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('s-a')
    const b = makeSession('s-b')
    await expect(registry.start(1, 'a', created(a.session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's-a'
    })
    await expect(registry.start(1, 'b', created(b.session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's-b'
    })
    expect(registry.snapshot(1)).toEqual([
      { slotId: 'a', sessionId: 's-a' },
      { slotId: 'b', sessionId: 's-b' }
    ])
  })

  it('同じ枠への 2 回目の依頼は already-running にまとめる(StrictMode)', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('s-a')
    const create = created(a.session)
    const [first, second] = await Promise.all([
      registry.start(1, 'a', create),
      registry.start(1, 'a', create)
    ])
    expect(first).toEqual({ kind: 'started', sessionId: 's-a' })
    expect(second).toEqual({ kind: 'already-running', sessionId: 's-a' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it(`所有者ごとに ${AGENT_MAX_SESSIONS_PER_WINDOW} つまで。超えると too-many-sessions を返し、create を呼ばない`, async () => {
    const registry = new AgentSessionRegistry()
    for (let i = 0; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
      await registry.start(1, `slot-${i}`, created(makeSession(`s-${i}`).session))
    }
    const create = created(makeSession('s-over').session)
    await expect(registry.start(1, 'slot-over', create)).resolves.toEqual({
      kind: 'error',
      error: 'too-many-sessions'
    })
    expect(create).not.toHaveBeenCalled()
    // ほかの所有者は数えない
    await expect(
      registry.start(2, 'slot-0', created(makeSession('s-other').session))
    ).resolves.toMatchObject({ kind: 'started' })
  })

  it('起動中の依頼も上限に数える', async () => {
    const registry = new AgentSessionRegistry()
    const gates: Array<() => void> = []
    const starts = Array.from({ length: AGENT_MAX_SESSIONS_PER_WINDOW }, (_, i) =>
      registry.start(
        1,
        `slot-${i}`,
        () =>
          new Promise<AgentSessionCreation>((resolve) => {
            gates.push(() => resolve({ kind: 'created', session: makeSession(`s-${i}`).session }))
          })
      )
    )
    await flush()
    await expect(
      registry.start(1, 'slot-over', created(makeSession('x').session))
    ).resolves.toEqual({ kind: 'error', error: 'too-many-sessions' })
    gates.forEach((release) => release())
    await Promise.all(starts)
  })

  // 上限まで起動中の依頼を出し、終わる前に stopOwner(リロード)で取り消す。gates を呼ぶと古い依頼の create が終わる
  const startPendingThenStopOwner = async (
    registry: AgentSessionRegistry
  ): Promise<{
    oldStarts: Promise<unknown>[]
    oldSessions: ReturnType<typeof makeSession>[]
    gates: Array<() => void>
    stopping: Promise<void>
  }> => {
    const gates: Array<() => void> = []
    const oldSessions = Array.from({ length: AGENT_MAX_SESSIONS_PER_WINDOW }, (_, i) =>
      makeSession(`s-old-${i}`)
    )
    const oldStarts = oldSessions.map((old, i) =>
      registry.start(
        1,
        `old-${i}`,
        () =>
          new Promise<AgentSessionCreation>((resolve) => {
            gates.push(() => resolve({ kind: 'created', session: old.session }))
          })
      )
    )
    await flush()
    const stopping = registry.stopOwner(1, 'stopped')
    return { oldStarts, oldSessions, gates, stopping }
  }

  it('stopOwner の後は、取り消された起動中の依頼が終わる前でも、別の枠で上限まで起動できる', async () => {
    const registry = new AgentSessionRegistry()
    const { oldStarts, gates, stopping } = await startPendingThenStopOwner(registry)
    for (let i = 0; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
      await expect(
        registry.start(1, `new-${i}`, created(makeSession(`s-new-${i}`).session))
      ).resolves.toEqual({ kind: 'started', sessionId: `s-new-${i}` })
    }
    // 上限に達したので、次は断る
    await expect(
      registry.start(1, 'new-over', created(makeSession('s-over').session))
    ).resolves.toEqual({ kind: 'error', error: 'too-many-sessions' })
    gates.forEach((release) => release())
    await stopping
    await Promise.all(oldStarts)
  })

  it('取り消された依頼はセッションにならない(上限を超えない)', async () => {
    const registry = new AgentSessionRegistry()
    const { oldStarts, oldSessions, gates, stopping } = await startPendingThenStopOwner(registry)
    for (let i = 0; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
      await registry.start(1, `new-${i}`, created(makeSession(`s-new-${i}`).session))
    }
    gates.forEach((release) => release())
    await stopping
    for (const result of await Promise.all(oldStarts)) {
      expect(result).toMatchObject({ kind: 'error', detail: AGENT_START_CANCELED_DETAIL })
    }
    // 取り消された依頼のセッションはすぐ止め、登録しない
    for (const old of oldSessions) expect(old.stopTree).toHaveBeenCalledTimes(1)
    expect(registry.snapshot(1)).toEqual(
      Array.from({ length: AGENT_MAX_SESSIONS_PER_WINDOW }, (_, i) => ({
        slotId: `new-${i}`,
        sessionId: `s-new-${i}`
      }))
    )
  })

  it('同時に届いた依頼も、await を挟まず上限を守る(上限を超えた 1 本だけが too-many-sessions)', async () => {
    const registry = new AgentSessionRegistry()
    const create = vi.fn(async (): Promise<AgentSessionCreation> => {
      await Promise.resolve()
      return { kind: 'created', session: makeSession(`s-${create.mock.calls.length}`).session }
    })
    const results = await Promise.all(
      Array.from({ length: AGENT_MAX_SESSIONS_PER_WINDOW + 1 }, (_, i) =>
        registry.start(1, `slot-${i}`, create)
      )
    )
    expect(results.filter((r) => r.kind === 'error')).toEqual([
      { kind: 'error', error: 'too-many-sessions' }
    ])
    expect(create).toHaveBeenCalledTimes(AGENT_MAX_SESSIONS_PER_WINDOW)
  })

  it('止めた後は、上限の枠が空いてまた起動できる', async () => {
    const registry = new AgentSessionRegistry()
    for (let i = 0; i < AGENT_MAX_SESSIONS_PER_WINDOW; i++) {
      await registry.start(1, `slot-${i}`, created(makeSession(`s-${i}`).session))
    }
    await registry.stop(1, 'stopped', 's-0')
    await expect(
      registry.start(1, 'slot-new', created(makeSession('s-new').session))
    ).resolves.toMatchObject({ kind: 'started' })
  })

  it('枠の停止は、その枠のセッションだけを止め、ほかの枠の起動中の依頼を取り消さない', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('s-a')
    await registry.start(1, 'a', created(a.session))
    let releaseB: () => void = () => undefined
    const b = makeSession('s-b')
    const startB = registry.start(
      1,
      'b',
      () =>
        new Promise<AgentSessionCreation>((resolve) => {
          releaseB = () => resolve({ kind: 'created', session: b.session })
        })
    )
    await flush()
    await registry.stop(1, 'stopped', 's-a')
    releaseB()
    await expect(startB).resolves.toEqual({ kind: 'started', sessionId: 's-b' })
    expect(a.stopTree).toHaveBeenCalledTimes(1)
    expect(registry.snapshot(1)).toEqual([{ slotId: 'b', sessionId: 's-b' }])
  })

  it('stopOwner は所有者のすべての枠を止め、起動中の依頼も取り消す', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('s-a')
    await registry.start(1, 'a', created(a.session))
    let releaseB: () => void = () => undefined
    const b = makeSession('s-b')
    const startB = registry.start(
      1,
      'b',
      () =>
        new Promise<AgentSessionCreation>((resolve) => {
          releaseB = () => resolve({ kind: 'created', session: b.session })
        })
    )
    await flush()
    const stopping = registry.stopOwner(1, 'folder-changed')
    releaseB()
    await stopping
    await expect(startB).resolves.toMatchObject({
      kind: 'error',
      detail: AGENT_START_CANCELED_DETAIL
    })
    expect(a.stopTree).toHaveBeenCalledTimes(1)
    expect(b.stopTree).toHaveBeenCalledTimes(1)
    expect(registry.snapshot(1)).toEqual([])
  })

  it('枠の世代は、その枠の停止と所有者全体の停止の両方で変わる(世代を控えている間)', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('s-a')
    await registry.start(1, 'a', created(a.session))
    // IPC の受け口と同じく、世代を控える間は hold する(手放して空になった枠は消え、世代は 0 から数え直す)
    const releaseA = registry.hold(1, 'a')
    const releaseB = registry.hold(1, 'b')
    const before = registry.generationOf(1, 'a')
    const otherBefore = registry.generationOf(1, 'b')
    await registry.stop(1, 'stopped', 's-a')
    expect(registry.generationOf(1, 'a')).not.toBe(before)
    expect(registry.generationOf(1, 'b')).toBe(otherBefore)
    await registry.stopOwner(1, 'stopped')
    expect(registry.generationOf(1, 'b')).not.toBe(otherBefore)
    releaseA()
    releaseB()
  })

  it('write・resize・stop は sessionId で枠を探し、ほかの所有者のセッションには届かない', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('s-a')
    await registry.start(1, 'a', created(a.session))
    registry.write(2, 's-a', 'x')
    await registry.stop(2, 'stopped', 's-a')
    expect(a.pty.write).not.toHaveBeenCalled()
    expect(a.stopTree).not.toHaveBeenCalled()
    registry.write(1, 's-a', 'y')
    expect(a.pty.write).toHaveBeenCalledWith('y')
  })

  it('1 つの枠が止まりかけでも、ほかの枠は起動できる', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const stopping = registry.stop(1, 'stopped', 'old')
    await expect(registry.start(1, 'b', created(makeSession('s-b').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's-b'
    })
    old.release()
    await stopping
  })

  it('停止中のセッションへの 2 回目の stop は、すぐには解決せず、その停止の完了を待つ(終了の途中の × ・方式の切り替え)', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const first = registry.stop(1, 'stopped', 'old')
    let secondSettled = false
    const second = registry.stop(1, 'stopped', 'old').then(() => {
      secondSettled = true
    })
    await flush()
    expect(secondSettled).toBe(false)
    old.release()
    await second
    await first
    expect(secondSettled).toBe(true)
    expect(old.stopTree).toHaveBeenCalledTimes(1)
  })

  it('停止中のセッションへの 2 回目の stop は、1 回目の停止が失敗したら同じく失敗する(止められなかったセッションを止め終えたものとして扱わない)', async () => {
    const registry = new AgentSessionRegistry()
    const pty = makeFakePty()
    let fail: (error: Error) => void = () => undefined
    const gate = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    const stopTree = vi.fn<StopTree>(async () => {
      await gate
    })
    const session = new AgentSession({
      id: 'old',
      pty,
      callbacks: { onData: vi.fn(), onExit: vi.fn() },
      stopTree
    })
    await registry.start(1, 'a', created(session))
    const first = registry.stop(1, 'stopped', 'old')
    const second = registry.stop(1, 'stopped', 'old')
    fail(new Error('stop failed'))
    await expect(first).rejects.toThrow('stop failed')
    await expect(second).rejects.toThrow('stop failed')
    expect(stopTree).toHaveBeenCalledTimes(1)
  })

  it('停止中のセッションへの stop も、ほかの所有者からは届かない(待たずに解決する)', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, 'a', created(old.session))
    const first = registry.stop(1, 'stopped', 'old')
    let otherSettled = false
    const other = registry.stop(2, 'stopped', 'old').then(() => {
      otherSettled = true
    })
    await flush()
    expect(otherSettled).toBe(true)
    await other
    old.release()
    await first
  })
})

describe('空になった枠の後始末', () => {
  it('起動に失敗した枠は残さない(新しい slotId で失敗を繰り返しても枠が増えない)', async () => {
    const registry = new AgentSessionRegistry()
    const failed = async (): Promise<AgentSessionCreation> => ({
      kind: 'failed',
      result: { kind: 'error', error: 'command-not-found', shellPathUnavailable: false }
    })
    for (const slotId of ['a', 'b', 'c', 'd', 'e', 'f']) await registry.start(1, slotId, failed)
    expect(registry.slotCountOf(1)).toBe(0)
  })

  it('止めた枠は、停止の完了まで残し、完了したら消す', async () => {
    const registry = new AgentSessionRegistry()
    const slow = makeSlowStoppingSession('s1')
    await registry.start(1, 'a', created(slow.session))
    expect(registry.slotCountOf(1)).toBe(1)
    const stopping = registry.stop(1, 'stopped', 's1')
    await flush()
    expect(registry.slotCountOf(1)).toBe(1)
    slow.release()
    await stopping
    expect(registry.slotCountOf(1)).toBe(0)
  })

  it('エージェント自身が終了した枠を消す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    pty.emitExit(0)
    await session.exited
    await flush()
    expect(registry.slotCountOf(1)).toBe(0)
  })

  it('所有者全体の停止の後も、空になった枠を消す', async () => {
    const registry = new AgentSessionRegistry()
    await registry.start(1, 'a', created(makeSession('s-a').session))
    await registry.start(1, 'b', created(makeSession('s-b').session))
    await registry.stopOwner(1, 'stopped')
    expect(registry.slotCountOf(1)).toBe(0)
  })

  it('世代を控えている(hold)間は、空になっても枠を消さず、停止で進んだ世代が巻き戻らない', async () => {
    const registry = new AgentSessionRegistry()
    await registry.start(1, 'a', created(makeSession('s1').session))
    // IPC の受け口が世代を控えてから registry.start を呼ぶまでの間(realpath の await)を再現する
    const release = registry.hold(1, 'a')
    const captured = registry.generationOf(1, 'a')
    await registry.stop(1, 'stopped', 's1')
    expect(registry.slotCountOf(1)).toBe(1)
    expect(registry.generationOf(1, 'a')).not.toBe(captured)
    release()
    expect(registry.slotCountOf(1)).toBe(0)
  })
})

describe('AgentSessionRegistry.generationOf', () => {
  it('最初は 0/0 で、stopOwner のたびに所有者ごとに進む(セッションが無くても進む)', async () => {
    const registry = new AgentSessionRegistry()
    expect(registry.generationOf(1, 'a')).toBe('0/0')
    await registry.stopOwner(1, 'stopped')
    expect(registry.generationOf(1, 'a')).toBe('1/0')
    expect(registry.generationOf(2, 'a')).toBe('0/0')
    const { session } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    expect(registry.generationOf(1, 'a')).toBe('1/0')
    await registry.stopOwner(1, 'stopped')
    expect(registry.generationOf(1, 'a')).toBe('2/0')
  })

  it('sessionId が一致しない stop では進まない', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await registry.start(1, 'a', created(session))
    await registry.stop(1, 'stopped', 'other')
    expect(registry.generationOf(1, 'a')).toBe('0/0')
  })

  it('参照しただけでは状態を作らない', () => {
    const registry = new AgentSessionRegistry()
    registry.generationOf(1, 'a')
    expect(registry.hasAny()).toBe(false)
    expect(registry.snapshot(1)).toEqual([])
  })
})
