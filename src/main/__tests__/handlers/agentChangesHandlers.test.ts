import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../agentChangesQuery', () => ({
  listAgentChanges: vi.fn()
}))
vi.mock('../../agentChangeDiff', () => ({
  getAgentChangeDiff: vi.fn()
}))
vi.mock('../../agentChangesRevert', () => ({
  revertAgentChange: vi.fn(),
  revertAgentChangeHunk: vi.fn(),
  revertAllAgentChanges: vi.fn()
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { AgentBaselineRegistry } from '../../agentBaselineRegistry'
import type { BaselineSnapshot } from '../../agentBaselineSnapshot'
import { getAgentChangeDiff } from '../../agentChangeDiff'
import { listAgentChanges } from '../../agentChangesQuery'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../../agentChangesRevert'
import {
  AGENT_CHANGES_NOT_MAIN_FRAME,
  AGENT_CHANGES_NO_RECORD_MESSAGE,
  registerAgentChangesHandlers
} from '../../handlers/agentChangesHandlers'
import { makeBaselineSnapshot } from '../helpers/agentBaselineFixtures'

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = {
  handle: vi.fn((channel: string, listener: Listener) => handles.set(channel, listener))
}
const makeEvent = (id = 1, main = true): unknown => ({
  sender: { id },
  senderFrame: { parent: main ? null : {} }
})
const invoke = (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve().then(() => {
    const handler = handles.get(channel)
    if (handler === undefined) throw new Error(`未登録: ${channel}`)
    return handler(event, ...args)
  })

let folder: string
let folderAccess: FolderAccessManager
let registry: AgentBaselineRegistry
const trash = vi.fn(async () => undefined)
const snapshotFor = (folderPath: string): BaselineSnapshot =>
  makeBaselineSnapshot({ folderPath, startedAt: 42 })

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-handlers-')))
  writeFileSync(join(folder, 'a.txt'), 'a')
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, folder)
  registry = new AgentBaselineRegistry({
    takeSnapshot: async (folderPath) => ({ kind: 'recorded', snapshot: snapshotFor(folderPath) }),
    removeDir: vi.fn(async () => undefined),
    removeDirSync: vi.fn()
  })
  registerAgentChangesHandlers(ipcMain as never, { registry, folderAccess, trash })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

describe('registerAgentChangesHandlers', () => {
  it('8 つのチャンネルを invoke で登録する', () => {
    expect([...handles.keys()].sort()).toEqual(
      [
        'agentChanges:begin',
        'agentChanges:clear',
        'agentChanges:getDiff',
        'agentChanges:getState',
        'agentChanges:list',
        'agentChanges:revertAll',
        'agentChanges:revertFile',
        'agentChanges:revertHunk'
      ].sort()
    )
  })

  it.each([
    ['agentChanges:begin', []],
    ['agentChanges:getState', []],
    ['agentChanges:list', []],
    ['agentChanges:getDiff', ['a.txt']],
    ['agentChanges:revertFile', ['a.txt']],
    ['agentChanges:revertHunk', ['a.txt', 'patch']],
    ['agentChanges:revertAll', [[]]],
    ['agentChanges:clear', []]
  ])('%s はメインフレーム以外からの依頼を拒否する', async (channel, args) => {
    await expect(invoke(channel, makeEvent(1, false), ...args)).rejects.toThrow(
      AGENT_CHANGES_NOT_MAIN_FRAME
    )
  })

  it('begin は送信元の許可のフォルダで記録を始め、getState・list はその記録を返す', async () => {
    vi.mocked(listAgentChanges).mockResolvedValue({
      entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
    await expect(invoke('agentChanges:begin', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42
    })
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42
    })
    await expect(invoke('agentChanges:list', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
    expect(listAgentChanges).toHaveBeenCalledWith(snapshotFor(folder))
  })

  it('別のウィンドウの記録には触れない(所有者の分離)', async () => {
    folderAccess.set(2, folder)
    await invoke('agentChanges:begin', makeEvent(1))
    await expect(invoke('agentChanges:getState', makeEvent(2))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:list', makeEvent(2))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:revertFile', makeEvent(2), 'a.txt')).rejects.toThrow(
      AGENT_CHANGES_NO_RECORD_MESSAGE
    )
    expect(revertAgentChange).not.toHaveBeenCalled()
  })

  it('フォルダを開いていなければ begin・getState・list は none', async () => {
    await expect(invoke('agentChanges:begin', makeEvent(3))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:getState', makeEvent(3))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:list', makeEvent(3))).resolves.toEqual({ kind: 'none' })
  })

  it('getDiff・revertFile・revertHunk は許可のフォルダの中の相対パスにして渡す', async () => {
    await invoke('agentChanges:begin', makeEvent())
    vi.mocked(getAgentChangeDiff).mockResolvedValue('diff')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt')).resolves.toBe('diff')
    await invoke('agentChanges:revertFile', makeEvent(), 'gone/b.txt')
    await invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 'patch')
    expect(getAgentChangeDiff).toHaveBeenCalledWith(snapshotFor(folder), 'a.txt')
    expect(revertAgentChange).toHaveBeenCalledWith(
      { snapshot: snapshotFor(folder), trash },
      'gone/b.txt'
    )
    expect(revertAgentChangeHunk).toHaveBeenCalledWith(
      { snapshot: snapshotFor(folder), trash },
      'a.txt',
      'patch'
    )
  })

  it.each(['../outside.txt', join('/', 'etc', 'passwd'), ''])(
    'パス %j は許可のフォルダの外・不正として拒否し、戻さない',
    async (path) => {
      await invoke('agentChanges:begin', makeEvent())
      await expect(invoke('agentChanges:revertFile', makeEvent(), path)).rejects.toThrow()
      expect(revertAgentChange).not.toHaveBeenCalled()
    }
  )

  it('revertHunk はパッチの型を確かめる', async () => {
    await invoke('agentChanges:begin', makeEvent())
    await expect(invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 1)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
    expect(revertAgentChangeHunk).not.toHaveBeenCalled()
  })

  it('revertAll は確認の一覧を検証して詰め直したものを渡し、結果を返す', async () => {
    await invoke('agentChanges:begin', makeEvent())
    vi.mocked(revertAllAgentChanges).mockResolvedValue({ status: 'done' })
    await expect(
      invoke('agentChanges:revertAll', makeEvent(), [{ path: 'a.txt', status: 'M', x: 1 }])
    ).resolves.toEqual({ status: 'done' })
    expect(revertAllAgentChanges).toHaveBeenCalledWith({ snapshot: snapshotFor(folder), trash }, [
      { path: 'a.txt', status: 'M' }
    ])
    await expect(invoke('agentChanges:revertAll', makeEvent(), 'all')).rejects.toThrow(
      '確認の一覧が不正です'
    )
  })

  it('記録が無ければ getDiff・revertFile・revertHunk・revertAll は例外にする', async () => {
    for (const [channel, args] of [
      ['agentChanges:getDiff', ['a.txt']],
      ['agentChanges:revertFile', ['a.txt']],
      ['agentChanges:revertHunk', ['a.txt', 'p']],
      ['agentChanges:revertAll', [[]]]
    ] as const) {
      await expect(invoke(channel, makeEvent(), ...args)).rejects.toThrow(
        AGENT_CHANGES_NO_RECORD_MESSAGE
      )
    }
  })

  it('revertHunk はメインフレーム以外からの壊れたパッチにも送信元の拒否を先に返す', async () => {
    await expect(
      invoke('agentChanges:revertHunk', makeEvent(1, false), 'a.txt', 1)
    ).rejects.toThrow(AGENT_CHANGES_NOT_MAIN_FRAME)
  })

  it('revertHunk はフォルダの確認・パスの検証より先にパッチを検証する', async () => {
    await expect(invoke('agentChanges:revertHunk', makeEvent(3), '', 1)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
    await invoke('agentChanges:begin', makeEvent())
    await expect(invoke('agentChanges:revertHunk', makeEvent(), '', 1)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
  })

  it('clear で記録を捨てる', async () => {
    await invoke('agentChanges:begin', makeEvent())
    await invoke('agentChanges:clear', makeEvent())
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual({ kind: 'none' })
  })
})

// getDiff・revertFile・revertHunk が共有する前処理(送信元 → 許可のフォルダ → パスの検証 → 記録の列)。
// どの段で止まったかを、後ろの段(folderAccess.get・registry.withRecord・領域の関数)が呼ばれたかで確かめる
describe('パスを受けるハンドラの前処理', () => {
  const pathHandlers = [
    ['agentChanges:getDiff', [] as unknown[], () => vi.mocked(getAgentChangeDiff)],
    ['agentChanges:revertFile', [] as unknown[], () => vi.mocked(revertAgentChange)],
    ['agentChanges:revertHunk', ['patch'] as unknown[], () => vi.mocked(revertAgentChangeHunk)]
  ] as const

  it.each(pathHandlers)(
    '%s: 送信元が不正なら、フォルダも記録も引かずに拒否する',
    async (channel, rest, domainFn) => {
      await invoke('agentChanges:begin', makeEvent())
      const getFolder = vi.spyOn(folderAccess, 'get')
      const withRecord = vi.spyOn(registry, 'withRecord')
      await expect(invoke(channel, makeEvent(1, false), 'a.txt', ...rest)).rejects.toThrow(
        AGENT_CHANGES_NOT_MAIN_FRAME
      )
      expect(getFolder).not.toHaveBeenCalled()
      expect(withRecord).not.toHaveBeenCalled()
      expect(domainFn()).not.toHaveBeenCalled()
    }
  )

  it.each(pathHandlers)(
    '%s: フォルダが無ければ、パスを検証せず(不正なパスでも)記録の列に入らずに「記録がありません」',
    async (channel, rest, domainFn) => {
      const withRecord = vi.spyOn(registry, 'withRecord')
      await expect(invoke(channel, makeEvent(3), '', ...rest)).rejects.toThrow(
        AGENT_CHANGES_NO_RECORD_MESSAGE
      )
      expect(withRecord).not.toHaveBeenCalled()
      expect(domainFn()).not.toHaveBeenCalled()
    }
  )

  it.each(pathHandlers)(
    '%s: パスが不正なら、記録の列に入る前に拒否する',
    async (channel, rest, domainFn) => {
      await invoke('agentChanges:begin', makeEvent())
      const withRecord = vi.spyOn(registry, 'withRecord')
      await expect(invoke(channel, makeEvent(), '../outside.txt', ...rest)).rejects.toThrow(
        'Access denied'
      )
      await expect(invoke(channel, makeEvent(), '', ...rest)).rejects.toThrow(
        'path は空でない文字列である必要があります'
      )
      expect(withRecord).not.toHaveBeenCalled()
      expect(domainFn()).not.toHaveBeenCalled()
    }
  )

  it.each(pathHandlers)(
    '%s: 正常なら、送信元の id と許可のフォルダで記録の列に並べ、相対パスで領域の関数を呼ぶ',
    async (channel, rest, domainFn) => {
      await invoke('agentChanges:begin', makeEvent())
      const withRecord = vi.spyOn(registry, 'withRecord')
      await invoke(channel, makeEvent(), join(folder, 'a.txt'), ...rest)
      expect(withRecord).toHaveBeenCalledTimes(1)
      expect(withRecord).toHaveBeenCalledWith(1, folder, expect.any(Function))
      expect(domainFn()).toHaveBeenCalledTimes(1)
      expect(domainFn().mock.calls[0]).toContain('a.txt')
    }
  )
})
