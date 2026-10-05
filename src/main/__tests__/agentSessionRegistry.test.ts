import { describe, it, expect, vi } from 'vitest'
import { AgentSession } from '../agentSession'
import type { StopTree } from '../agentSession'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { AGENT_START_CANCELED_DETAIL } from '@shared/types'
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
    await expect(registry.start(1, created(session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's1'
    })
    expect(registry.snapshot(1)).toEqual({ sessionId: 's1' })
    expect(registry.hasAny()).toBe(true)
  })

  it('生きているセッションがあれば新しく起動せず already-running を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await registry.start(1, created(session))
    const second = vi.fn(
      async (): Promise<AgentSessionCreation> => ({
        kind: 'created',
        session: makeSession('s2').session
      })
    )
    await expect(registry.start(1, second)).resolves.toEqual({
      kind: 'already-running',
      sessionId: 's1'
    })
    expect(second).not.toHaveBeenCalled()
  })

  it('起動中に 2 回目の依頼が来たら、1 回目の結果を already-running で返す(StrictMode の二重の依頼)', async () => {
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
    const first = registry.start(1, slow)
    const second = registry.start(1, other)
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
    await expect(registry.start(1, async () => ({ kind: 'failed', result }))).resolves.toEqual(
      result
    )
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('別の所有者のセッションとは独立している', async () => {
    const registry = new AgentSessionRegistry()
    await registry.start(1, created(makeSession('s1').session))
    await expect(registry.start(2, created(makeSession('s2').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's2'
    })
  })

  it('書き込み・リサイズは sessionId が一致するときだけ渡す(古い画面からの書き込みを捨てる)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, created(session))
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

  it('stop は止めて登録を消す。sessionId が違えば止めない', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    await registry.start(1, created(session))
    await registry.stop(1, 'stopped', 'other')
    expect(stopTree).not.toHaveBeenCalled()
    await registry.stop(1, 'stopped', 's1')
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('エージェント自身が終了したら登録を消し、次の start で新しく起動する', async () => {
    const registry = new AgentSessionRegistry()
    const { session, pty } = makeSession('s1')
    await registry.start(1, created(session))
    pty.emitExit(0)
    await session.exited
    expect(registry.snapshot(1)).toBeNull()
    await expect(registry.start(1, created(makeSession('s2').session))).resolves.toEqual({
      kind: 'started',
      sessionId: 's2'
    })
  })

  it('起動の途中で stop されたら、できたセッションを止めて登録しない(所有者のいないセッションを残さない)', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, slow)
    const stopping = registry.stop(1, 'stopped')
    release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await stopping
    expect(stopTree).toHaveBeenCalledOnce()
    expect(registry.snapshot(1)).toBeNull()
  })

  it('停止中に届いた start は、古い sessionId を返さず、停止の完了を待って新しいセッションを started で返す', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, created(old.session))
    const stopping = registry.stop(1, 'folder-changed')
    const next = created(makeSession('s2').session)
    const starting = registry.start(1, next)
    await flush()
    expect(next).not.toHaveBeenCalled()
    old.release()
    await expect(starting).resolves.toEqual({ kind: 'started', sessionId: 's2' })
    await stopping
    expect(old.session.isAlive()).toBe(false)
    expect(registry.snapshot(1)).toEqual({ sessionId: 's2' })
  })

  it('停止中に同時に届いた複数の start は、1 つだけ起動する(StrictMode の二重の依頼)', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, created(old.session))
    const stopping = registry.stop(1, 'stopped')
    const first = created(makeSession('s2').session)
    const second = created(makeSession('s3').session)
    const a = registry.start(1, first)
    const b = registry.start(1, second)
    old.release()
    await expect(a).resolves.toEqual({ kind: 'started', sessionId: 's2' })
    await expect(b).resolves.toEqual({ kind: 'already-running', sessionId: 's2' })
    expect(second).not.toHaveBeenCalled()
    await stopping
  })

  it('起動中に stop された後の start は、取り消された起動の結果を受け取らず、新しく起動して started を返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('s1')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, slow)
    const stopping = registry.stop(1, 'stopped')
    const other = created(makeSession('s2').session)
    const restarting = registry.start(1, other)
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
    expect(registry.snapshot(1)).toEqual({ sessionId: 's2' })
  })

  it('停止中に届いた start は、待っている間に再び stop されたら(ウィンドウの破棄)、起動せず取り消しを返す', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, created(old.session))
    const firstStop = registry.stop(1, 'folder-changed')
    const next = created(makeSession('new').session)
    const starting = registry.start(1, next)
    const destroyStop = registry.stop(1, 'stopped')
    old.release()
    await expect(starting).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    await firstStop
    await destroyStop
    expect(next).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('取り消された起動を待っている間に再び stop されたら、起動せず取り消しを返す', async () => {
    const registry = new AgentSessionRegistry()
    const { session, stopTree } = makeSession('a')
    let release: () => void = () => undefined
    const slow = (): Promise<AgentSessionCreation> =>
      new Promise((resolve) => {
        release = () => resolve({ kind: 'created', session })
      })
    const starting = registry.start(1, slow)
    const firstStop = registry.stop(1, 'stopped')
    const other = created(makeSession('b').session)
    const restarting = registry.start(1, other)
    const secondStop = registry.stop(1, 'stopped')
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
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('stopAll はすべての所有者のセッションを止める', async () => {
    const registry = new AgentSessionRegistry()
    const a = makeSession('a')
    const b = makeSession('b')
    await registry.start(1, created(a.session))
    await registry.start(2, created(b.session))
    await registry.stopAll('stopped')
    expect(a.stopTree).toHaveBeenCalledOnce()
    expect(b.stopTree).toHaveBeenCalledOnce()
    expect(registry.hasAny()).toBe(false)
  })

  it('停止中のセッションは hasAny に出て、stopAll はその停止の完了を待つ(終了の引き止めから漏れない)', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, created(old.session))
    const stopping = registry.stop(1, 'stopped')
    expect(registry.snapshot(1)).toBeNull()
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
    const starting = registry.start(1, slow)
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
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('close の後の start は、起動せず(create を呼ばず)取り消しを返す(アプリの終了を始めた後の起動)', async () => {
    const registry = new AgentSessionRegistry()
    registry.close()
    const next = created(makeSession('s1').session)
    await expect(registry.start(1, next)).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: AGENT_START_CANCELED_DETAIL
    })
    expect(next).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toBeNull()
    expect(registry.hasAny()).toBe(false)
  })

  it('停止の完了を待っている間に close されたら、起動せず取り消しを返す', async () => {
    const registry = new AgentSessionRegistry()
    const old = makeSlowStoppingSession('old')
    await registry.start(1, created(old.session))
    const stopping = registry.stop(1, 'folder-changed')
    const next = created(makeSession('new').session)
    const starting = registry.start(1, next)
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

describe('AgentSessionRegistry.generationOf', () => {
  it('最初は 0 で、stop のたびに所有者ごとに進む(セッションが無くても進む)', async () => {
    const registry = new AgentSessionRegistry()
    expect(registry.generationOf(1)).toBe(0)
    await registry.stop(1, 'stopped')
    expect(registry.generationOf(1)).toBe(1)
    expect(registry.generationOf(2)).toBe(0)
    const { session } = makeSession('s1')
    await registry.start(1, created(session))
    expect(registry.generationOf(1)).toBe(1)
    await registry.stop(1, 'stopped')
    expect(registry.generationOf(1)).toBe(2)
  })

  it('sessionId が一致しない stop では進まない', async () => {
    const registry = new AgentSessionRegistry()
    const { session } = makeSession('s1')
    await registry.start(1, created(session))
    await registry.stop(1, 'stopped', 'other')
    expect(registry.generationOf(1)).toBe(0)
  })
})
