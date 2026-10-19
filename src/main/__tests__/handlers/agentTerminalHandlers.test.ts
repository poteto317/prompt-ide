import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import { resolve as resolvePath } from 'node:path'

const mockRealpath = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath, stat: mockStat },
  realpath: mockRealpath,
  stat: mockStat
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { AgentSessionRegistry } from '../../agentSessionRegistry'
import { AGENT_START_CANCELED_DETAIL } from '@shared/types'
import type { AgentStartResult } from '@shared/types'
import { registerAgentTerminalHandlers } from '../../handlers/agentTerminalHandlers'
import type { AgentTerminalHandlerDeps } from '../../handlers/agentTerminalHandlers'
import { createAgentSessionStarter } from '../../agentSessionStarter'
import type { AgentSessionStarter } from '../../agentSessionStarter'
import { AGENT_INTERRUPT_SEQUENCE } from '../../agentSession'
import type { PtySpawn, StopTree } from '../../agentSession'
import type { AgentLaunchResolution } from '../../agentCommand'
import { makeFakePty } from '../helpers/fakePty'
import type { FakePty } from '../helpers/fakePty'
import { createAgentSessionRecordStore } from '../../agentSessionRecordStore'
import type { AgentSessionRecordStore } from '../../agentSessionRecordStore'
import { makeFakeRecordIo } from '../helpers/fakeAgentSessionRecordIo'
import { makeFakeAgentHookSessions } from '../helpers/fakeAgentHookSessions'
import { createClaudeSessionReservations } from '../../claudeSessionReservations'

const NEW = { kind: 'new' } as const
const CLAUDE_ID = '11111111-1111-4111-8111-111111111111'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const listeners = new Map<string, Listener>()
const ipcMain = {
  handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener)),
  on: vi.fn((channel: string, listener: Listener) => listeners.set(channel, listener))
}

interface FakeSender {
  id: number
  send: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  setIgnoreMenuShortcuts: ReturnType<typeof vi.fn>
}

function makeEvent(id = 1, main = true): { sender: FakeSender; senderFrame: { parent: unknown } } {
  return {
    sender: { id, send: vi.fn(), isDestroyed: vi.fn(() => false), setIgnoreMenuShortcuts: vi.fn() },
    senderFrame: { parent: main ? null : {} }
  }
}

let folderAccess: FolderAccessManager
let registry: AgentSessionRegistry
let pty: FakePty
let spawnPty: ReturnType<typeof vi.fn<PtySpawn>>
let resolveLaunch: ReturnType<typeof vi.fn<() => Promise<AgentLaunchResolution>>>
let records: AgentSessionRecordStore
const stopTree = vi.fn<StopTree>(async (target, exited) => {
  ;(target as FakePty).emitExit(0, 15)
  await exited
})

// 起動の規則の本体のテストは agentSessionStarter.test.ts。ここでは実物の starter(既定の realpath・stat。node:fs/promises は
// 上で差し替え)を渡し、IPC の受け口を通した起動を統合として確かめる(受け口だけの確認は下の「委譲」の describe)
function register(overrides: Partial<AgentTerminalHandlerDeps> = {}): void {
  const starter = createAgentSessionStarter({
    folderAccess,
    registry,
    resolveLaunch,
    spawnPty,
    stopTree,
    createSessionId: () => 'sid-1',
    records,
    reservations: createClaudeSessionReservations(),
    createClaudeSessionId: () => CLAUDE_ID,
    platform: 'linux',
    hooks: makeFakeAgentHookSessions()
  })
  registerAgentTerminalHandlers(ipcMain as never, {
    registry,
    startSession: starter.start,
    claudeSessionIdOf: starter.claudeSessionIdOf,
    getLastSession: starter.lastSessionOf,
    platform: 'linux',
    reportWorking: vi.fn(),
    reportWorkingEnded: vi.fn(),
    ...overrides
  })
}

