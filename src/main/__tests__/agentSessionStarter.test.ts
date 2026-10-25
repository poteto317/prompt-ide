import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { FolderAccessManager } from '../folderAccessManager'
import { AgentSessionRegistry } from '../agentSessionRegistry'
import type { AgentRegistryStartResult } from '../agentSessionRegistry'
import { AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type { AgentSessionData, AgentSessionExit, AgentStartRequest } from '@shared/types'
import { createAgentSessionStarter } from '../agentSessionStarter'
import type {
  AgentSessionInfo,
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
import { makeFakeAgentHookSessions } from './helpers/fakeAgentHookSessions'
import type { FakeAgentHookSessions } from './helpers/fakeAgentHookSessions'
import type { PreparedAgentHooks } from '../agentHookSessions'

const CANCELED = { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL }
const OK_LAUNCH: AgentLaunchResolution = {
  kind: 'ok',
  plan: { cliKind: 'claude', file: '/bin/claude', args: ['--x'], env: { PATH: '/p' } }
}
const REQUEST: AgentStartRequest = {
  slotId: 'slot-1',
  folderPath: '/work',
  cols: 90,
  rows: 20,
  launch: { kind: 'new' }
}
// 新しく振る会話の ID(再開に対応する種類の new。呼ぶたびに次の値)
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
let claudeRecords: AgentSessionRecordStore
let copilotRecords: AgentSessionRecordStore
let reservations: ClaudeSessionReservations
let hooks: FakeAgentHookSessions
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
    records: { claude: claudeRecords, copilot: copilotRecords },
    reservations,
    createClaudeSessionId: () => NEW_IDS[claudeIdCount++],
    platform: 'linux',
    canonicalize,
    isDirectory,
    hooks,
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
  claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo())
  copilotRecords = createAgentSessionRecordStore(makeFakeRecordIo())
  reservations = createClaudeSessionReservations()
  hooks = makeFakeAgentHookSessions()
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
      cliKind: 'claude',
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
    resolveLaunch.mockResolvedValueOnce({
      kind: 'not-found',
      cliKind: 'claude',
      shellPathUnavailable: true
    })
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'command-not-found',
      cliKind: 'claude',
      shellPathUnavailable: true
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('copilot が見つからなければ、command-not-found に copilot を載せる(文言はその種類の名前で出す)', async () => {
    resolveLaunch.mockResolvedValueOnce({
      kind: 'not-found',
      cliKind: 'copilot',
      shellPathUnavailable: false
    })
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'command-not-found',
      cliKind: 'copilot',
      shellPathUnavailable: false
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
      cliKind: 'claude',
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
      cliKind: 'claude',
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
      cliKind: 'claude',
      claudeSessionId: NEW_IDS[0]
    })
  })
})

