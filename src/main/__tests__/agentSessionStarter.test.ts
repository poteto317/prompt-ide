import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import type { AgentRegistryStartResult } from '../agentSessionRegistry'
import { AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type { AgentSessionData, AgentSessionExit, AgentStartRequest } from '@shared/types'
import { createAgentSessionStarter } from '../agentSessionStarter'
import type {
  AgentSessionSink,
  AgentSessionStarter,
  AgentSessionStarterDeps,
  AgentSessionStarterService
} from '../agentSessionStarter'
import { createAgentSessionRecordStore } from '../agentSessionRecordStore'
import type { AgentSessionRecordStore } from '../agentSessionRecordStore'
import { createClaudeSessionReservations } from '../claudeSessionReservations'
import type { ClaudeSessionReservations } from '../claudeSessionReservations'
import type { MockInstance } from 'vitest'
import type { PtySpawn, StopTree } from '../agentSession'
import type { AgentLaunchResolution } from '../agentCommand'
import { makeFakePty } from './helpers/fakePty'
import type { FakePty } from './helpers/fakePty'
import { makeFakeRecordIo, recordFileOf } from './helpers/fakeAgentSessionRecordIo'

const CANCELED = { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL }
const OK_LAUNCH: AgentLaunchResolution = {
  kind: 'ok',
  plan: { file: '/bin/claude', args: ['--x'], env: { PATH: '/p' } }
}
const REQUEST: AgentStartRequest = {
  slotId: 'slot-1',
  folderPath: '/work',
  cols: 90,
  rows: 20,
  launch: { kind: 'new' }
}
// 新しく振る claude のセッション ID(呼ぶたびに次の値)
const NEW_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
]

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
let records: AgentSessionRecordStore
let reservations: ClaudeSessionReservations
let claudeIdCount: number
let consoleErrorSpy: MockInstance<typeof console.error> | null = null
const stopTree = vi.fn<StopTree>(async (target, exited) => {
  ;(target as FakePty).emitExit(0, 15)
  await exited
})

function makeStarterService(
  overrides: Partial<AgentSessionStarterDeps> = {}
): AgentSessionStarterService {
  return createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    records,
    reservations,
    createClaudeSessionId: () => NEW_IDS[claudeIdCount++],
    platform: 'linux',
    canonicalize,
    isDirectory,
    ...overrides
  })
}

function makeStarter(overrides: Partial<AgentSessionStarterDeps> = {}): AgentSessionStarter {
  return makeStarterService(overrides).start
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
  records = createAgentSessionRecordStore(makeFakeRecordIo())
  reservations = createClaudeSessionReservations()
  claudeIdCount = 0
  consoleErrorSpy = null
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
})

