import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../agentChangesQuery', () => ({
  listAgentChanges: vi.fn(),
  listAgentChangesBetween: vi.fn()
}))
vi.mock('../../agentChangeDiff', () => ({
  getAgentChangeDiff: vi.fn(),
  getAgentChangeDiffBetween: vi.fn()
}))
vi.mock('../../agentChangesRevert', () => ({
  revertAgentChange: vi.fn(),
  revertAgentChangeHunk: vi.fn(),
  revertAllAgentChanges: vi.fn()
}))

import { FolderAccessManager } from '../../folderAccessManager'
import { AgentBaselineRegistry } from '../../agentBaselineRegistry'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../../agentBaselineSnapshot'
import { getAgentChangeDiff, getAgentChangeDiffBetween } from '../../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../../agentChangesQuery'
import {
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../../agentChangesRevert'
import {
  AGENT_CHANGES_NOT_MAIN_FRAME,
  AGENT_CHANGES_NO_RECORD_MESSAGE,
  AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE,
  registerAgentChangesHandlers
} from '../../handlers/agentChangesHandlers'
import { AGENT_CHANGES_REVERT_SCOPE_MESSAGE } from '../../handlers/agentChangesPayloadParser'
import type { AgentChangesScope } from '@shared/types'
import { makeBaselineSnapshot } from '../helpers/agentBaselineFixtures'

const ALL = { kind: 'all' } as const

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
let snapshotResults: BaselineSnapshotResult[] = []
let folderAccess: FolderAccessManager
let registry: AgentBaselineRegistry
const trash = vi.fn(async () => undefined)
const removeDir = vi.fn<(tempDir: string) => Promise<void>>(async () => undefined)
const snapshotFor = (folderPath: string): BaselineSnapshot =>
  makeBaselineSnapshot({ folderPath, startedAt: 42 })
const recordedResult = (snapshot: BaselineSnapshot): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot
})

beforeEach(() => {
  vi.clearAllMocks()
  handles.clear()
  snapshotResults = []
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-handlers-')))
  writeFileSync(join(folder, 'a.txt'), 'a')
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, folder)
  registry = new AgentBaselineRegistry({
    takeSnapshot: async (folderPath) =>
      snapshotResults.shift() ?? recordedResult(snapshotFor(folderPath)),
    removeDir,
    removeDirSync: vi.fn(),
    now: () => 0
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
    ['agentChanges:begin', ['manual']],
    ['agentChanges:getState', []],
    ['agentChanges:list', [ALL]],
    ['agentChanges:getDiff', ['a.txt', ALL]],
    ['agentChanges:revertFile', ['a.txt', ALL]],
    ['agentChanges:revertHunk', ['a.txt', 'patch', ALL]],
    ['agentChanges:revertAll', [[], ALL]],
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
    await expect(invoke('agentChanges:begin', makeEvent(), 'manual')).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: []
    })
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: []
    })
    await expect(invoke('agentChanges:list', makeEvent(), ALL)).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: [],
      scope: { kind: 'all' },
      entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
    expect(listAgentChanges).toHaveBeenCalledWith(snapshotFor(folder))
  })

  it('別のウィンドウの記録には触れない(所有者の分離)', async () => {
    folderAccess.set(2, folder)
    await invoke('agentChanges:begin', makeEvent(1), 'manual')
    await expect(invoke('agentChanges:getState', makeEvent(2))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:list', makeEvent(2), ALL)).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:revertFile', makeEvent(2), 'a.txt', ALL)).rejects.toThrow(
      AGENT_CHANGES_NO_RECORD_MESSAGE
    )
    expect(revertAgentChange).not.toHaveBeenCalled()
  })

  it('フォルダを開いていなければ begin・getState・list は none', async () => {
    await expect(invoke('agentChanges:begin', makeEvent(3), 'manual')).resolves.toEqual({
      kind: 'none'
    })
    await expect(invoke('agentChanges:getState', makeEvent(3))).resolves.toEqual({ kind: 'none' })
    await expect(invoke('agentChanges:list', makeEvent(3), ALL)).resolves.toEqual({ kind: 'none' })
  })

  it('getDiff・revertFile・revertHunk は許可のフォルダの中の相対パスにして渡す', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    vi.mocked(getAgentChangeDiff).mockResolvedValue('diff')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', ALL)).resolves.toBe('diff')
    await invoke('agentChanges:revertFile', makeEvent(), 'gone/b.txt', ALL)
    await invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 'patch', ALL)
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
      await invoke('agentChanges:begin', makeEvent(), 'manual')
      await expect(invoke('agentChanges:revertFile', makeEvent(), path, ALL)).rejects.toThrow()
      expect(revertAgentChange).not.toHaveBeenCalled()
    }
  )

  it('revertHunk はパッチの型を確かめる', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    await expect(invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 1, ALL)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
    expect(revertAgentChangeHunk).not.toHaveBeenCalled()
  })

  it('revertAll は確認の一覧を検証して詰め直したものを渡し、結果を返す', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    vi.mocked(revertAllAgentChanges).mockResolvedValue({ status: 'done' })
    await expect(
      invoke('agentChanges:revertAll', makeEvent(), [{ path: 'a.txt', status: 'M', x: 1 }], ALL)
    ).resolves.toEqual({ status: 'done' })
    expect(revertAllAgentChanges).toHaveBeenCalledWith({ snapshot: snapshotFor(folder), trash }, [
      { path: 'a.txt', status: 'M' }
    ])
    await expect(invoke('agentChanges:revertAll', makeEvent(), 'all', ALL)).rejects.toThrow(
      '確認の一覧が不正です'
    )
  })

  it('記録が無ければ getDiff・revertFile・revertHunk・revertAll は例外にする', async () => {
    for (const [channel, args] of [
      ['agentChanges:getDiff', ['a.txt', ALL]],
      ['agentChanges:revertFile', ['a.txt', ALL]],
      ['agentChanges:revertHunk', ['a.txt', 'p', ALL]],
      ['agentChanges:revertAll', [[], ALL]]
    ] as const) {
      await expect(invoke(channel, makeEvent(), ...args)).rejects.toThrow(
        AGENT_CHANGES_NO_RECORD_MESSAGE
      )
    }
  })

  it('revertHunk はメインフレーム以外からの壊れたパッチにも送信元の拒否を先に返す', async () => {
    await expect(
      invoke('agentChanges:revertHunk', makeEvent(1, false), 'a.txt', 1, ALL)
    ).rejects.toThrow(AGENT_CHANGES_NOT_MAIN_FRAME)
  })

  it('revertHunk はフォルダの確認・パスの検証より先にパッチを検証する', async () => {
    await expect(invoke('agentChanges:revertHunk', makeEvent(3), '', 1, ALL)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    await expect(invoke('agentChanges:revertHunk', makeEvent(), '', 1, ALL)).rejects.toThrow(
      'patch は文字列である必要があります'
    )
  })

  it('clear で記録を捨てる', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    await invoke('agentChanges:clear', makeEvent())
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual({ kind: 'none' })
  })
})