const start = (event: ReturnType<typeof makeEvent>, payload: unknown): Promise<unknown> =>
  handles.get('agentTerminal:start')?.(event, payload) as Promise<unknown>

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const CANCELED = { kind: 'error', error: 'spawn-failed', detail: AGENT_START_CANCELED_DETAIL }

beforeEach(() => {
  handles.clear()
  listeners.clear()
  vi.clearAllMocks()
  mockRealpath.mockImplementation((p: string) => Promise.resolve(resolvePath(p)))
  mockStat.mockResolvedValue({ isDirectory: () => true })
  folderAccess = new FolderAccessManager()
  registry = new AgentSessionRegistry()
  pty = makeFakePty(4242)
  spawnPty = vi.fn<PtySpawn>().mockReturnValue(pty)
  resolveLaunch = vi.fn(async () => ({
    kind: 'ok' as const,
    plan: { file: '/bin/claude', args: [], env: { PATH: '/p' } }
  }))
  // 記録のファイルが無い(空の記録)
  records = createAgentSessionRecordStore(makeFakeRecordIo())
})

describe('agentTerminal:start', () => {
  it('許可のフォルダを作業ディレクトリに、main が決めたコマンドで起動し、started を返す', async () => {
    register()
    folderAccess.set(1, '/work')
    // renderer の文字列(realpath が許可と一致する別の表記)ではなく、許可のフォルダを作業ディレクトリにする
    await expect(
      start(makeEvent(), {
        slotId: 'slot-1',
        folderPath: '/work/.',
        cols: 90,
        rows: 20,
        launch: NEW
      })
    ).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: CLAUDE_ID
    })
    expect(spawnPty).toHaveBeenCalledWith('/bin/claude', ['--session-id', CLAUDE_ID], {
      name: 'xterm-256color',
      cols: 90,
      rows: 20,
      cwd: '/work',
      env: { PATH: '/p' }
    })
  })

  it('許可のフォルダが無ければ no-folder', async () => {
    register()
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    ).resolves.toEqual({
      kind: 'error',
      error: 'no-folder'
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('renderer のフォルダの realpath が許可と違えば folder-mismatch', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(
      start(makeEvent(), {
        slotId: 'slot-1',
        folderPath: '/other',
        cols: 90,
        rows: 20,
        launch: NEW
      })
    ).resolves.toEqual({
      kind: 'error',
      error: 'folder-mismatch'
    })
  })

  it('フォルダが無くなっていれば folder-missing(パスを添える)', async () => {
    register()
    folderAccess.set(1, '/work')
    mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    ).resolves.toEqual({
      kind: 'error',
      error: 'folder-missing',
      detail: '/work'
    })
  })

  it('claude が見つからなければ command-not-found(PATH の取得の失敗を添える)', async () => {
    register()
    folderAccess.set(1, '/work')
    resolveLaunch.mockResolvedValueOnce({ kind: 'not-found', shellPathUnavailable: true })
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    ).resolves.toEqual({
      kind: 'error',
      error: 'command-not-found',
      shellPathUnavailable: true
    })
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('spawn が投げたら spawn-failed(例外の文言を添える)', async () => {
    register()
    folderAccess.set(1, '/work')
    spawnPty.mockImplementationOnce(() => {
      throw new Error('posix_spawnp failed.')
    })
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    ).resolves.toEqual({
      kind: 'error',
      error: 'spawn-failed',
      detail: 'posix_spawnp failed.'
    })
  })

  it('同じ枠(タブ)への 2 回目の依頼は起動せず already-running', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    await expect(
      start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    ).resolves.toEqual({
      kind: 'already-running',
      sessionId: 'sid-1',
      claudeSessionId: CLAUDE_ID
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('不正な入力・サブフレームからの依頼は投げる', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 0, rows: 20, launch: NEW })
    ).rejects.toThrow()
    await expect(
      start(makeEvent(1, false), {
        slotId: 'slot-1',
        folderPath: '/work',
        cols: 90,
        rows: 20,
        launch: NEW
      })
    ).rejects.toThrow()
  })

  it('出力と終了を送信元へ送り、破棄済みなら送らない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    pty.emitData('hi')
    expect(event.sender.send).toHaveBeenCalledWith('agentTerminal:data', {
      sessionId: 'sid-1',
      data: 'hi'
    })
    event.sender.isDestroyed.mockReturnValue(true)
    pty.emitData('late')
    pty.emitExit(0)
    expect(event.sender.send).toHaveBeenCalledTimes(1)
  })

  it('終了は exitCode・signal・reason を送る', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    pty.emitExit(1)
    expect(event.sender.send).toHaveBeenCalledWith('agentTerminal:exit', {
      sessionId: 'sid-1',
      exitCode: 1,
      signal: null,
      reason: 'exited'
    })
  })

  it('送信元の send が投げても(破棄の競合)、出力・終了の通知は例外を投げない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    event.sender.send.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    expect(() => pty.emitData('x')).not.toThrow()
    expect(() => pty.emitExit(0)).not.toThrow()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([])
  })

  it('isDestroyed が投げても、出力・終了の通知は例外を投げず送らない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    event.sender.isDestroyed.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    expect(() => pty.emitData('x')).not.toThrow()
    expect(() => pty.emitExit(0)).not.toThrow()
    expect(event.sender.send).not.toHaveBeenCalled()
  })

  it('破棄済みの送信元への停止の通知でも、stop は例外なく解決する', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    event.sender.isDestroyed.mockReturnValue(true)
    event.sender.send.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    await expect(registry.stopOwner(1, 'stopped')).resolves.toBeUndefined()
    expect(event.sender.send).not.toHaveBeenCalled()
  })

  it('realpath を待つ間にウィンドウが破棄されたら起動しない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    const pending = deferred<string>()
    mockRealpath.mockReturnValueOnce(pending.promise)
    const result = start(event, {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    // ウィンドウの破棄(agentSessionLifecycle は registry.stopOwner を呼ぶ。セッションが無いので世代だけ進む)
    event.sender.isDestroyed.mockReturnValue(true)
    await registry.stopOwner(1, 'stopped')
    pending.resolve('/work')
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('realpath を待つ間にフォルダが切り替わったら起動しない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    const pending = deferred<string>()
    mockRealpath.mockReturnValueOnce(pending.promise)
    const result = start(event, {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    folderAccess.set(1, '/other')
    await registry.stopOwner(1, 'folder-changed')
    pending.resolve('/work')
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('起動のコマンドを探す間にウィンドウが破棄されたら起動しない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const result = start(event, {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    event.sender.isDestroyed.mockReturnValue(true)
    pending.resolve({ kind: 'ok', plan: { file: '/bin/claude', args: [], env: { PATH: '/p' } } })
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('起動のコマンドを探す間にフォルダが切り替わったら起動しない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const result = start(event, {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    folderAccess.set(1, '/other')
    pending.resolve({ kind: 'ok', plan: { file: '/bin/claude', args: [], env: { PATH: '/p' } } })
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('realpath を待つ間にリロード(stop だけ。破棄もフォルダの切り替えも無い)が来たら起動しない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    const pending = deferred<string>()
    mockRealpath.mockReturnValueOnce(pending.promise)
    const result = start(event, {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    await registry.stopOwner(1, 'stopped')
    pending.resolve('/work')
    await expect(result).resolves.toEqual(CANCELED)
    expect(spawnPty).not.toHaveBeenCalled()
    expect(registry.snapshot(1)).toEqual([])
  })

  it('起動のコマンドを探す間にリロード(stop だけ)が来たら起動しない', async () => {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    const pending = deferred<AgentLaunchResolution>()
    resolveLaunch.mockReturnValueOnce(pending.promise)
    const result = start(event, {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    await vi.waitFor(() => expect(resolveLaunch).toHaveBeenCalledOnce())
    const stopped = registry.stopOwner(1, 'stopped')
    pending.resolve({ kind: 'ok', plan: { file: '/bin/claude', args: [], env: { PATH: '/p' } } })
    await expect(result).resolves.toEqual(CANCELED)
    await stopped
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('リロードの後に届いた新しい依頼は起動する', async () => {
    register()
    folderAccess.set(1, '/work')
    await registry.stopOwner(1, 'stopped')
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    ).resolves.toEqual({
      kind: 'started',
      sessionId: 'sid-1',
      claudeSessionId: CLAUDE_ID
    })
    expect(spawnPty).toHaveBeenCalledOnce()
  })

  it('ウィンドウごとに別の許可のフォルダで判定する', async () => {
    register()
    folderAccess.set(1, '/work')
    folderAccess.set(2, '/other')
    await expect(
      start(makeEvent(2), {
        slotId: 'slot-1',
        folderPath: '/work',
        cols: 90,
        rows: 20,
        launch: NEW
      })
    ).resolves.toEqual({ kind: 'error', error: 'folder-mismatch' })
    expect(spawnPty).not.toHaveBeenCalled()
  })
})

describe('agentTerminal:start(受け口: 送信元の確認・検証・sink の組み立て・委譲)', () => {
  const STARTED: AgentStartResult = {
    kind: 'started',
    sessionId: 'sid-x',
    claudeSessionId: CLAUDE_ID
  }
  let startSession: ReturnType<typeof vi.fn<AgentSessionStarter>>

  beforeEach(() => {
    startSession = vi.fn<AgentSessionStarter>(async () => STARTED)
    register({ startSession })
  })

  const sinkOf = (): Parameters<AgentSessionStarter>[2] => startSession.mock.calls[0][2]

  it('送信元の id と検証済みの依頼を starter に渡し、結果をそのまま返す', async () => {
    await expect(
      start(makeEvent(7), {
        slotId: 'slot-1',
        folderPath: '/work',
        cols: 90,
        rows: 20,
        launch: NEW
      })
    ).resolves.toBe(STARTED)
    expect(startSession).toHaveBeenCalledExactlyOnceWith(
      7,
      { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW },
      expect.any(Object)
    )
  })

  // starter は最初の await より前に停止の世代を控える。受け口が先に await を挟むと、その間に届いた停止を見分けられない
  it('await を挟まずに(依頼を受けた同じ同期の処理の中で) starter を呼ぶ', () => {
    void start(makeEvent(), {
      slotId: 'slot-1',
      folderPath: '/work',
      cols: 90,
      rows: 20,
      launch: NEW
    })
    expect(startSession).toHaveBeenCalledOnce()
  })

  it('sink: isGone は送信元の破棄、出力・終了は送信元の agentTerminal:data・exit へ送る(破棄済みなら送らない)', async () => {
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    const sink = sinkOf()
    expect(sink.isGone()).toBe(false)
    sink.onData({ sessionId: 's', data: 'hi' })
    sink.onExit({ sessionId: 's', exitCode: 0, signal: null, reason: 'exited' })
    expect(event.sender.send.mock.calls).toEqual([
      ['agentTerminal:data', { sessionId: 's', data: 'hi' }],
      ['agentTerminal:exit', { sessionId: 's', exitCode: 0, signal: null, reason: 'exited' }]
    ])
    event.sender.isDestroyed.mockReturnValue(true)
    expect(sink.isGone()).toBe(true)
    sink.onData({ sessionId: 's', data: 'late' })
    expect(event.sender.send).toHaveBeenCalledTimes(2)
  })

  it('sink: isDestroyed が投げたら破棄済みとして扱う', async () => {
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    event.sender.isDestroyed.mockImplementation(() => {
      throw new Error('Object has been destroyed')
    })
    expect(sinkOf().isGone()).toBe(true)
  })

  it('不正な入力・サブフレームからの依頼は starter を呼ばずに投げる', async () => {
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 0, rows: 20, launch: NEW })
    ).rejects.toThrow()
    await expect(start(makeEvent(), { cols: 90, rows: 20, launch: NEW })).rejects.toThrow()
    await expect(
      start(makeEvent(1, false), {
        slotId: 'slot-1',
        folderPath: '/work',
        cols: 90,
        rows: 20,
        launch: NEW
      })
    ).rejects.toThrow()
    await expect(
      start(makeEvent(), { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20 })
    ).rejects.toThrow()
    expect(startSession).not.toHaveBeenCalled()
  })
})

describe('agentTerminal:write・resize・stop・getState', () => {
  async function started(): Promise<ReturnType<typeof makeEvent>> {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    return event
  }

  it('write は検証を通った書き込みだけを渡す', async () => {
    const event = await started()
    listeners.get('agentTerminal:write')?.(event, 'sid-1', 'abc')
    listeners.get('agentTerminal:write')?.(event, 'sid-1', 123)
    listeners.get('agentTerminal:write')?.(event, 'stale', 'x')
    listeners.get('agentTerminal:write')?.(makeEvent(1, false), 'sid-1', 'sub')
    expect(pty.write.mock.calls).toEqual([['abc']])
  })

  it('resize は範囲内の整数だけを渡す', async () => {
    const event = await started()
    listeners.get('agentTerminal:resize')?.(event, 'sid-1', 100, 30)
    listeners.get('agentTerminal:resize')?.(event, 'sid-1', 9999, 30)
    expect(pty.resize.mock.calls).toEqual([[100, 30]])
  })

  it('getState は枠ごとの一覧を返し、stop は止め終わってから解決して一覧から消す', async () => {
    const event = await started()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([
      { slotId: 'slot-1', sessionId: 'sid-1', claudeSessionId: CLAUDE_ID }
    ])
    await handles.get('agentTerminal:stop')?.(event, 'sid-1')
    expect(stopTree).toHaveBeenCalledOnce()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([])
    expect(event.sender.send).toHaveBeenCalledWith('agentTerminal:exit', {
      sessionId: 'sid-1',
      exitCode: 0,
      signal: 15,
      reason: 'stopped'
    })
  })

  it('別のウィンドウからは、他のウィンドウのセッションに書き込めず、リサイズ・停止・状態の取得もできない', async () => {
    const event = await started()
    const other = makeEvent(2)
    listeners.get('agentTerminal:write')?.(other, 'sid-1', 'evil')
    listeners.get('agentTerminal:resize')?.(other, 'sid-1', 100, 30)
    await handles.get('agentTerminal:stop')?.(other, 'sid-1')
    expect(handles.get('agentTerminal:getState')?.(other)).toEqual([])
    expect(pty.write).not.toHaveBeenCalled()
    expect(pty.resize).not.toHaveBeenCalled()
    expect(stopTree).not.toHaveBeenCalled()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([
      { slotId: 'slot-1', sessionId: 'sid-1', claudeSessionId: CLAUDE_ID }
    ])
  })

  it('上限を超える書き込みは捨てる', async () => {
    const event = await started()
    listeners.get('agentTerminal:write')?.(event, 'sid-1', 'a'.repeat(1_000_001))
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('サブフレームからの resize は捨て、stop・getState は投げる', async () => {
    const event = await started()
    const sub = makeEvent(1, false)
    listeners.get('agentTerminal:resize')?.(sub, 'sid-1', 100, 30)
    expect(pty.resize).not.toHaveBeenCalled()
    await expect(handles.get('agentTerminal:stop')?.(sub, 'sid-1')).rejects.toThrow()
    expect(() => handles.get('agentTerminal:getState')?.(sub)).toThrow()
    expect(stopTree).not.toHaveBeenCalled()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([
      { slotId: 'slot-1', sessionId: 'sid-1', claudeSessionId: CLAUDE_ID }
    ])
  })

  it('stop の sessionId が不正なら投げ、別の sessionId なら止めない', async () => {
    const event = await started()
    await expect(handles.get('agentTerminal:stop')?.(event, 1)).rejects.toThrow()
    await handles.get('agentTerminal:stop')?.(event, 'stale')
    expect(stopTree).not.toHaveBeenCalled()
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([
      { slotId: 'slot-1', sessionId: 'sid-1', claudeSessionId: CLAUDE_ID }
    ])
  })
})

describe('agentTerminal:interrupt', () => {
  async function started(): Promise<ReturnType<typeof makeEvent>> {
    register()
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    return event
  }
  const interrupt = (event: ReturnType<typeof makeEvent>, ...args: unknown[]): unknown =>
    handles.get('agentTerminal:interrupt')?.(event, ...args)

  it('今のセッションへ固定の 1 バイトを書いて sent を返す。余分な引数を渡しても書くバイト列は変わらない(L-019)', async () => {
    const event = await started()
    expect(interrupt(event, 'sid-1', 'evil', '\x03')).toEqual({ kind: 'sent' })
    expect(pty.write.mock.calls).toEqual([[AGENT_INTERRUPT_SEQUENCE]])
  })

  it('別の sessionId・別のウィンドウからは書かず no-session を返す', async () => {
    const event = await started()
    expect(interrupt(event, 'stale')).toEqual({ kind: 'no-session' })
    expect(interrupt(makeEvent(2), 'sid-1')).toEqual({ kind: 'no-session' })
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('サブフレームからの依頼・空や文字列でない sessionId は投げて書かない', async () => {
    await started()
    expect(() => interrupt(makeEvent(1, false), 'sid-1')).toThrow()
    expect(() => interrupt(makeEvent(), '')).toThrow()
    expect(() => interrupt(makeEvent(), 1)).toThrow()
    expect(pty.write).not.toHaveBeenCalled()
  })

  it('registry.interrupt に送信元の id と sessionId だけを渡し、結果をそのまま返す', () => {
    const registryInterrupt = vi.fn<AgentSessionRegistry['interrupt']>(() => ({
      kind: 'write-failed'
    }))
    const fakeRegistry: AgentTerminalHandlerDeps['registry'] = {
      write: vi.fn(),
      resize: vi.fn(),
      stop: vi.fn(async () => undefined),
      snapshot: vi.fn(() => []),
      interrupt: registryInterrupt
    }
    register({ registry: fakeRegistry })
    expect(interrupt(makeEvent(7), 'sid-x', 'extra')).toEqual({ kind: 'write-failed' })
    expect(registryInterrupt).toHaveBeenCalledExactlyOnceWith(7, 'sid-x')
  })
})

describe('agentTerminal:focus', () => {
  it('Windows・Linux ではメニューのショートカットを止める・戻す', () => {
    register({ platform: 'win32' })
    const event = makeEvent()
    listeners.get('agentTerminal:focus')?.(event, true)
    listeners.get('agentTerminal:focus')?.(event, false)
    listeners.get('agentTerminal:focus')?.(event, 'yes')
    expect(event.sender.setIgnoreMenuShortcuts.mock.calls).toEqual([[true], [false]])
  })

  it('macOS では変えない', () => {
    register({ platform: 'darwin' })
    const event = makeEvent()
    listeners.get('agentTerminal:focus')?.(event, true)
    expect(event.sender.setIgnoreMenuShortcuts).not.toHaveBeenCalled()
  })

  it('サブフレームからは変えない', () => {
    register({ platform: 'linux' })
    const event = makeEvent(1, false)
    listeners.get('agentTerminal:focus')?.(event, true)
    expect(event.sender.setIgnoreMenuShortcuts).not.toHaveBeenCalled()
  })
})

describe('agentTerminal:getLastSession', () => {
  const getLast = (event: ReturnType<typeof makeEvent>, folderPath: unknown): Promise<unknown> =>
    handles.get('agentTerminal:getLastSession')?.(event, folderPath) as Promise<unknown>

  it('許可のフォルダ(realpath が一致)のときだけ記録の先頭を返す', async () => {
    register()
    folderAccess.set(1, '/work')
    await records.whenLoaded()
    records.record('/work', CLAUDE_ID)
    await expect(getLast(makeEvent(), '/work/.')).resolves.toEqual({ claudeSessionId: CLAUDE_ID })
    await expect(getLast(makeEvent(), '/other')).resolves.toBeNull()
    // 別のウィンドウ(許可のフォルダが無い)
    await expect(getLast(makeEvent(2), '/work')).resolves.toBeNull()
  })

  it('記録が無ければ null', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(getLast(makeEvent(), '/work')).resolves.toBeNull()
  })

  it('不正な folderPath・サブフレームからの依頼は投げる', async () => {
    register()
    folderAccess.set(1, '/work')
    await expect(getLast(makeEvent(), '')).rejects.toThrow()
    await expect(getLast(makeEvent(), 1)).rejects.toThrow()
    await expect(getLast(makeEvent(1, false), '/work')).rejects.toThrow()
  })
})

describe('agentTerminal:getState(claude のセッション ID)', () => {
  let consoleWarnSpy: MockInstance<typeof console.warn> | null = null

  afterEach(() => {
    consoleWarnSpy?.mockRestore()
    consoleWarnSpy = null
  })

  it('starter の Map に無いセッションは、例外にせず一覧から外してログを残す(合わせ込みの全体を止めない)', async () => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    register({ claudeSessionIdOf: () => undefined })
    folderAccess.set(1, '/work')
    const event = makeEvent()
    await start(event, { slotId: 'slot-1', folderPath: '/work', cols: 90, rows: 20, launch: NEW })
    expect(handles.get('agentTerminal:getState')?.(event)).toEqual([])
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[agentTerminal:getState] claude のセッション ID が見つからないセッションを一覧から外します:',
      'sid-1'
    )
  })
})

// 作業中・作業の終わりの知らせは、同じ検査(送信元・sessionId)を通って追跡の別の関数へ渡る
describe.each<[string, 'reportWorking' | 'reportWorkingEnded', string]>([
  ['agentTerminal:reportWorking', 'reportWorking', '作業中の知らせ'],
  ['agentTerminal:reportWorkingEnded', 'reportWorkingEnded', '作業の終わりの知らせ']
])('%s', (channel, depName, label) => {
  let warnSpy: MockInstance<typeof console.warn>
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  /** 追跡の関数の偽物を depName に渡して handler を登録する */
  const registerReport = (): Mock<(ownerId: number, sessionId: string) => void> => {
    const report = vi.fn<(ownerId: number, sessionId: string) => void>()
    register({ [depName]: report })
    return report
  }

  it('メインフレームからの sessionId を、送信元のウィンドウの id と一緒に追跡へ渡す', () => {
    const report = registerReport()
    listeners.get(channel)?.(makeEvent(3), 'sid-9')
    expect(report).toHaveBeenCalledExactlyOnceWith(3, 'sid-9')
  })

  it.each<[string, unknown]>([
    ['空文字', ''],
    ['数値', 123],
    ['null', null]
  ])('不正な sessionId(%s)は追跡を呼ばず、例外を投げずにログに出す', (_label, sessionId) => {
    const report = registerReport()
    expect(() => listeners.get(channel)?.(makeEvent(3), sessionId)).not.toThrow()
    expect(report).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(`[agent-hooks] ${label}の sessionId が不正です`)
  })

  it('サブフレームからの送信は捨てる(L-019)', () => {
    const report = registerReport()
    listeners.get(channel)?.(makeEvent(3, false), 'sid-9')
    expect(report).not.toHaveBeenCalled()
  })
})
