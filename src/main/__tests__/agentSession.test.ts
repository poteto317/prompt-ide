import { beforeEach, describe, it, expect, vi } from 'vitest'
import { AGENT_INTERRUPT_SEQUENCE, AgentSession, startAgentSession } from '../agentSession'
import type { AgentSessionCallbacks, PtySpawn, StopTree } from '../agentSession'
import { makeFakePty } from './helpers/fakePty'
import { AGENT_CLI_INTERRUPT_SPECS } from '../agentCliInterruptSpecs'

// 中断の送り方と時計(2 回目のテスト以外は claude の送り方と止まった時計)
const CLAUDE_INTERRUPT = { interruptSpec: AGENT_CLI_INTERRUPT_SPECS.claude, now: (): number => 0 }

function makeCallbacks(): AgentSessionCallbacks & {
  onData: ReturnType<typeof vi.fn<AgentSessionCallbacks['onData']>>
  onExit: ReturnType<typeof vi.fn<AgentSessionCallbacks['onExit']>>
} {
  return { onData: vi.fn(), onExit: vi.fn() }
}

describe('AgentSession', () => {
  it('pty の出力を onData へ渡す', () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    new AgentSession({ ...CLAUDE_INTERRUPT, id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitData('hello')
    expect(callbacks.onData).toHaveBeenCalledWith('hello')
  })

  it('書き込み・リサイズを pty へ渡す', () => {
    const pty = makeFakePty()
    const session = new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>()
    })
    session.write('abc')
    session.resize(100, 30)
    expect(pty.write).toHaveBeenCalledWith('abc')
    expect(pty.resize).toHaveBeenCalledWith(100, 30)
  })

  it('エージェント自身の終了は reason exited で通知し、購読を解除して exited を解決する', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const session = new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks,
      stopTree: vi.fn<StopTree>()
    })
    pty.emitExit(1)
    await session.exited
    expect(callbacks.onExit).toHaveBeenCalledWith({ exitCode: 1, signal: null, reason: 'exited' })
    expect(session.isAlive()).toBe(false)
    expect(pty.listenerCount()).toBe(0)
  })

  it('シグナルでの終了はシグナルの番号を渡す', () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    new AgentSession({ ...CLAUDE_INTERRUPT, id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitExit(0, 15)
    expect(callbacks.onExit).toHaveBeenCalledWith({ exitCode: 0, signal: 15, reason: 'exited' })
  })

  it('終了の後の書き込み・リサイズ・出力は無視する', () => {
    const pty = makeFakePty()
    // 購読の解除が間に合わずに終了の後に届く出力(終了と同じ tick の data)を再現するため、data の購読者を控えておく
    let lateData: (data: string) => void = () => undefined
    const subscribeData = pty.onData.bind(pty)
    pty.onData = (listener) => {
      lateData = listener
      return subscribeData(listener)
    }
    const callbacks = makeCallbacks()
    const session = new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks,
      stopTree: vi.fn<StopTree>()
    })
    pty.emitExit(0)
    session.write('late')
    session.resize(10, 10)
    lateData('late output')
    expect(pty.write).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
    expect(callbacks.onData).not.toHaveBeenCalled()
  })

  it('onExit の通知が例外を投げても exited は解決する', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    callbacks.onExit.mockImplementationOnce(() => {
      throw new Error('webContents destroyed')
    })
    const session = new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks,
      stopTree: vi.fn<StopTree>()
    })
    expect(() => pty.emitExit(0)).toThrow('webContents destroyed')
    await session.exited
    expect(session.isAlive()).toBe(false)
    expect(pty.listenerCount()).toBe(0)
  })

  it('pty の終了の通知が来ないまま stopTree が解決しても、終了したとみなして通知する', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const stopTree = vi.fn<StopTree>(async () => undefined)
    const session = new AgentSession({ ...CLAUDE_INTERRUPT, id: 's1', pty, callbacks, stopTree })
    await session.stop('stopped')
    await session.exited
    expect(session.isAlive()).toBe(false)
    expect(callbacks.onExit).toHaveBeenCalledOnce()
    expect(callbacks.onExit).toHaveBeenCalledWith({
      exitCode: null,
      signal: null,
      reason: 'stopped'
    })
    expect(pty.listenerCount()).toBe(0)
    // 後から来た終了の通知は二重に通知しない
    pty.emitExit(0, 9)
    expect(callbacks.onExit).toHaveBeenCalledOnce()
  })

  it('書き込み・リサイズの例外(EIO)は投げない', () => {
    const pty = makeFakePty()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    pty.resize.mockImplementationOnce(() => {
      throw new Error('EBADF')
    })
    const session = new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>()
    })
    expect(() => session.write('x')).not.toThrow()
    expect(() => session.resize(1, 1)).not.toThrow()
  })

  it('stop は stopTree を 1 回だけ呼び、終了の理由に stop の理由を使う', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const stopTree = vi.fn<StopTree>(async (_pty, exited) => {
      pty.emitExit(0, 15)
      await exited
    })
    const session = new AgentSession({ ...CLAUDE_INTERRUPT, id: 's1', pty, callbacks, stopTree })
    const first = session.stop('folder-changed')
    const second = session.stop('stopped')
    expect(second).toBe(first)
    await first
    expect(stopTree).toHaveBeenCalledOnce()
    expect(stopTree.mock.calls[0][0]).toBe(pty)
    expect(callbacks.onExit).toHaveBeenCalledWith({
      exitCode: 0,
      signal: 15,
      reason: 'folder-changed'
    })
  })

  it('終了した後の stop は何もせずに解決する', async () => {
    const pty = makeFakePty()
    const stopTree = vi.fn<StopTree>()
    const session = new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree
    })
    pty.emitExit(0)
    await session.stop('stopped')
    expect(stopTree).not.toHaveBeenCalled()
  })
})