describe('createAgentSessionStarter(claude のセッション ID・記録・予約)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-9222-222222222222'
  const RESUME: AgentStartRequest = {
    ...REQUEST,
    launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' }
  }
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
    await claudeRecords.whenLoaded()
  })

  it('new は ID を振って --session-id で起動し、started に返す。返した時点で記録の先頭になっていて、ID を予約している', async () => {
    const { start, sessionInfoOf } = service()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'claude',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--session-id', NEW_IDS[0]],
      expect.any(Object)
    )
    expect(claudeRecords.last('/work')).toBe(NEW_IDS[0])
    expect(claudeRecords.has('/work', NEW_IDS[0])).toBe(true)
    expect(reservations.tryReserve(NEW_IDS[0])).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'claude', claudeSessionId: NEW_IDS[0] })
  })

  it('sessionInfoOf のキーは pty の sessionId で、claude の会話の ID や知らない sessionId では引けない', async () => {
    const { start, sessionInfoOf } = service()
    await start(1, REQUEST, makeSink())
    expect(sessionInfoOf(NEW_IDS[0])).toBeUndefined()
    expect(sessionInfoOf('sid-unknown')).toBeUndefined()
  })

  it('resume は記録にある ID を検証を通った値のまま --resume で起動し(L-018)、記録の先頭へ移す', async () => {
    claudeRecords.record('/work', ID)
    claudeRecords.record('/work', OTHER)
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'claude',
      claudeSessionId: ID
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--resume', ID],
      expect.any(Object)
    )
    expect(claudeRecords.last('/work')).toBe(ID)
    // 新しい ID は振らない
    expect(claudeIdCount).toBe(0)
  })

  it.each([
    ['記録が無い', (): void => undefined],
    ['ほかのフォルダの記録にだけある', (): void => claudeRecords.record('/other', ID)]
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
    claudeRecords.record('/work', ID)
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
    claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo(read.promise))
    const { start } = service()
    const result = start(1, RESUME, makeSink())
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    expect(spawnPty).not.toHaveBeenCalled()
    read.resolve(recordFileOf([{ key: '/work', ids: [ID] }]))
    await expect(result).resolves.toMatchObject({ kind: 'started', claudeSessionId: ID })
  })

  it('already-running は動いているセッションの ID を返し、依頼の ID は使わない(新しく振らない)', async () => {
    claudeRecords.record('/work', OTHER)
    const { start } = service()
    await start(1, REQUEST, makeSink())
    await expect(
      start(
        1,
        { ...REQUEST, launch: { kind: 'resume', claudeSessionId: OTHER, cliKind: 'claude' } },
        makeSink()
      )
    ).resolves.toEqual({
      kind: 'already-running',
      sessionId: 'sid-1',
      cliKind: 'claude',
      claudeSessionId: NEW_IDS[0]
    })
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

  it('registry が create を通さずに started を返したら(種類が入っていない取り違え)、能力で見分けずに投げて記録しない(L-044)', async () => {
    const { start } = service({
      registry: {
        generationOf: (ownerId, slotId) => registry.generationOf(ownerId, slotId),
        hold: (ownerId, slotId) => registry.hold(ownerId, slotId),
        start: async () => ({ kind: 'started', sessionId: 'ghost' })
      }
    })
    await expect(start(1, REQUEST, makeSink())).rejects.toThrow(
      '起動したセッションの CLI の種類がありません'
    )
    expect(claudeRecords.last('/work')).toBeNull()
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
    expect(claudeRecords.last('/work')).toBe(NEW_IDS[0])
  })

  it('セッションの exited で Map から消え(registry が枠から外す購読より先)、予約も外れ、次の依頼は新しく起動する', async () => {
    const observed: (AgentSessionInfo | undefined)[] = []
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
              void session.exited.then(() => observed.push(svc?.sessionInfoOf(session.id)))
            }
            return creation
          })
      }
    })
    await svc.start(1, REQUEST, makeSink())
    expect(svc.sessionInfoOf('sid-1')).toEqual({ cliKind: 'claude', claudeSessionId: NEW_IDS[0] })
    ptys[0].emitExit(0)
    await vi.waitFor(() => expect(observed).toEqual([undefined]))
    expect(svc.sessionInfoOf('sid-1')).toBeUndefined()
    expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
    await vi.waitFor(() => expect(registry.snapshot(1)).toEqual([]))
    await expect(svc.start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-2',
      cliKind: 'claude',
      claudeSessionId: NEW_IDS[1]
    })
  })

  it('同じ ID の 2 つの再開が並んでも 1 つだけ通り、ほかは session-in-use', async () => {
    claudeRecords.record('/work', ID)
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
    claudeRecords.record('/work', ID)
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
    claudeRecords.record('/work', ID)
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
    claudeRecords.record('/work', ID)
    claudeRecords.record('/work', OTHER)
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
    expect(claudeRecords.last('/work')).toBe(OTHER)
    await expect(start(1, { ...RESUME, slotId: 'slot-3' }, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('spawn が投げたら予約をすぐ外し、記録しない', async () => {
    claudeRecords.record('/work', ID)
    claudeRecords.record('/work', OTHER)
    spawnPty.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    const { start } = service()
    await expect(start(1, RESUME, makeSink())).resolves.toMatchObject({ error: 'spawn-failed' })
    expect(claudeRecords.last('/work')).toBe(OTHER)
    await expect(start(1, RESUME, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: ID
    })
  })

  it('起動が確定したら、記録の失敗でも started を返す(ログだけ。L-001)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { start } = service({
      records: {
        claude: {
          whenLoaded: () => claudeRecords.whenLoaded(),
          has: (key, id) => claudeRecords.has(key, id),
          last: (key) => claudeRecords.last(key),
          record: vi.fn(() => {
            throw new Error('disk full')
          })
        },
        copilot: copilotRecords
      }
    })
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'claude',
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
    claudeRecords.record('c:\\work', ID)
    const { start } = service({ platform: 'win32' })
    await expect(
      start(1, { ...RESUME, folderPath: 'C:\\Work' }, makeSink())
    ).resolves.toMatchObject({ kind: 'started', claudeSessionId: ID })
    expect(claudeRecords.last('c:\\work')).toBe(ID)
  })
})

