import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import { AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type { AgentSessionData, AgentSessionExit, AgentStartRequest } from '@shared/types'
import { createAgentSessionStarter } from '../agentSessionStarter'
import type { AgentSessionSink, AgentSessionStarterDeps } from '../agentSessionStarter'
import type { PtySpawn, StopTree } from '../agentSession'
import type { AgentLaunchResolution } from '../agentCommand'
import { makeFakePty } from './helpers/fakePty'
import type { FakePty } from './helpers/fakePty'

const CANCELED = { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL }
const OK_LAUNCH: AgentLaunchResolution = {
  kind: 'ok',
  plan: { file: '/bin/claude', args: ['--x'], env: { PATH: '/p' } }
}
const REQUEST: AgentStartRequest = { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20 }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

interface FakeSink extends AgentSessionSink {
  gone: boolean
  data: AgentSessionData[]
  exits: AgentSessionExit[]
}

function makeSink(): FakeSink {
  const sink: FakeSink = {
    gone: false,
    data: [],
    exits: [],
    isGone: () => sink.gone,
    onData: (payload) => sink.data.push(payload),
    onExit: (payload) => sink.exits.push(payload)
  }
  return sink
}

let folderAccess: FolderAccessManager
let registry: AgentSessionRegistry
let pty: FakePty
let spawnPty: ReturnType<typeof vi.fn<PtySpawn>>
let resolveLaunch: ReturnType<typeof vi.fn<() => Promise<AgentLaunchResolution>>>
let canonicalize: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>
let isDirectory: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>
const stopTree = vi.fn<StopTree>(async (target, exited) => {
  ;(target as FakePty).emitExit(0, 15)
  await exited
})

function makeStarter(
  overrides: Partial<AgentSessionStarterDeps> = {}
): ReturnType<typeof createAgentSessionStarter> {
  return createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    canonicalize,
    isDirectory,
    ...overrides
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, '/work')
  registry = new AgentSessionRegistry()
  pty = makeFakePty(4242)
  spawnPty = vi.fn<PtySpawn>().mockReturnValue(pty)
  resolveLaunch = vi.fn(async () => OK_LAUNCH)
  canonicalize = vi.fn(async (path: string) => (path === '/work/.' ? '/work' : path))
  isDirectory = vi.fn(async () => true)
})