// getDiff・revertFile・revertHunk が共有する前処理(送信元 → 許可のフォルダ → パスの検証 → 記録の列)。
// どの段で止まったかを、後ろの段(folderAccess.get・registry.withRecord・領域の関数)が呼ばれたかで確かめる
describe('パスを受けるハンドラの前処理', () => {
  const pathHandlers = [
    ['agentChanges:getDiff', [ALL] as unknown[], () => vi.mocked(getAgentChangeDiff)],
    ['agentChanges:revertFile', [ALL] as unknown[], () => vi.mocked(revertAgentChange)],
    ['agentChanges:revertHunk', ['patch', ALL] as unknown[], () => vi.mocked(revertAgentChangeHunk)]
  ] as const

  it.each(pathHandlers)(
    '%s: 送信元が不正なら、フォルダも記録も引かずに拒否する',
    async (channel, rest, domainFn) => {
      await invoke('agentChanges:begin', makeEvent(), 'manual')
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
      await invoke('agentChanges:begin', makeEvent(), 'manual')
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
      await invoke('agentChanges:begin', makeEvent(), 'manual')
      const withRecord = vi.spyOn(registry, 'withRecord')
      await invoke(channel, makeEvent(), join(folder, 'a.txt'), ...rest)
      expect(withRecord).toHaveBeenCalledTimes(1)
      expect(withRecord).toHaveBeenCalledWith(1, folder, expect.any(Function))
      expect(domainFn()).toHaveBeenCalledTimes(1)
      expect(domainFn().mock.calls[0]).toContain('a.txt')
    }
  )
})

