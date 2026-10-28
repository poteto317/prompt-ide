import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
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
import {
  AGENT_CHANGES_REVERT_SCOPE_MESSAGE,
  AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE
} from '../../handlers/agentChangesPayloadParser'
import type { AgentChangesScope } from '@shared/types'
import {
  attributionOffRecordingState,
  attributionOffSummary,
  makeAttributionOffDeps,
  makeBaselineSnapshot,
  makeFakeProtectionDeps
} from '../helpers/agentBaselineFixtures'
import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../../agentChangesUndo'
import { AGENT_UNDO_STALE_MESSAGE } from '../../agentChangesUndoModel'

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
// 取り消しの控えの置き場所と上限(戻す関数の偽物は控えを取らないため、置き場所は使われない)
const UNDO_CAPTURE = {
  tempRoot: join(tmpdir(), 'agent-changes-handlers-undo'),
  maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES
}
const removeDir = vi.fn<(tempDir: string) => Promise<void>>(async () => undefined)
const snapshotFor = (folderPath: string): BaselineSnapshot =>
  makeBaselineSnapshot({ folderPath, startedAt: 42 })
const recordedResult = (snapshot: BaselineSnapshot): BaselineSnapshotResult => ({
  kind: 'recorded',
  snapshot
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(revertAgentChange).mockResolvedValue({
    applied: 1,
    capture: { kind: 'unavailable', reason: 'too-large' }
  })
  vi.mocked(revertAgentChangeHunk).mockResolvedValue({
    applied: 1,
    capture: { kind: 'unavailable', reason: 'too-large' }
  })
  vi.mocked(revertAllAgentChanges).mockResolvedValue({
    status: 'done',
    applied: 2,
    capture: { kind: 'unavailable', reason: 'directory' }
  })
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
    now: () => 0,
    protection: makeFakeProtectionDeps(),
    // このファイルの取り消しのテストは、受け口の検証と registry の undoId の照合で止まり、書き戻しまで進まない。
    // 書き戻しの結合は handlers.integration、書き戻しのファイルの扱いは agentChangesUndo のテストで見る
    executeUndo: async () => {
      throw new Error('書き戻しまで進まない前提のテストで executeUndo が呼ばれた')
    },
    ...makeAttributionOffDeps()
  })
  registerAgentChangesHandlers(ipcMain as never, {
    registry,
    folderAccess,
    trash,
    undoCapture: UNDO_CAPTURE
  })
})

afterEach(() => {
  removeTempPathSync(folder)
})