describe('createAgentSessionStarter(起動の可否)', () => {
  it('許可のフォルダを作業ディレクトリに、解決したコマンドで起動し、registry に登録する', async () => {
    const start = makeStarter()
    await expect(start(1, { ...REQUEST, folderPath: '/work/.' }, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1'
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/claude', ['--x'], {
      name: 'xterm-256color',
      cols: 90,
      rows: 20,
      cwd: '/work',
      env: { PATH: '/p' }
    })
    expect(isDirectory).toHaveBeenCalledWith('/work')
    expect(registry.snapshot(1)).toEqual([{ slotId: 'slot-1', sessionId: 'sid-1' }])
  })

  it('許可のフォルダが無ければ no-folder(フォルダを確かめずに返す)', async () => {
    const start = makeStarter()
    await expect(start(2, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'no-folder'
    })
    expect(canonicalize).not.toHaveBeenCalled()
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('依頼のフォルダの正規化が許可と違えば folder-mismatch', async () => {
    const start = makeStarter()
    await expect(start(1, { ...REQUEST, folderPath: '/other' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'folder-mismatch'
    })
    expect(resolveLaunch).not.toHaveBeenCalled()
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('許可のフォルダがディレクトリでなければ folder-missing(パスを添える)', async () => {
    isDirectory.mockResolvedValueOnce(false)
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'folder-missing',
      detail: '/work'
    })
    expect(resolveLaunch).not.toHaveBeenCalled()
  })

  it('コマンドが見つからなければ command-not-found(PATH の取得の失敗を添える)', async () => {
    resolveLaunch.mockResolvedValueOnce({ kind: 'not-found', shellPathUnavailable: true })
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'command-not-found',
      shellPathUnavailable: true
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('spawn が投げたら spawn-failed(例外の文言を添える)。Error 以外も文字列にする', async () => {
    spawnPty.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: 'posix_spawnp failed.'
    })
    spawnPty.mockImplementationOnce(() => {
      throw 'boom'
    })
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: 'boom'
    })
    expect(registry.snapshot(1)).toEqual([])
  })
})

describe('createAgentSessionStarter(出力の配線)', () => {
  it('出力と終了を sessionId 付きで sink へ渡す', async () => {
    const sink = makeSink()
    await makeStarter()(1, REQUEST, sink)
    pty.emitData('hi')
    pty.emitExit(1)
    expect(sink.data).toEqual([{ sessionId: 'sid-1', data: 'hi' }])
    expect(sink.exits).toEqual([
      { sessionId: 'sid-1', exitCode: 1, signal: null, reason: 'exited' }
    ])
  })
})

// 安全策: 世代は最初の await の前に控え、spawn の直前に世代・送信先の破棄・許可のフォルダを確かめ直し、
// 取り消しは spawn-failed + AGENT_START_CANCELED_DETAIL で返す
describe('createAgentSessionStarter(起動の途中の取り消し)', () => {
  it('フォルダの正規化を待つ間に停止(リロード)が来たら起動しない', async () => {
    const pending = deferred<string>()
    canonicalize.mockReturnValueOnce(pending.promise)
    const result = makeStarter()(1, REQUEST, makeSink())
    await registry.stopOwner(1, 'stopped')
    pending.resolve('/work')
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('フォルダの正規化を待つ間に送信先が破棄されたら起動しない', async () => {
    const pending = deferred<string>()
    canonicalize.mockReturnValueOnce(pending.promise)
    const sink = makeSink()
    const result = makeStarter()(1, REQUEST, sink)
    sink.gone = true
    pending.resolve('/work')
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('コマンドを探す間に停止(リロード)が来たら起動しない', async () => {
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const result = makeStarter()(1, REQUEST, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    const stopped = registry.stopOwner(1, 'stopped')
    pending.resolve(OK_LAUNCH)
    await expect(result).resolves.toEqual(CANCELED)
    await stopped
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('コマンドを探す間に送信先が破棄されたら起動しない', async () => {
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const sink = makeSink()
    const result = makeStarter()(1, REQUEST, sink)
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    sink.gone = true
    pending.resolve(OK_LAUNCH)
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('コマンドを探す間に許可のフォルダが切り替わったら(停止が届く前でも)起動しない', async () => {
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const result = makeStarter()(1, REQUEST, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    folderAccess.set(1, '/other')
    pending.resolve(OK_LAUNCH)
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('起動の途中で所有者全体の停止が来ると取り消す(枠の世代も変わる)', async () => {
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const result = makeStarter()(1, REQUEST, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    // 枠の停止の世代(generationOf)は所有者全体の停止でも変わる(起動中の枠には sessionId が無く、枠の stop は届かない)
    const before = registry.generationOf(1, 'slot-1')
    const stopped = registry.stopOwner(1, 'stopped')
    expect(registry.generationOf(1, 'slot-1')).not.toBe(before)
    pending.resolve(OK_LAUNCH)
    await expect(result).resolves.toEqual(CANCELED)
    await stopped
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('別の枠の停止では取り消さない', async () => {
    const first = makeStarter()(1, { ...REQUEST, slotId: 'slot-a' }, makeSink())
    await expect(first).resolves.toEqual({ kind: 'started', sessionId: 'sid-1' })
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const second = makeStarter()(1, { ...REQUEST, slotId: 'slot-b' }, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledTimes(2))
    // slot-a の枠だけを止める(slot-b の起動は続く)
    await registry.stop(1, 'stopped', 'sid-1')
    pending.resolve(OK_LAUNCH)
    await expect(second).resolves.toMatchObject({ kind: 'started' })
  })

  it('フォルダの正規化を待つ間にその枠が止められて空になっても、枠を消さずに取り消す(世代が巻き戻らない)', async () => {
    await expect(makeStarter()(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1'
    })
    const pending = deferred<string>()
    canonicalize.mockReturnValueOnce(pending.promise)
    const result = makeStarter()(1, REQUEST, makeSink())
    // 世代を控えた後に枠の停止が完了する(hold が無いと、空になった枠が消えて世代が 0 に戻る)
    await registry.stop(1, 'stopped', 'sid-1')
    pending.resolve('/work')
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).toHaveBeenCalledOnce()
    expect(registry.slotCountOf(1)).toBe(0)
  })

  it('停止の後に届いた新しい依頼は起動する', async () => {
    await registry.stopOwner(1, 'stopped')
    await expect(makeStarter()(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1'
    })
  })
})