describe('createAgentSessionStarter: lastSessionOf(前回)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('依頼の種類の記録の先頭を種類付きで返す(copilot の記録は copilot の依頼にだけ返す)', async () => {
    const OTHER = '22222222-2222-4222-9222-222222222222'
    await claudeRecords.whenLoaded()
    await copilotRecords.whenLoaded()
    claudeRecords.record('/work', ID)
    copilotRecords.record('/work', OTHER)
    const { lastSessionOf } = makeStarterService()
    await expect(lastSessionOf(1, '/work', 'claude')).resolves.toEqual({
      cliKind: 'claude',
      claudeSessionId: ID
    })
    await expect(lastSessionOf(1, '/work', 'copilot')).resolves.toEqual({
      cliKind: 'copilot',
      claudeSessionId: OTHER
    })
  })

  it('ほかの種類の記録にだけある ID は返さない(copilot の依頼で claude の記録を見ない)', async () => {
    await claudeRecords.whenLoaded()
    claudeRecords.record('/work', ID)
    await expect(makeStarterService().lastSessionOf(1, '/work', 'copilot')).resolves.toBeNull()
  })

  it('依頼のフォルダの正規化が許可のフォルダと一致するときだけ、記録の先頭を返す', async () => {
    await claudeRecords.whenLoaded()
    claudeRecords.record('/work', ID)
    const { lastSessionOf } = makeStarterService()
    await expect(lastSessionOf(1, '/work/.', 'claude')).resolves.toEqual({
      cliKind: 'claude',
      claudeSessionId: ID
    })
    await expect(lastSessionOf(1, '/other', 'claude')).resolves.toBeNull()
    await expect(lastSessionOf(2, '/work', 'claude')).resolves.toBeNull()
  })

  it('Windows のフォルダのキーは小文字にそろえて引く(大文字小文字の違う表記で記録したものを引ける)', async () => {
    folderAccess.set(1, 'C:\\Work')
    canonicalize.mockImplementation(async (path: string) => path)
    await claudeRecords.whenLoaded()
    claudeRecords.record('c:\\work', ID)
    const { lastSessionOf } = makeStarterService({ platform: 'win32' })
    await expect(lastSessionOf(1, 'C:\\Work', 'claude')).resolves.toEqual({
      cliKind: 'claude',
      claudeSessionId: ID
    })
  })

  it('記録が無ければ null', async () => {
    await expect(makeStarterService().lastSessionOf(1, '/work', 'claude')).resolves.toBeNull()
  })

  it('許可のフォルダが無ければ、起動(start)と同じくフォルダを正規化せずに null', async () => {
    await claudeRecords.whenLoaded()
    claudeRecords.record('/work', ID)
    await expect(makeStarterService().lastSessionOf(2, '/work', 'claude')).resolves.toBeNull()
    expect(canonicalize).not.toHaveBeenCalled()
  })

  it('起動(start)と同じ照合の規則を使う(正規化して一致するフォルダは両方で通り、一致しないフォルダは両方で弾く)', async () => {
    await claudeRecords.whenLoaded()
    claudeRecords.record('/work', ID)
    const service = makeStarterService()
    await expect(service.lastSessionOf(1, '/work/.', 'claude')).resolves.toEqual({
      cliKind: 'claude',
      claudeSessionId: ID
    })
    await expect(
      service.start(1, { ...REQUEST, folderPath: '/work/.' }, makeSink())
    ).resolves.toMatchObject({ kind: 'started' })
    await expect(service.lastSessionOf(1, '/other', 'claude')).resolves.toBeNull()
    await expect(
      service.start(1, { ...REQUEST, slotId: 'slot-2', folderPath: '/other' }, makeSink())
    ).resolves.toEqual({ kind: 'error', error: 'folder-mismatch' })
  })

  it('記録の読み込みの完了を待ってから先頭を返す', async () => {
    const read = deferred<string>()
    claudeRecords = createAgentSessionRecordStore(makeFakeRecordIo(read.promise))
    const result = makeStarterService().lastSessionOf(1, '/work', 'claude')
    read.resolve(recordFileOf([{ key: '/work', ids: [ID] }]))
    await expect(result).resolves.toEqual({ cliKind: 'claude', claudeSessionId: ID })
  })

  it('正規化を待つ間に許可のフォルダが切り替わったら null(切り替え前のフォルダの記録を返さない)', async () => {
    await claudeRecords.whenLoaded()
    claudeRecords.record('/work', ID)
    const pending = deferred<string>()
    canonicalize.mockReturnValueOnce(pending.promise)
    const result = makeStarterService().lastSessionOf(1, '/work', 'claude')
    folderAccess.set(1, '/other')
    pending.resolve('/work')
    await expect(result).resolves.toBeNull()
  })
})