describe('createAgentSessionStarter(起動の可否)', () => {
  it('許可のフォルダを作業ディレクトリに、解決したコマンドで起動し、registry に登録する', async () => {
    const start = makeStarter()
    await expect(start(1, { ...REQUEST, folderPath: '/work/.' }, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/claude', ['--x', '--session-id', NEW_IDS[0]], {
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
    await expect(first).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
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
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
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
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
  })
})

describe('createAgentSessionStarter(claude のセッション ID・記録・予約)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-9222-222222222222'
  const RESUME: AgentStartRequest = { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID } }
  let ptys: FakePty[]
  let sessionCount: number
  const nextSessionId = (): string => `sid-${++sessionCount}`
  const service = (overrides: Partial<AgentSessionStarterDeps> = {}): AgentSessionStarterService =>
    makeStarterService({ createSessionId: nextSessionId, ...overrides })
  // 止める手順(子孫の停止)を、gate を開くまで止まりきらないようにする
  const holdNextStop = (): { open: () => void } => {
    const gate = deferred<void>()
    stopTree.mockImplementationOnce(async (target, exited) => {
      await gate.promise
      ;(target as FakePty).emitExit(0, 15)
      await exited
    })
    return { open: () => gate.resolve() }
  }

  beforeEach(async () => {
    ptys = []
    sessionCount = 0
    spawnPty.mockImplementation(() => {
      const created = makeFakePty()
      ptys.push(created)
      return created
    })
    await records.whenLoaded()
  })

  it('new は ID を振って --session-id で起動し、started に返す。返した時点で記録の先頭になっている', async () => {
    const { start, claudeSessionIdOf } = service()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--session-id', NEW_IDS[0]],
      expect.any(Object)
    )
    expect(records.last('/work')).toBe(NEW_IDS[0])
    expect(records.has('/work', NEW_IDS[0])).toBe(true)
    expect(claudeSessionIdOf('sid-1')).toBe(NEW_IDS[0])
  })

  it('claudeSessionIdOf のキーは pty の sessionId で、claude の会話の ID や知らない sessionId では引けない', async () => {
    const { start, claudeSessionIdOf } = service()
    await start(1, REQUEST, makeSink())
    expect(claudeSessionIdOf(NEW_IDS[0])).toBeUndefined()
    expect(claudeSessionIdOf('sid-unknown')).toBeUndefined()
  })

  it('resume は記録にある ID を検証を通った値のまま --resume で起動し(L-018)、記録の先頭へ移す', async () => {
    records.record('/work', ID)
    records.record('/work', OTHER)
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: ID
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--resume', ID],
      expect.any(Object)
    )
    expect(records.last('/work')).toBe(ID)
    // 新しい ID は振らない
    expect(claudeIdCount).toBe(0)
  })

  it.each([
    ['記録が無い', (): void => undefined],
    ['ほかのフォルダの記録にだけある', (): void => records.record('/other', ID)]
  ])('resume で %s ID は unknown-session(spawn も予約もしない。L-019)', async (_label, seed) => {
    seed()
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'unknown-session'
    })
    expect(spawnPty).not.toHaveBeenCalled()
    expect(reservations.tryReserve(ID)).not.toBeNull()
  })

  it('createSessionId が投げても予約が残らない(同じ ID をもう一度予約できる)', async () => {
    records.record('/work', ID)
    const { start } = service({
      createSessionId: () => {
        throw new Error('id failed')
      }
    })
    await expect(start(1, RESUME, makeSink())).rejects.toThrow('id failed')
    expect(spawnPty).not.toHaveBeenCalled()
    expect(reservations.tryReserve(ID)).not.toBeNull()
  })

  it('記録の読み込みが終わるまで照合を待つ(読み込みの前の空の記録で unknown-session にしない)', async () => {
    const read = deferred<string>()
    records = createAgentSessionRecordStore(makeFakeRecordIo(read.promise))
    const { start } = service()
    const result = start(1, RESUME, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    expect(spawnPty).not.toHaveBeenCalled()
    read.resolve(recordFileOf([{ key: '/work', ids: [ID] }]))
    await expect(result).resolves.toMatchObject({ kind: 'started', claudeSessionId: ID })
  })

  it('already-running は動いているセッションの ID を返し、依頼の ID は使わない(新しく振らない)', async () => {
    records.record('/work', OTHER)
    const { start } = service()
    await start(1, REQUEST, makeSink())
    await expect(
      start(1, { ...REQUEST, launch: { kind: 'resume', claudeSessionId: OTHER } }, makeSink())
    ).resolves.toEqual({ kind: 'already-running', sessionId: 'sid-1', claudeSessionId: NEW_IDS[0] })
    expect(spawnPty).toHaveBeenCalledOnce()
    expect(claudeIdCount).toBe(1)
    // already-running は create を通らないため、依頼の ID を予約しない
    expect(reservations.tryReserve(OTHER)).not.toBeNull()
  })

  it('already-running の pty の id が Map に無ければ、推測の ID を返さず例外にしてログを残す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { start } = service({
      registry: {
        generationOf: (ownerId, slotId) => registry.generationOf(ownerId, slotId),
        hold: (ownerId, slotId) => registry.hold(ownerId, slotId),
        start: async () => ({ kind: 'already-running', sessionId: 'ghost' })
      }
    })
    await expect(start(1, REQUEST, makeSink())).rejects.toThrow()
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('registry の未知の結果の種類は、動いているセッションの id でも already-running として返さず投げる(既定の分岐へ流さない)', async () => {
    let calls = 0
    const { start } = service({
      registry: {
        generationOf: (ownerId, slotId) => registry.generationOf(ownerId, slotId),
        hold: (ownerId, slotId) => registry.hold(ownerId, slotId),
        start: async (ownerId, slotId, create) => {
          calls += 1
          if (calls === 1) return registry.start(ownerId, slotId, create)
          // 種類を足したときの値(型の外の値)を、動いているセッションの id で返す
          return { kind: 'stopping', sessionId: 'sid-1' } as unknown as AgentRegistryStartResult
        }
      }
    })
    await expect(start(1, REQUEST, makeSink())).resolves.toMatchObject({ kind: 'started' })
    await expect(start(1, REQUEST, makeSink())).rejects.toThrow('未知の起動の結果です')
    // 記録は最初の started の 1 回だけ
    expect(records.last('/work')).toBe(NEW_IDS[0])
  })

  it('セッションの exited で Map から消え(registry が枠から外す購読より先)、予約も外れ、次の依頼は新しく起動する', async () => {
    const observed: (string | undefined)[] = []
    let svc: AgentSessionStarterService | null = null
    // registry と同じく、create の後(starter がセッションを返した後)に exited を購読する
    svc = service({
      registry: {
        generationOf: (ownerId, slotId) => registry.generationOf(ownerId, slotId),
        hold: (ownerId, slotId) => registry.hold(ownerId, slotId),
        start: (ownerId, slotId, create) =>
          registry.start(ownerId, slotId, async () => {
            const creation = await create()
            if (creation.kind === 'created') {
              const { session } = creation
              void session.exited.then(() => observed.push(svc?.claudeSessionIdOf(session.id)))
            }
            return creation
          })
      }
    })
    await svc.start(1, REQUEST, makeSink())
    expect(svc.claudeSessionIdOf('sid-1')).toBe(NEW_IDS[0])
    ptys[0].emitExit(0)
    await vi.waitFor(() => expect(observed).toEqual([undefined]))
    expect(svc.claudeSessionIdOf('sid-1')).toBeUndefined()
    expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
    await vi.waitFor(() => expect(registry.snapshot(1)).toEqual([]))
    await expect(svc.start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-2',
      claudeSessionId: NEW_IDS[1]
    })
  })

  it('同じ ID の 2 つの再開が並んでも 1 つだけ通り、ほかは session-in-use', async () => {
    records.record('/work', ID)
    const { start } = service()
    const results = await Promise.all([
      start(1, { ...RESUME, slotId: 'slot-a' }, makeSink()),
      start(1, { ...RESUME, slotId: 'slot-b' }, makeSink())
    ])
    expect(results.map((r) => (r.kind === 'error' ? r.error : r.kind)).sort()).toEqual([
      'session-in-use',
      'started'
    ])
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('同じ ID が動いている間は、別の枠・別の所有者(ウィンドウ)からの再開を session-in-use で拒む', async () => {
    records.record('/work', ID)
    folderAccess.set(2, '/work')
    const { start } = service()
    await start(1, RESUME, makeSink())
    await expect(start(1, { ...RESUME, slotId: 'slot-2' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    // 別の所有者の starter(同じ予約の集合を共有する)
    await expect(service().start(2, RESUME, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('止める操作で止まりきる前は予約が残り(session-in-use)、止まりきると再開できる', async () => {
    records.record('/work', ID)
    const stop = holdNextStop()
    const { start } = service()
    await start(1, RESUME, makeSink())
    const stopping = registry.stop(1, 'stopped', 'sid-1')
    await expect(start(1, { ...RESUME, slotId: 'slot-2' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    stop.open()
    await stopping
    await expect(start(1, { ...RESUME, slotId: 'slot-3' }, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('spawn した後に取り消した起動は、取り消しの停止が終わるまで予約が残り、記録しない', async () => {
    records.record('/work', ID)
    records.record('/work', OTHER)
    const stop = holdNextStop()
    spawnPty.mockImplementationOnce(() => {
      // spawn の直後(registry が世代を比べる前)にリロードが届いた
      void registry.stopOwner(1, 'stopped')
      const created = makeFakePty()
      ptys.push(created)
      return created
    })
    const { start } = service()
    const canceled = start(1, RESUME, makeSink())
    await vi.waitFor(() => expect(stopTree).toHaveBeenCalledOnce())
    await expect(start(1, { ...RESUME, slotId: 'slot-2' }, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    stop.open()
    await expect(canceled).resolves.toEqual(CANCELED)
    expect(records.last('/work')).toBe(OTHER)
    await expect(start(1, { ...RESUME, slotId: 'slot-3' }, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('spawn が投げたら予約をすぐ外し、記録しない', async () => {
    records.record('/work', ID)
    records.record('/work', OTHER)
    spawnPty.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toMatchObject({ error: 'spawn-failed' })
    expect(records.last('/work')).toBe(OTHER)
    await expect(start(1, RESUME, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('起動が確定したら、記録の失敗でも started を返す(ログだけ。L-001)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { start } = service({
      records: {
        whenLoaded: () => records.whenLoaded(),
        has: (key, id) => records.has(key, id),
        last: (key) => records.last(key),
        record: vi.fn(() => {
          throw new Error('disk full')
        })
      }
    })
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: NEW_IDS[0]
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentSessionStarter] 起動の記録に失敗しました:',
      expect.any(Error)
    )
  })

  it('Windows のフォルダのキーは小文字で照合・記録する', async () => {
    folderAccess.set(1, 'C:\\Work')
    canonicalize.mockImplementation(async (path: string) => path)
    records.record('c:\\work', ID)
    const { start } = service({ platform: 'win32' })
    await expect(
      start(1, { ...RESUME, folderPath: 'C:\\Work' }, makeSink())
    ).resolves.toMatchObject({ kind: 'started', claudeSessionId: ID })
    expect(records.last('c:\\work')).toBe(ID)
  })
})

describe('createAgentSessionStarter: lastSessionOf(前回)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('依頼のフォルダの正規化が許可のフォルダと一致するときだけ、記録の先頭を返す', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    const { lastSessionOf } = makeStarterService()
    await expect(lastSessionOf(1, '/work/.')).resolves.toEqual({ claudeSessionId: ID })
    await expect(lastSessionOf(1, '/other')).resolves.toBeNull()
    await expect(lastSessionOf(2, '/work')).resolves.toBeNull()
  })

  it('Windows のフォルダのキーは小文字にそろえて引く(大文字小文字の違う表記で記録したものを引ける)', async () => {
    folderAccess.set(1, 'C:\\Work')
    canonicalize.mockImplementation(async (path: string) => path)
    await records.whenLoaded()
    records.record('c:\\work', ID)
    const { lastSessionOf } = makeStarterService({ platform: 'win32' })
    await expect(lastSessionOf(1, 'C:\\Work')).resolves.toEqual({ claudeSessionId: ID })
  })

  it('記録が無ければ null', async () => {
    await expect(makeStarterService().lastSessionOf(1, '/work')).resolves.toBeNull()
  })

  it('許可のフォルダが無ければ、起動(start)と同じくフォルダを正規化せずに null', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    await expect(makeStarterService().lastSessionOf(2, '/work')).resolves.toBeNull()
    expect(canonicalize).not.toHaveBeenCalled()
  })

  it('起動(start)と同じ照合の規則を使う(正規化して一致するフォルダは両方で通り、一致しないフォルダは両方で弾く)', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    const service = makeStarterService()
    await expect(service.lastSessionOf(1, '/work/.')).resolves.toEqual({ claudeSessionId: ID })
    await expect(
      service.start(1, { ...REQUEST, folderPath: '/work/.' }, makeSink())
    ).resolves.toMatchObject({ kind: 'started' })
    await expect(service.lastSessionOf(1, '/other')).resolves.toBeNull()
    await expect(
      service.start(1, { ...REQUEST, slotId: 'slot-2', folderPath: '/other' }, makeSink())
    ).resolves.toEqual({ kind: 'error', error: 'folder-mismatch' })
  })

  it('記録の読み込みの完了を待ってから先頭を返す', async () => {
    const read = deferred<string>()
    records = createAgentSessionRecordStore(makeFakeRecordIo(read.promise))
    const result = makeStarterService().lastSessionOf(1, '/work')
    read.resolve(recordFileOf([{ key: '/work', ids: [ID] }]))
    await expect(result).resolves.toEqual({ claudeSessionId: ID })
  })

  it('正規化を待つ間に許可のフォルダが切り替わったら null(切り替え前のフォルダの記録を返さない)', async () => {
    await records.whenLoaded()
    records.record('/work', ID)
    const pending = deferred<string>()
    canonicalize.mockReturnValueOnce(pending.promise)
    const result = makeStarterService().lastSessionOf(1, '/work')
    folderAccess.set(1, '/other')
    pending.resolve('/work')
    await expect(result).resolves.toBeNull()
  })
})