describe('AgentSession.interrupt', () => {
  const makeSession = (
    pty = makeFakePty(),
    stopTree = vi.fn<StopTree>()
  ): { session: AgentSession; pty: ReturnType<typeof makeFakePty> } => ({
    session: new AgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree
    }),
    pty
  })

  it('固定の 1 バイト(\\x1b)だけを pty へ書き、sent を返す(renderer の値を混ぜない)', () => {
    const { session, pty } = makeSession()
    expect(AGENT_INTERRUPT_SEQUENCE).toBe('\x1b')
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: null })
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('終了の後は書かずに not-alive を返す', () => {
    const { session, pty } = makeSession()
    pty.emitExit(0)
    expect(session.interrupt()).toEqual({ kind: 'not-alive' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('stop の後(終了の前)は書かずに not-alive を返す(止めている pty に送らない)', () => {
    // 止まりきらない stopTree(SIGTERM の猶予を待っている間)
    const { session, pty } = makeSession(
      makeFakePty(),
      vi.fn<StopTree>(() => new Promise<void>(() => undefined))
    )
    void session.stop('stopped')
    expect(session.isAlive()).toBe(true)
    expect(session.interrupt()).toEqual({ kind: 'not-alive' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('pty.write が投げたら write-failed を返し、例外を投げない', () => {
    const { session, pty } = makeSession()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(session.interrupt()).toEqual({ kind: 'write-failed' })
  })
})

describe('AgentSession.interruptFollowUp(2 回目の要る種類: copilot)', () => {
  let clock: number
  const makeCopilotSession = (
    pty = makeFakePty(),
    stopTree = vi.fn<StopTree>()
  ): { session: AgentSession; pty: ReturnType<typeof makeFakePty> } => ({
    session: new AgentSession({
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree,
      interruptSpec: AGENT_CLI_INTERRUPT_SPECS.copilot,
      now: () => clock
    }),
    pty
  })

  beforeEach(() => {
    clock = 1_000
  })

  it('1 回目は固定の 1 バイトだけを書き、2 回目を頼むまでの待ち(afterMs: 100)を返す', () => {
    const { session, pty } = makeCopilotSession()
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('1 回目から 100ms 後の 2 回目で、もう 1 バイトの Esc を書く(書いた列の完全一致)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 100
    expect(session.interruptFollowUp()).toBe('sent')
    expect(pty.write.mock.calls).toEqual([['\x1b'], ['\x1b']])
  })

  it('1 回目から 49ms では not-pending で書かない(受け付けの下限 minIntervalMs: 50。2 回を 1 つの読み取りに詰めない)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 49
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('1 回目から 50ms ちょうど・99ms(renderer のタイマーが afterMs より早く発火した場合)は書く', () => {
    const atMin = makeCopilotSession()
    atMin.session.interrupt()
    clock += 50
    expect(atMin.session.interruptFollowUp()).toBe('sent')
    expect(atMin.pty.write.mock.calls).toEqual([['\x1b'], ['\x1b']])
    const early = makeCopilotSession()
    early.session.interrupt()
    clock += 99
    expect(early.session.interruptFollowUp()).toBe('sent')
    expect(early.pty.write.mock.calls).toEqual([['\x1b'], ['\x1b']])
  })

  it('1 回目から 400ms ちょうどは書き、401ms では expired で書かない', () => {
    const onTime = makeCopilotSession()
    onTime.session.interrupt()
    clock += 400
    expect(onTime.session.interruptFollowUp()).toBe('sent')
    const late = makeCopilotSession()
    late.session.interrupt()
    clock += 401
    expect(late.session.interruptFollowUp()).toBe('expired')
    expect(late.pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('控えは 1 回で使い切る(2 回目の後の 2 回目・早すぎた依頼の後の依頼は not-pending)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 100
    session.interruptFollowUp()
    expect(session.interruptFollowUp()).toBe('not-pending')
    const early = makeCopilotSession()
    early.session.interrupt()
    clock += 49
    early.session.interruptFollowUp()
    clock += 100
    expect(early.session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write).toHaveBeenCalledTimes(2)
    expect(early.pty.write).toHaveBeenCalledTimes(1)
  })

  it('1 回目の後に stop したら(止まりきる前でも)not-alive で書かない', () => {
    const { session, pty } = makeCopilotSession(
      makeFakePty(),
      vi.fn<StopTree>(() => new Promise<void>(() => undefined))
    )
    session.interrupt()
    void session.stop('stopped')
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-alive')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('1 回目の後に終了したら not-alive で書かない', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    pty.emitExit(0)
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-alive')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('2 回目の書き込みが投げたら write-failed(例外を投げない)。控えは使い切り、続けて頼んでも not-pending で書き直さない', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    clock += 100
    expect(session.interruptFollowUp()).toBe('write-failed')
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write).toHaveBeenCalledTimes(2)
  })

  it('控えが残っている間にもう一度 1 回目を呼ぶと、控えは新しい時刻で上書きされる(t0・t300 で 1 回目 → t450 の 2 回目は sent)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 300
    session.interrupt()
    clock += 150
    expect(session.interruptFollowUp()).toBe('sent')
    expect(pty.write.mock.calls).toEqual([['\x1b'], ['\x1b'], ['\x1b']])
  })

  it('1 回目の書き込みが投げたら控えを作らない(その後の 2 回目は not-pending)', () => {
    const { session, pty } = makeCopilotSession()
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(session.interrupt()).toEqual({ kind: 'write-failed' })
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write).toHaveBeenCalledTimes(1)
  })

  it('前の 1 回目の控えが残っている間に、次の 1 回目の書き込みが投げたら、前の控えで 2 回目を書かない(not-pending)', () => {
    const { session, pty } = makeCopilotSession()
    session.interrupt()
    clock += 10
    pty.write.mockImplementationOnce(() => {
      throw new Error('EIO')
    })
    expect(session.interrupt()).toEqual({ kind: 'write-failed' })
    // 前の 1 回目から 100ms(受け付けの窓の内)でも、書けなかった 1 回目の後なので書かない
    clock += 90
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write).toHaveBeenCalledTimes(2)
  })

  it('claude の送り方では followUp: null を返し、interruptFollowUp は not-pending で書かない', () => {
    const pty = makeFakePty()
    const session = new AgentSession({
      id: 's1',
      pty,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>(),
      interruptSpec: AGENT_CLI_INTERRUPT_SPECS.claude,
      now: () => clock
    })
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: null })
    clock += 100
    expect(session.interruptFollowUp()).toBe('not-pending')
    expect(pty.write.mock.calls).toEqual([['\x1b']])
  })

  it('startAgentSession は送り方と時計をセッションに渡す', () => {
    const pty = makeFakePty()
    const session = startAgentSession({
      id: 's9',
      spawn: vi.fn<PtySpawn>().mockReturnValueOnce(pty),
      file: '/bin/copilot',
      args: [],
      env: {},
      cwd: '/work',
      cols: 80,
      rows: 24,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>(),
      interruptSpec: AGENT_CLI_INTERRUPT_SPECS.copilot,
      now: () => clock
    })
    expect(session.interrupt()).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
    clock += 100
    expect(session.interruptFollowUp()).toBe('sent')
  })
})

describe('startAgentSession', () => {
  it('xterm-256color・桁数・行数・作業ディレクトリ・環境変数で spawn する', () => {
    const pty = makeFakePty()
    const spawn = vi.fn<PtySpawn>().mockReturnValueOnce(pty)
    const session = startAgentSession({
      ...CLAUDE_INTERRUPT,
      id: 's9',
      spawn,
      file: '/bin/claude',
      args: [],
      env: { PATH: '/p' },
      cwd: '/work',
      cols: 120,
      rows: 40,
      callbacks: makeCallbacks(),
      stopTree: vi.fn<StopTree>()
    })
    expect(spawn).toHaveBeenCalledWith('/bin/claude', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: '/work',
      env: { PATH: '/p' }
    })
    expect(session.id).toBe('s9')
  })

  it('spawn の例外はそのまま投げる', () => {
    const spawn = vi.fn<PtySpawn>().mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    expect(() =>
      startAgentSession({
        ...CLAUDE_INTERRUPT,
        id: 's',
        spawn,
        file: '/x',
        args: [],
        env: {},
        cwd: '/',
        cols: 80,
        rows: 24,
        callbacks: makeCallbacks(),
        stopTree: vi.fn<StopTree>()
      })
    ).toThrow('posix_spawnp failed.')
  })
})