describe('createAgentSessionStarter(hooks)', () => {
  /** claude の記録の whenLoaded だけを差し替えた記録の表(ほかは本物の claudeRecords・copilotRecords に任せる) */
  const recordsWithWhenLoaded = (
    whenLoaded: () => Promise<void>
  ): AgentSessionStarterDeps['records'] => ({
    claude: {
      whenLoaded,
      has: (key, id) => claudeRecords.has(key, id),
      last: (key) => claudeRecords.last(key),
      record: (key, id) => claudeRecords.record(key, id)
    },
    copilot: copilotRecords
  })

  const PREPARED: PreparedAgentHooks = {
    ownerId: 1,
    hooks: { settingsPath: '/tmp/prompt-ide-agent-hooks-x/abc.json', token: 'ab'.repeat(32) },
    unavailableReason: null
  }

  it('prepare は resolveLaunch の後・records.whenLoaded の前に、所有者と起動の計画で呼ぶ', async () => {
    const order: string[] = []
    resolveLaunch.mockImplementation(async () => {
      order.push('resolveLaunch')
      return OK_LAUNCH
    })
    hooks.prepare.mockImplementation(async (ownerId) => {
      order.push('prepare')
      return { ownerId, hooks: null, unavailableReason: 'claude-version-unsupported' }
    })
    const start = makeStarter({
      records: recordsWithWhenLoaded(async () => {
        order.push('whenLoaded')
        await claudeRecords.whenLoaded()
      })
    })
    await start(1, REQUEST, makeSink())
    expect(order).toEqual(['resolveLaunch', 'prepare', 'whenLoaded'])
    expect(hooks.prepare).toHaveBeenCalledExactlyOnceWith(1, OK_LAUNCH.plan)
  })

  it('hooks があれば --settings <パス> を付けて起動し、spawn の成功の後に activate、終了で release(prepared, sessionId)', async () => {
    hooks = makeFakeAgentHookSessions(() => PREPARED)
    const start = makeStarter({ hooks })
    await expect(start(1, REQUEST, makeSink())).resolves.toMatchObject({ kind: 'started' })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--session-id', NEW_IDS[0], '--settings', '/tmp/prompt-ide-agent-hooks-x/abc.json'],
      expect.any(Object)
    )
    expect(hooks.activate).toHaveBeenCalledExactlyOnceWith(PREPARED, 'sid-1')
    expect(hooks.release).not.toHaveBeenCalled()
    pty.emitExit(0, 0)
    await vi.waitFor(() => expect(hooks.release).toHaveBeenCalledExactlyOnceWith(PREPARED, 'sid-1'))
    expect(hooks.calls).toEqual(['prepare', 'activate:sid-1', 'release:sid-1'])
  })

  it('hooks: null なら今までどおり 2 つの引数で起動し、activate に prepared を渡す', async () => {
    const start = makeStarter()
    await start(1, REQUEST, makeSink())
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--session-id', NEW_IDS[0]],
      expect.any(Object)
    )
    expect(hooks.activate).toHaveBeenCalledExactlyOnceWith(
      { ownerId: 1, hooks: null, unavailableReason: 'claude-version-unsupported' },
      'sid-1'
    )
  })

  it('起動の直前の確かめで取り消したら release(prepared, null) を 1 回呼び、activate しない', async () => {
    const loaded = deferred<void>()
    const start = makeStarter({ records: recordsWithWhenLoaded(() => loaded.promise) })
    const sink = makeSink()
    const pending = start(1, REQUEST, sink)
    await vi.waitFor(() => expect(hooks.prepare).toHaveBeenCalledOnce())
    sink.gone = true
    loaded.resolve()
    await expect(pending).resolves.toEqual(CANCELED)
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(
      { ownerId: 1, hooks: null, unavailableReason: 'claude-version-unsupported' },
      null
    )
    expect(hooks.activate).not.toHaveBeenCalled()
  })

  it('ID の選択の拒否(記録に無い ID の再開)で release(prepared, null) を 1 回呼ぶ', async () => {
    const start = makeStarter()
    await start(
      1,
      { ...REQUEST, launch: { kind: 'resume', claudeSessionId: NEW_IDS[4], cliKind: 'claude' } },
      makeSink()
    )
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('予約の失敗(同じ会話の二重の起動)で release(prepared, null) を 1 回呼ぶ', async () => {
    const start = makeStarter({ reservations: { tryReserve: () => null } })
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
  })

  it('spawn の失敗で release(prepared, null) を 1 回呼ぶ', async () => {
    spawnPty.mockImplementation(() => {
      throw new Error('spawn boom')
    })
    const start = makeStarter()
    await expect(start(1, REQUEST, makeSink())).resolves.toMatchObject({
      kind: 'error',
      error: 'spawn-failed'
    })
    expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
    expect(hooks.activate).not.toHaveBeenCalled()
  })

  it('activate が例外を投げても起動は started で終わり、ログに出し、終了で release(prepared, sessionId) を 1 回呼んで予約を外す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    hooks.activate.mockImplementationOnce(() => {
      throw new Error('activate boom')
    })
    const service = makeStarterService()
    await expect(service.start(1, REQUEST, makeSink())).resolves.toMatchObject({
      kind: 'started',
      sessionId: 'sid-1'
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[agentSessionStarter] hooks の結び付けに失敗しました:',
      expect.any(Error)
    )
    expect(hooks.release).not.toHaveBeenCalled()
    pty.emitExit(0, 0)
    await vi.waitFor(() =>
      expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'sid-1')
    )
    expect(service.sessionInfoOf('sid-1')).toBeUndefined()
    expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
  })

  it('終了の release が投げても予約と Map は外れ、unhandled rejection にならずにログに出す(L-010)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      hooks.release.mockImplementationOnce(() => {
        throw new Error('release boom')
      })
      const service = makeStarterService()
      await service.start(1, REQUEST, makeSink())
      pty.emitExit(0, 0)
      await vi.waitFor(() =>
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[agentSessionStarter] 終了の後始末(hooks)に失敗しました:',
          expect.any(Error)
        )
      )
      expect(service.sessionInfoOf('sid-1')).toBeUndefined()
      expect(reservations.tryReserve(NEW_IDS[0])).not.toBeNull()
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('終了の予約を外す段が投げても、後ろの hooks.release は呼ばれ、unhandled rejection にならずにログに出す', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const service = makeStarterService({
        reservations: {
          tryReserve: () => () => {
            throw new Error('reservation boom')
          }
        }
      })
      await service.start(1, REQUEST, makeSink())
      pty.emitExit(0, 0)
      await vi.waitFor(() =>
        expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'sid-1')
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[agentSessionStarter] 終了の後始末(予約)に失敗しました:',
        expect.any(Error)
      )
      // 前の段(Map)は先に外れている
      expect(service.sessionInfoOf('sid-1')).toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it.each<[string, Partial<AgentSessionStarterDeps>]>([
    [
      'records.whenLoaded() の reject',
      {
        records: {
          claude: {
            whenLoaded: async () => Promise.reject(new Error('load failed')),
            has: () => false,
            last: () => null,
            record: () => undefined
          },
          copilot: {
            whenLoaded: async () => undefined,
            has: () => false,
            last: () => null,
            record: () => undefined
          }
        }
      }
    ],
    [
      'createSessionId の例外',
      {
        createSessionId: () => {
          throw new Error('id failed')
        }
      }
    ],
    [
      'selectClaudeSessionId の例外(新しい ID の採番の失敗)',
      {
        createClaudeSessionId: () => {
          throw new Error('uuid failed')
        }
      }
    ]
  ])(
    '%s で起動が例外で終わったら release(prepared, null) を 1 回呼ぶ',
    async (_label, overrides) => {
      const start = makeStarter(overrides)
      await expect(start(1, REQUEST, makeSink())).rejects.toThrow()
      expect(hooks.release).toHaveBeenCalledExactlyOnceWith(expect.any(Object), null)
      expect(hooks.activate).not.toHaveBeenCalled()
    }
  )

  it('claude が見つからなければ prepare しない', async () => {
    resolveLaunch.mockResolvedValueOnce({
      kind: 'not-found',
      cliKind: 'claude',
      shellPathUnavailable: false
    })
    await makeStarter()(1, REQUEST, makeSink())
    expect(hooks.prepare).not.toHaveBeenCalled()
  })

  it('作業ディレクトリが無ければ prepare しない', async () => {
    isDirectory.mockResolvedValueOnce(false)
    await makeStarter()(1, REQUEST, makeSink())
    expect(hooks.prepare).not.toHaveBeenCalled()
  })
})