describe('registerAgentChangesHandlers', () => {
  it('9 つのチャンネルを invoke で登録する', () => {
    expect([...handles.keys()].sort()).toEqual(
      [
        'agentChanges:begin',
        'agentChanges:clear',
        'agentChanges:getDiff',
        'agentChanges:getState',
        'agentChanges:list',
        'agentChanges:revertAll',
        'agentChanges:revertFile',
        'agentChanges:revertHunk',
        'agentChanges:undoRevert'
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
    ['agentChanges:undoRevert', [1]],
    ['agentChanges:clear', []]
  ])('%s はメインフレーム以外からの依頼を拒否する', async (channel, args) => {
    await expect(invoke(channel, makeEvent(1, false), ...args)).rejects.toThrow(
      AGENT_CHANGES_NOT_MAIN_FRAME
    )
  })

  it('begin は送信元の許可のフォルダで記録を始め、getState・list はその記録を返す', async () => {
    vi.mocked(listAgentChanges).mockResolvedValue({
      entries: [
        { path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false, author: null }
      ],
      totalCount: 1,
      truncated: false,
      headChanged: false
    })
    await expect(invoke('agentChanges:begin', makeEvent(), 'manual')).resolves.toEqual(
      attributionOffRecordingState(42)
    )
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toEqual(
      attributionOffRecordingState(42)
    )
    await expect(invoke('agentChanges:list', makeEvent(), ALL)).resolves.toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: [],
      undo: null,
      attribution: attributionOffSummary(42),
      storage: 'repository',
      scope: { kind: 'all' },
      entries: [
        { path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false, author: null }
      ],
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
      {
        snapshot: snapshotFor(folder),
        trash,
        undoCapture: UNDO_CAPTURE,
        attributeEntries: expect.any(Function)
      },
      'gone/b.txt'
    )
    expect(revertAgentChangeHunk).toHaveBeenCalledWith(
      {
        snapshot: snapshotFor(folder),
        trash,
        undoCapture: UNDO_CAPTURE,
        attributeEntries: expect.any(Function)
      },
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
    vi.mocked(revertAllAgentChanges).mockResolvedValue({
      status: 'done',
      applied: 1,
      capture: { kind: 'unavailable', reason: 'too-large' }
    })
    await expect(
      invoke('agentChanges:revertAll', makeEvent(), [{ path: 'a.txt', status: 'M', x: 1 }], ALL)
    ).resolves.toEqual({
      status: 'done',
      revertedCount: 1,
      undo: { kind: 'unavailable', reason: 'too-large' },
      undoSummary: null
    })
    expect(revertAllAgentChanges).toHaveBeenCalledWith(
      {
        snapshot: snapshotFor(folder),
        trash,
        undoCapture: UNDO_CAPTURE,
        attributeEntries: expect.any(Function)
      },
      [{ path: 'a.txt', status: 'M' }]
    )
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
    await expect(twoRuns(recordedResult(runSnapshot(2)))).resolves.toEqual(
      attributionOffRecordingState(42, {
        runs: [
          { runId: 1, number: 1, startedAt: 42, endedAt: 44, availability: { kind: 'available' } },
          { runId: 2, number: 2, startedAt: 44, endedAt: null, availability: { kind: 'available' } }
        ]
      })
    )
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

  it('list は累積の範囲でだけ、同じ所有者・記録で registry の attributeEntries に一覧の行を通し、その結果の行を返す', async () => {
    const run2 = runSnapshot(2)
    await twoRuns(recordedResult(run2))
    const row = {
      path: 'a.txt',
      status: 'M' as const,
      isDirectory: false,
      notRecorded: false,
      author: null
    }
    vi.mocked(listAgentChanges).mockResolvedValue({ ...emptyList, entries: [row], totalCount: 1 })
    const attribute = vi.spyOn(registry, 'attributeEntries')
    await expect(invoke('agentChanges:list', makeEvent(), ALL)).resolves.toMatchObject({
      entries: [row]
    })
    expect(attribute).toHaveBeenCalledOnce()
    const [ownerId, record, entries] = attribute.mock.calls[0]
    expect(ownerId).toBe(1)
    expect(record.baseline).toEqual(snapshotFor(folder))
    expect(entries).toEqual([row])
    // 最後の実行(作業ツリーとの比較)では付けない
    await invoke('agentChanges:list', makeEvent(), runScope(2))
    expect(attribute).toHaveBeenCalledOnce()
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
        undo: null,
        attribution: attributionOffSummary(42),
        storage: 'repository',
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

// 戻す系の戻り値(控えの成否と要約)と取り消し(設計書「IPC」)。registry.commitRevertUndo は本物(記録に控えを持つ)。
// 控えの dir は実在しないパスで、後の clear の removeDir は偽物
describe('戻す系の結果と取り消し', () => {
  const savedOutcome = {
    applied: 1,
    capture: {
      kind: 'saved' as const,
      dir: '/tmp/undo-1',
      items: [
        {
          path: 'a.txt',
          before: { kind: 'file' as const, savedName: '0', mode: 0o644 },
          after: { kind: 'file' as const, size: 1, sha256: 'x', mode: 0o644 }
        }
      ]
    }
  }
  const fileSummary = {
    undoId: 1,
    operation: 'file',
    entries: [{ path: 'a.txt', action: 'rewrite' }]
  }

  beforeEach(async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
  })

  it('revertFile は控えが取れなかった結果と null の要約を返す', async () => {
    await expect(invoke('agentChanges:revertFile', makeEvent(), 'a.txt', ALL)).resolves.toEqual({
      undo: { kind: 'unavailable', reason: 'too-large' },
      undoSummary: null
    })
  })

  it('控えが取れたら要約を返し、getState にも同じ要約が入る(控えの dir は renderer に返さない。L-019)', async () => {
    vi.mocked(revertAgentChange).mockResolvedValueOnce(savedOutcome)
    const result = await invoke('agentChanges:revertFile', makeEvent(), 'a.txt', ALL)
    expect(result).toEqual({ undo: { kind: 'saved' }, undoSummary: fileSummary })
    expect(JSON.stringify(result)).not.toContain('/tmp/undo-1')
    const state = await invoke('agentChanges:getState', makeEvent())
    expect(state).toMatchObject({ kind: 'recording', undo: fileSummary })
    expect(JSON.stringify(state)).not.toContain('/tmp/undo-1')
  })

  // registry が控えを付けずに消したとき、取り消せると伝えない(undo を saved にしない。undoSummary の null と食い違わない)
  it.each<[string, () => Promise<unknown>]>([
    [
      '記録が置き換わった後',
      async () => {
        void registry.clear(1)
        await registry.begin(1, folder, 'manual')
      }
    ],
    [
      'アプリの終了中',
      async () => {
        registry.close()
      }
    ]
  ])(
    '%s に戻す操作が終わったら、控えを付けずに消して undo を discarded にする',
    async (_label, interrupt) => {
      vi.mocked(revertAgentChange).mockImplementationOnce(async () => {
        await interrupt()
        return savedOutcome
      })
      await expect(invoke('agentChanges:revertFile', makeEvent(), 'a.txt', ALL)).resolves.toEqual({
        undo: { kind: 'discarded' },
        undoSummary: null
      })
    }
  )

  it('revertAll の途中で記録が置き換わったら、undo を discarded にする', async () => {
    vi.mocked(revertAllAgentChanges).mockImplementationOnce(async () => {
      void registry.clear(1)
      await registry.begin(1, folder, 'manual')
      return { status: 'done', applied: 1, capture: savedOutcome.capture }
    })
    await expect(invoke('agentChanges:revertAll', makeEvent(), [], ALL)).resolves.toEqual({
      status: 'done',
      revertedCount: 1,
      undo: { kind: 'discarded' },
      undoSummary: null
    })
  })

  it('revertHunk は hunk の要約を返す', async () => {
    vi.mocked(revertAgentChangeHunk).mockResolvedValueOnce(savedOutcome)
    await expect(
      invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 'patch', ALL)
    ).resolves.toEqual({
      undo: { kind: 'saved' },
      undoSummary: { ...fileSummary, operation: 'hunk' }
    })
  })

  it('revertAll は戻せた件数と控えの結果を返す', async () => {
    await expect(invoke('agentChanges:revertAll', makeEvent(), [], ALL)).resolves.toEqual({
      status: 'done',
      revertedCount: 2,
      undo: { kind: 'unavailable', reason: 'directory' },
      undoSummary: null
    })
  })

  it('revertAll の partial は文言と戻せた件数を返す', async () => {
    vi.mocked(revertAllAgentChanges).mockResolvedValueOnce({
      status: 'partial',
      message: 'm',
      applied: 1,
      capture: { kind: 'unavailable', reason: 'directory' }
    })
    await expect(invoke('agentChanges:revertAll', makeEvent(), [], ALL)).resolves.toEqual({
      status: 'partial',
      message: 'm',
      revertedCount: 1,
      undo: { kind: 'unavailable', reason: 'directory' },
      undoSummary: null
    })
  })

  it.each<[string, () => void, () => Promise<unknown>]>([
    [
      'revertFile',
      () => vi.mocked(revertAgentChange).mockRejectedValueOnce(new Error('boom')),
      () => invoke('agentChanges:revertFile', makeEvent(), 'a.txt', ALL)
    ],
    [
      'revertHunk',
      () => vi.mocked(revertAgentChangeHunk).mockRejectedValueOnce(new Error('boom')),
      () => invoke('agentChanges:revertHunk', makeEvent(), 'a.txt', 'patch', ALL)
    ],
    [
      'revertAll',
      () => vi.mocked(revertAllAgentChanges).mockRejectedValueOnce(new Error('boom')),
      () => invoke('agentChanges:revertAll', makeEvent(), [], ALL)
    ]
  ])('%s の戻す関数が reject したら commitRevertUndo を呼ばない', async (_label, reject, run) => {
    const commit = vi.spyOn(registry, 'commitRevertUndo')
    reject()
    await expect(run()).rejects.toThrow('boom')
    expect(commit).not.toHaveBeenCalled()
  })

  it('適用が 0 件の revertAll は、適用の件数を commitRevertUndo に渡して前の控えを残す', async () => {
    const commit = vi.spyOn(registry, 'commitRevertUndo')
    vi.mocked(revertAgentChange).mockResolvedValueOnce(savedOutcome)
    await invoke('agentChanges:revertFile', makeEvent(), 'a.txt', ALL)
    vi.mocked(revertAllAgentChanges).mockResolvedValueOnce({
      status: 'done',
      applied: 0,
      capture: { kind: 'unavailable', reason: 'capture-failed' }
    })
    await expect(invoke('agentChanges:revertAll', makeEvent(), [], ALL)).resolves.toEqual({
      status: 'done',
      revertedCount: 0,
      undo: { kind: 'unavailable', reason: 'capture-failed' },
      undoSummary: fileSummary
    })
    expect(commit).toHaveBeenLastCalledWith(1, expect.anything(), {
      operation: 'all',
      capture: { kind: 'unavailable', reason: 'capture-failed' },
      applied: 0
    })
    await expect(invoke('agentChanges:getState', makeEvent())).resolves.toMatchObject({
      undo: fileSummary
    })
  })

  describe('undoRevert', () => {
    it.each([1, undefined, 0, '1'])(
      'メインフレーム以外からの依頼は undoId %j でも送信元の拒否を返す',
      async (undoId) => {
        const undo = vi.spyOn(registry, 'undoLastRevert')
        await expect(
          invoke('agentChanges:undoRevert', makeEvent(1, false), undoId)
        ).rejects.toThrow(AGENT_CHANGES_NOT_MAIN_FRAME)
        expect(undo).not.toHaveBeenCalled()
      }
    )

    it.each([undefined, 0, '1'])('undoId %j は検証で拒否し、取り消しを呼ばない', async (undoId) => {
      const undo = vi.spyOn(registry, 'undoLastRevert')
      await expect(invoke('agentChanges:undoRevert', makeEvent(), undoId)).rejects.toThrow(
        AGENT_CHANGES_UNDO_ID_INVALID_MESSAGE
      )
      expect(undo).not.toHaveBeenCalled()
    })

    it('フォルダが無い・記録が無いなら「記録がありません」', async () => {
      await expect(invoke('agentChanges:undoRevert', makeEvent(3), 1)).rejects.toThrow(
        AGENT_CHANGES_NO_RECORD_MESSAGE
      )
      await invoke('agentChanges:clear', makeEvent())
      await expect(invoke('agentChanges:undoRevert', makeEvent(), 1)).rejects.toThrow(
        AGENT_CHANGES_NO_RECORD_MESSAGE
      )
    })

    it('控えが無い記録への取り消しは「取り消せる操作が変わりました」', async () => {
      await expect(invoke('agentChanges:undoRevert', makeEvent(), 1)).rejects.toThrow(
        AGENT_UNDO_STALE_MESSAGE
      )
    })
  })
})

describe('戻す操作の吸収(withAttributionAbsorbed)', () => {
  it.each<[string, unknown[]]>([
    ['agentChanges:revertFile', ['a.txt', ALL]],
    ['agentChanges:revertHunk', ['a.txt', 'patch', ALL]],
    ['agentChanges:revertAll', [[{ path: 'a.txt', status: 'M' }], ALL]]
  ])(
    '%s は戻す関数の呼び出しを吸収で包み、適用した件数で作業ツリーを変えたかを決める(控えの記録は吸収の外)',
    async (channel, args) => {
      await invoke('agentChanges:begin', makeEvent(), 'manual')
      // 吸収が終わった後に控えを記録するか(題の「控えの記録は吸収の外」)を、呼ばれた順で確かめる
      const order: string[] = []
      // 戻す関数が吸収の task の中(始まりと終わりの間)で呼ばれることも、同じ順で確かめる
      for (const revert of [revertAgentChange, revertAgentChangeHunk, revertAllAgentChanges]) {
        const original = vi.mocked(revert).getMockImplementation() as (
          ...revertArgs: unknown[]
        ) => Promise<unknown>
        vi.mocked(revert).mockImplementation((async (...revertArgs: unknown[]) => {
          order.push('戻す')
          return original(...revertArgs)
        }) as never)
      }
      const absorb = registry.withAttributionAbsorbed.bind(registry)
      const absorbed = vi
        .spyOn(registry, 'withAttributionAbsorbed')
        .mockImplementation(async (...absorbArgs: Parameters<typeof absorb>) => {
          order.push('吸収の始まり')
          const result = await absorb(...absorbArgs)
          order.push('吸収の終わり')
          return result
        })
      const commitUndo = registry.commitRevertUndo.bind(registry)
      vi.spyOn(registry, 'commitRevertUndo').mockImplementation(async (...commitArgs) => {
        order.push('控えの記録')
        return commitUndo(...commitArgs)
      })
      await invoke(channel, makeEvent(), ...args)
      expect(order).toEqual(['吸収の始まり', '戻す', '吸収の終わり', '控えの記録'])
      expect(absorbed).toHaveBeenCalledOnce()
      const [ownerId, record, task, changed] = absorbed.mock.calls[0]
      expect(ownerId).toBe(1)
      expect(record).toBeDefined()
      expect(typeof task).toBe('function')
      expect(changed({ applied: 1, capture: { kind: 'unavailable', reason: 'too-large' } })).toBe(
        true
      )
      expect(changed({ applied: 0, capture: { kind: 'unavailable', reason: 'too-large' } })).toBe(
        false
      )
    }
  )

  it('revertAll は、registry の attributeEntries を戻す関数の中(吸収の task の中・適用の前)で呼ぶ(吸収の外で先に呼ぶ形に崩れると落ちる。L-449)', async () => {
    await invoke('agentChanges:begin', makeEvent(), 'manual')
    const order: string[] = []
    const absorb = registry.withAttributionAbsorbed.bind(registry)
    vi.spyOn(registry, 'withAttributionAbsorbed').mockImplementation(
      async (...absorbArgs: Parameters<typeof absorb>) => {
        order.push('吸収の始まり')
        const result = await absorb(...absorbArgs)
        order.push('吸収の終わり')
        return result
      }
    )
    const attribute = registry.attributeEntries.bind(registry)
    vi.spyOn(registry, 'attributeEntries').mockImplementation(async (...attributeArgs) => {
      order.push('author')
      return attribute(...attributeArgs)
    })
    vi.mocked(revertAllAgentChanges).mockImplementationOnce(async (context) => {
      order.push('戻す関数の始まり')
      await context.attributeEntries([])
      order.push('適用')
      return { status: 'done', applied: 1, capture: { kind: 'unavailable', reason: 'too-large' } }
    })
    await invoke('agentChanges:revertAll', makeEvent(), [], ALL)
    expect(order).toEqual(['吸収の始まり', '戻す関数の始まり', 'author', '適用', '吸収の終わり'])
  })
})
