import { describe, it, expect, vi } from 'vitest'
import { AgentSession, startAgentSession } from '../agentSession'
import type { AgentSessionCallbacks, PtySpawn, StopTree } from '../agentSession'
import { makeFakePty } from './helpers/fakePty'

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
    new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitData('hello')
    expect(callbacks.onData).toHaveBeenCalledWith('hello')
  })

  it('書き込み・リサイズを pty へ渡す', () => {
    const pty = makeFakePty()
    const session = new AgentSession({
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
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    pty.emitExit(1)
    await session.exited
    expect(callbacks.onExit).toHaveBeenCalledWith({ exitCode: 1, signal: null, reason: 'exited' })
    expect(session.isAlive()).toBe(false)
    expect(pty.listenerCount()).toBe(0)
  })

  it('シグナルでの終了はシグナルの番号を渡す', () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
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
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
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
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree: vi.fn<StopTree>() })
    expect(() => pty.emitExit(0)).toThrow('webContents destroyed')
    await session.exited
    expect(session.isAlive()).toBe(false)
    expect(pty.listenerCount()).toBe(0)
  })

  it('pty の終了の通知が来ないまま stopTree が解決しても、終了したとみなして通知する', async () => {
    const pty = makeFakePty()
    const callbacks = makeCallbacks()
    const stopTree = vi.fn<StopTree>(async () => undefined)
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree })
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
    const session = new AgentSession({ id: 's1', pty, callbacks, stopTree })
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
    const session = new AgentSession({ id: 's1', pty, callbacks: makeCallbacks(), stopTree })
    pty.emitExit(0)
    await session.stop('stopped')
    expect(stopTree).not.toHaveBeenCalled()
  })
})

describe('startAgentSession', () => {
  it('xterm-256color・桁数・行数・作業ディレクトリ・環境変数で spawn する', () => {
    const pty = makeFakePty()
    const spawn = vi.fn<PtySpawn>().mockReturnValueOnce(pty)
    const session = startAgentSession({
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