describe('createAgentSessionStarter(CLI の種類)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  const OTHER = '22222222-2222-4222-9222-222222222222'
  const COPILOT_LAUNCH: AgentLaunchResolution = {
    kind: 'ok',
    plan: { cliKind: 'copilot', file: '/bin/copilot', args: [], env: { PATH: '/p' } }
  }
  const copilotResume = (claudeSessionId: string, slotId = 'slot-1'): AgentStartRequest => ({
    ...REQUEST,
    slotId,
    launch: { kind: 'resume', claudeSessionId, cliKind: 'copilot' }
  })

  beforeEach(async () => {
    resolveLaunch.mockResolvedValue(COPILOT_LAUNCH)
    await claudeRecords.whenLoaded()
    await copilotRecords.whenLoaded()
  })

  it('copilot の new は会話の ID を振って --session-id <ID> で起動し、予約し、copilot の記録だけに書き、結果に copilot と ID を載せる', async () => {
    const claudeRecordSpy = vi.spyOn(claudeRecords, 'record')
    const reserveSpy = vi.spyOn(reservations, 'tryReserve')
    const { start, sessionInfoOf } = makeStarterService()
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', ['--session-id', NEW_IDS[0]], {
      name: 'xterm-256color',
      cols: 90,
      rows: 20,
      cwd: '/work',
      env: { PATH: '/p' }
    })
    expect(reserveSpy).toHaveBeenCalledExactlyOnceWith(NEW_IDS[0])
    expect(copilotRecords.last('/work')).toBe(NEW_IDS[0])
    expect(claudeRecordSpy).not.toHaveBeenCalled()
    expect(claudeRecords.last('/work')).toBeNull()
    expect(sessionInfoOf('sid-1')).toEqual({ cliKind: 'copilot', claudeSessionId: NEW_IDS[0] })
  })

  it('copilot の resume は copilot の記録にある ID を --resume=<ID>(1 つの引数)で起動し、記録の先頭へ移す(新しく振らない)', async () => {
    copilotRecords.record('/work', ID)
    copilotRecords.record('/work', OTHER)
    await expect(makeStarter()(1, copilotResume(ID), makeSink())).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: ID
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/copilot', [`--resume=${ID}`], expect.any(Object))
    expect(copilotRecords.last('/work')).toBe(ID)
    expect(claudeIdCount).toBe(0)
  })

  it('claude の記録にだけある ID の copilot の再開は unknown-session で、spawn しない(claude の ID を copilot で再開する経路は無い)', async () => {
    claudeRecords.record('/work', ID)
    await expect(makeStarter()(1, copilotResume(ID), makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'unknown-session'
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('同じ ID の copilot の再開を 2 つ起動すると、2 つ目は session-in-use', async () => {
    copilotRecords.record('/work', ID)
    let count = 0
    spawnPty.mockImplementation(() => makeFakePty())
    const { start } = makeStarterService({ createSessionId: () => `sid-${++count}` })
    await expect(start(1, copilotResume(ID), makeSink())).resolves.toMatchObject({
      kind: 'started'
    })
    await expect(start(1, copilotResume(ID, 'slot-2'), makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
  })

  it('claude で動いている ID の copilot の再開は session-in-use(種類をまたいで共有の予約)', async () => {
    claudeRecords.record('/work', ID)
    copilotRecords.record('/work', ID)
    let count = 0
    spawnPty.mockImplementation(() => makeFakePty())
    resolveLaunch.mockResolvedValueOnce(OK_LAUNCH)
    const { start } = makeStarterService({ createSessionId: () => `sid-${++count}` })
    await expect(
      start(
        1,
        { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' } },
        makeSink()
      )
    ).resolves.toMatchObject({ kind: 'started', cliKind: 'claude', claudeSessionId: ID })
    await expect(start(1, copilotResume(ID, 'slot-2'), makeSink())).resolves.toEqual({
      kind: 'error',
      error: 'session-in-use'
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('copilot の already-running は、動いているセッションの種類と ID を返す', async () => {
    const start = makeStarter()
    await start(1, REQUEST, makeSink())
    await expect(start(1, REQUEST, makeSink())).resolves.toEqual({
      kind: 'already-running',
      sessionId: 'sid-1',
      cliKind: 'copilot',
      claudeSessionId: NEW_IDS[0]
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('copilot のセッションも hooks を prepare・activate し、exited で sessionInfoOf から消えて release(prepared, sessionId) を 1 回呼ぶ', async () => {
    const { start, sessionInfoOf } = makeStarterService()
    await start(1, REQUEST, makeSink())
    expect(hooks.calls).toEqual(['prepare', 'activate:sid-1'])
    pty.emitExit(0)
    await vi.waitFor(() => expect(sessionInfoOf('sid-1')).toBeUndefined())
    await vi.waitFor(() =>
      expect(hooks.calls).toEqual(['prepare', 'activate:sid-1', 'release:sid-1'])
    )
  })

  it('hooks が設定のファイルを返しても(copilot では本来返さない)、copilot の引数には --settings を足さない', async () => {
    hooks = makeFakeAgentHookSessions((ownerId) => ({
      ownerId,
      hooks: { settingsPath: '/tmp/prompt-ide-agent-hooks-x/abc.json', token: 'ab'.repeat(32) },
      unavailableReason: null
    }))
    await makeStarter({ hooks })(1, REQUEST, makeSink())
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/copilot',
      ['--session-id', NEW_IDS[0]],
      expect.any(Object)
    )
  })

  it('lastSessionOf は copilot の依頼に copilot の記録の先頭を種類付きで返す', async () => {
    copilotRecords.record('/work', ID)
    await expect(makeStarterService().lastSessionOf(1, '/work', 'copilot')).resolves.toEqual({
      cliKind: 'copilot',
      claudeSessionId: ID
    })
  })

  it('copilot の計画で起動したセッションの中断は、2 回目の案内(afterMs: 100)を返す(starter が計画の種類の送り方を渡す。L-018)', async () => {
    await makeStarter()(1, REQUEST, makeSink())
    expect(registry.interrupt(1, 'sid-1')).toEqual({ kind: 'sent', followUp: { afterMs: 100 } })
  })

  it('claude の計画で起動したセッションの中断は、2 回目の案内が null(今までどおり 1 回)', async () => {
    resolveLaunch.mockResolvedValue(OK_LAUNCH)
    await makeStarter()(1, REQUEST, makeSink())
    expect(registry.interrupt(1, 'sid-1')).toEqual({ kind: 'sent', followUp: null })
  })
})

describe('createAgentSessionStarter(種類ごとの起動の記録と種類の照らし合わせ)', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  beforeEach(async () => {
    await claudeRecords.whenLoaded()
    await copilotRecords.whenLoaded()
  })

  it('resume の依頼の種類が起動の計画の種類と違えば resume-cli-mismatch で断り、hooks の準備・記録の読み込み・spawn をしない(L-018)', async () => {
    claudeRecords.record('/work', ID)
    const claudeWhenLoaded = vi.fn(() => claudeRecords.whenLoaded())
    const copilotWhenLoaded = vi.fn(() => copilotRecords.whenLoaded())
    const start = makeStarter({
      records: {
        claude: {
          whenLoaded: claudeWhenLoaded,
          has: (key, id) => claudeRecords.has(key, id),
          last: (key) => claudeRecords.last(key),
          record: (key, id) => claudeRecords.record(key, id)
        },
        copilot: {
          whenLoaded: copilotWhenLoaded,
          has: (key, id) => copilotRecords.has(key, id),
          last: (key) => copilotRecords.last(key),
          record: (key, id) => copilotRecords.record(key, id)
        }
      }
    })
    await expect(
      start(
        1,
        { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'copilot' } },
        makeSink()
      )
    ).resolves.toEqual({ kind: 'error', error: 'resume-cli-mismatch' })
    expect(hooks.prepare).not.toHaveBeenCalled()
    expect(claudeWhenLoaded).not.toHaveBeenCalled()
    expect(copilotWhenLoaded).not.toHaveBeenCalled()
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('resume の依頼の種類が計画の種類と同じなら起動する(照らし合わせは依頼の種類で起動の種類を変えない)', async () => {
    claudeRecords.record('/work', ID)
    await expect(
      makeStarter()(
        1,
        { ...REQUEST, launch: { kind: 'resume', claudeSessionId: ID, cliKind: 'claude' } },
        makeSink()
      )
    ).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      cliKind: 'claude',
      claudeSessionId: ID
    })
    expect(spawnPty).toHaveBeenCalledWith(
      '/bin/claude',
      ['--x', '--resume', ID],
      expect.any(Object)
    )
  })

  it('claude の起動は claude の記録だけに書き、copilot の記録に触れない', async () => {
    const copilotRecordSpy = vi.spyOn(copilotRecords, 'record')
    const copilotHasSpy = vi.spyOn(copilotRecords, 'has')
    await expect(makeStarter()(1, REQUEST, makeSink())).resolves.toMatchObject({
      kind: 'started',
      claudeSessionId: NEW_IDS[0]
    })
    expect(claudeRecords.last('/work')).toBe(NEW_IDS[0])
    expect(copilotRecords.last('/work')).toBeNull()
    expect(copilotRecordSpy).not.toHaveBeenCalled()
    expect(copilotHasSpy).not.toHaveBeenCalled()
  })

  it.each<[string, () => Promise<string>]>([
    ['読み込みが終わらない', () => new Promise<string>(() => undefined)],
    [
      '読み込みが失敗する',
      async () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
    ]
  ])(
    'copilot の記録の%sときも、claude の起動と記録は今と同じ(別のファイル・別の store。L-002・L-006)',
    async (_label, read) => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      copilotRecords = createAgentSessionRecordStore({
        read: vi.fn(read),
        write: vi.fn(async () => undefined)
      })
      await expect(makeStarter()(1, REQUEST, makeSink())).resolves.toEqual({
        kind: 'started',
        sessionId: 'sid-1',
        cliKind: 'claude',
        claudeSessionId: NEW_IDS[0]
      })
      expect(claudeRecords.last('/work')).toBe(NEW_IDS[0])
    }
  )
})