// 範囲(設計書「IPC の範囲の引数」「戻す系の IPC」)。send で実行 1(開始は累積の始点)・実行 2(区切り)を作って試す
describe('範囲と実行', () => {
  const runScope = (runId: number): AgentChangesScope => ({ kind: 'run', runId })
  const runSnapshot = (n: number): BaselineSnapshot =>
    makeBaselineSnapshot({ folderPath: folder, startedAt: 42 + n, tempDir: `/tmp/run-${n}` })
  const emptyList = { entries: [], totalCount: 0, truncated: false, headChanged: false }

  // send を 2 回送る(実行 1 の開始は累積の始点、実行 2 の開始は second)。2 回目の begin の結果を返す
  async function twoRuns(second: BaselineSnapshotResult): Promise<unknown> {
    snapshotResults.push(recordedResult(snapshotFor(folder)), second)
    await invoke('agentChanges:begin', makeEvent(), 'send')
    return invoke('agentChanges:begin', makeEvent(), 'send')
  }

  beforeEach(() => {
    vi.mocked(listAgentChanges).mockResolvedValue(emptyList)
    vi.mocked(listAgentChangesBetween).mockResolvedValue(emptyList)
    vi.mocked(getAgentChangeDiff).mockResolvedValue('diff')
    vi.mocked(getAgentChangeDiffBetween).mockResolvedValue('between')
  })

  it('begin は trigger を registry へ渡し、send は実行を足す', async () => {
    const begin = vi.spyOn(registry, 'begin')
    await expect(twoRuns(recordedResult(runSnapshot(2)))).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: [
        { runId: 1, number: 1, startedAt: 42, endedAt: 44, availability: { kind: 'available' } },
        { runId: 2, number: 2, startedAt: 44, endedAt: null, availability: { kind: 'available' } }
      ]
    })
    expect(begin).toHaveBeenLastCalledWith(1, folder, 'send')
  })

  it('list は範囲を解決し、累積・最後の実行・途中の実行の一覧を、実行の一覧と範囲を添えて返す', async () => {
    const run2 = runSnapshot(2)
    await twoRuns(recordedResult(run2))
    await expect(invoke('agentChanges:list', makeEvent(), ALL)).resolves.toMatchObject({
      kind: 'recording',
      startedAt: 42,
      scope: ALL,
      runs: [{ runId: 1 }, { runId: 2 }],
      ...emptyList
    })
    expect(listAgentChanges).toHaveBeenLastCalledWith(snapshotFor(folder))
    await expect(invoke('agentChanges:list', makeEvent(), runScope(2))).resolves.toMatchObject({
      kind: 'recording',
      scope: runScope(2)
    })
    expect(listAgentChanges).toHaveBeenLastCalledWith(run2)
    await expect(invoke('agentChanges:list', makeEvent(), runScope(1))).resolves.toMatchObject({
      kind: 'recording',
      scope: runScope(1)
    })
    expect(listAgentChangesBetween).toHaveBeenCalledWith(snapshotFor(folder), run2)
  })

  it('getDiff は範囲を解決し、累積・最後の実行・途中の実行の diff の関数を呼ぶ', async () => {
    const run2 = runSnapshot(2)
    await twoRuns(recordedResult(run2))
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', ALL)).resolves.toBe('diff')
    expect(getAgentChangeDiff).toHaveBeenLastCalledWith(snapshotFor(folder), 'a.txt')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', runScope(2))).resolves.toBe(
      'diff'
    )
    expect(getAgentChangeDiff).toHaveBeenLastCalledWith(run2, 'a.txt')
    await expect(invoke('agentChanges:getDiff', makeEvent(), 'a.txt', runScope(1))).resolves.toBe(
      'between'
    )
    expect(getAgentChangeDiffBetween).toHaveBeenCalledWith(snapshotFor(folder), run2, 'a.txt')
  })

  it.each<[string, number, string]>([
    ['一覧に無い実行', 99, 'run-missing'],
    ['開始を記録できなかった実行', 2, 'start-not-recorded'],
    ['終わりを記録できなかった実行', 1, 'end-not-recorded']
  ])(
    '%s: list は scope-unavailable を返し、getDiff は例外にし、一覧・diff の関数を呼ばない',
    async (_label, runId, reason) => {
      await twoRuns({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'too-many-untracked' }
      })
      await expect(invoke('agentChanges:list', makeEvent(), runScope(runId))).resolves.toEqual({
        kind: 'scope-unavailable',
        startedAt: 42,
        runs: expect.any(Array),
        scope: runScope(runId),
        reason
      })
      await expect(
        invoke('agentChanges:getDiff', makeEvent(), 'a.txt', runScope(runId))
      ).rejects.toThrow(AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE)
      expect(listAgentChanges).not.toHaveBeenCalled()
      expect(listAgentChangesBetween).not.toHaveBeenCalled()
      expect(getAgentChangeDiff).not.toHaveBeenCalled()
      expect(getAgentChangeDiffBetween).not.toHaveBeenCalled()
    }
  )

  // 範囲の解決(区切りの記録の場所を引く)は記録の列の中で行う。列の外で控えてから並ぶと、保持の上限で外した区切りの
  // 一時ディレクトリが一覧・diff の途中で消える(L-004)
  describe('範囲の解決と保持の上限(記録の列)', () => {
    // 実行 1(開始は累積の始点)〜11 を足し、実行 1 を保持の上限で外す。残るのは実行 2〜11(実行 2 の開始は /tmp/run-2)
    async function elevenRuns(): Promise<void> {
      snapshotResults.push(recordedResult(snapshotFor(folder)))
      for (let n = 2; n <= 12; n++) snapshotResults.push(recordedResult(runSnapshot(n)))
      for (let n = 1; n <= 11; n++) await invoke('agentChanges:begin', makeEvent(), 'send')
    }

    it.each([
      [
        'agentChanges:list',
        [] as unknown[],
        () => vi.mocked(listAgentChangesBetween) as ReturnType<typeof vi.fn>
      ],
      [
        'agentChanges:getDiff',
        ['a.txt'] as unknown[],
        () => vi.mocked(getAgentChangeDiffBetween) as ReturnType<typeof vi.fn>
      ]
    ] as const)(
      '%s の途中に送った実行で外れる区切りは、一覧・diff が終わってから消す',
      async (channel, args, between) => {
        await elevenRuns()
        expect(removeDir).not.toHaveBeenCalled()
        const order: string[] = []
        let finish: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          finish = resolve
        })
        between().mockImplementationOnce(async (start: BaselineSnapshot) => {
          order.push(`read:${start.tempDir}`)
          await gate
          order.push('read-end')
          return channel === 'agentChanges:list' ? emptyList : 'between'
        })
        removeDir.mockImplementationOnce(async (tempDir: string) => {
          order.push(`remove:${tempDir}`)
        })
        const reading = invoke(channel, makeEvent(), ...args, runScope(2))
        await vi.waitFor(() => expect(order).toEqual(['read:/tmp/run-2']))
        const sending = invoke('agentChanges:begin', makeEvent(), 'send')
        await new Promise((resolve) => setImmediate(resolve))
        expect(order).toEqual(['read:/tmp/run-2'])
        finish()
        await Promise.all([reading, sending])
        expect(order).toEqual(['read:/tmp/run-2', 'read-end', 'remove:/tmp/run-2'])
        // 外れた後に届いた範囲は、消えた区切りを引かずに run-missing になる
        if (channel === 'agentChanges:list') {
          await expect(invoke(channel, makeEvent(), runScope(2))).resolves.toMatchObject({
            kind: 'scope-unavailable',
            reason: 'run-missing'
          })
        } else {
          await expect(invoke(channel, makeEvent(), ...args, runScope(2))).rejects.toThrow(
            AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE
          )
        }
        expect(between()).toHaveBeenCalledTimes(1)
      }
    )
  })

  it.each([
    ['agentChanges:revertFile', ['a.txt'], () => vi.mocked(revertAgentChange)],
    ['agentChanges:revertHunk', ['a.txt', 'patch'], () => vi.mocked(revertAgentChangeHunk)],
    [
      'agentChanges:revertAll',
      [[{ path: 'a.txt', status: 'M' }]],
      () => vi.mocked(revertAllAgentChanges)
    ]
  ] as const)(
    '%s は実行の範囲を記録の列に入る前に拒み、作業ツリーを変える関数を呼ばない(L-058)',
    async (channel, args, domainFn) => {
      await twoRuns(recordedResult(runSnapshot(2)))
      const withRecord = vi.spyOn(registry, 'withRecord')
      await expect(invoke(channel, makeEvent(), ...args, runScope(1))).rejects.toThrow(
        AGENT_CHANGES_REVERT_SCOPE_MESSAGE
      )
      expect(withRecord).not.toHaveBeenCalled()
      expect(domainFn()).not.toHaveBeenCalled()
    }
  )

  it('begin は trigger の省略・未知の値を例外にし、記録を始めない(L-044)', async () => {
    const begin = vi.spyOn(registry, 'begin')
    await expect(invoke('agentChanges:begin', makeEvent())).rejects.toThrow(
      'trigger は send か manual である必要があります'
    )
    await expect(invoke('agentChanges:begin', makeEvent(), 'auto')).rejects.toThrow(
      'trigger は send か manual である必要があります'
    )
    expect(begin).not.toHaveBeenCalled()
  })

  it.each<[string, unknown[]]>([
    ['agentChanges:list', []],
    ['agentChanges:list', [{ kind: 'run' }]],
    ['agentChanges:getDiff', ['a.txt']],
    ['agentChanges:getDiff', ['a.txt', { kind: 'all', extra: 1 }]],
    ['agentChanges:revertFile', ['a.txt']],
    ['agentChanges:revertHunk', ['a.txt', 'patch']],
    ['agentChanges:revertAll', [[]]]
  ])('%s %j は範囲の形が不正なので例外にし、記録の列に入らない', async (channel, args) => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    const withRecord = vi.spyOn(registry, 'withRecord')
    await expect(invoke(channel, makeEvent(), ...args)).rejects.toThrow('範囲(scope)が不正です')
    expect(withRecord).not.toHaveBeenCalled()
  })

  it('getDiff は範囲をパスより先に検証する', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    await expect(
      invoke('agentChanges:getDiff', makeEvent(), '../outside.txt', { kind: 'nope' })
    ).rejects.toThrow('範囲(scope)が不正です')
  })
})
