import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FolderAccessManager } from '../../folderAccessManager'
import { AgentBaselineRegistry } from '../../agentBaselineRegistry'
import {
  removeBaselineDir,
  removeBaselineDirSync,
  takeBaselineSnapshot
} from '../../agentBaselineSnapshot'
import { registerAgentChangesHandlers } from '../../handlers/agentChangesHandlers'
import { AGENT_CHANGES_REVERT_SCOPE_MESSAGE } from '../../handlers/agentChangesPayloadParser'
import { commitAll, readRepoFile, writeRepoFile } from '../helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeTrash,
  disposeAgentBaselineRepo
} from '../helpers/agentBaselineFixtures'
import type { FakeTrash } from '../helpers/agentBaselineFixtures'

// 実 git で、送信ごとの区切り → 範囲ごとの一覧・diff → 戻す系の範囲の検査を handler から通す(設計書「テスト方針」の結合)

type Listener = (...args: unknown[]) => unknown
const handles = new Map<string, Listener>()
const ipcMain = {
  handle: (channel: string, listener: Listener): void => {
    handles.set(channel, listener)
  }
}
const event = { sender: { id: 1 }, senderFrame: { parent: null } }
const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve().then(() => {
    const handler = handles.get(channel)
    if (handler === undefined) throw new Error(`未登録: ${channel}`)
    return handler(event, ...args)
  })

const ALL = { kind: 'all' }
const RUN_1 = { kind: 'run', runId: 1 }
const RUN_2 = { kind: 'run', runId: 2 }

let repo: string
let home: string
let tempRoot: string
let registry: AgentBaselineRegistry
let trash: FakeTrash
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-handlers-int-'))
  handles.clear()
  trash = createFakeTrash()
  const folderAccess = new FolderAccessManager()
  folderAccess.set(1, repo)
  registry = new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) =>
      takeBaselineSnapshot(folderPath, { ...options, tempRoot }),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now
  })
  registerAgentChangesHandlers(ipcMain as never, { registry, folderAccess, trash: trash.trash })
})

afterEach(() => {
  registry.close()
  disposeAgentBaselineRepo({ repo, home, tempRoot })
})

// 実行 1 で a.txt、実行 2 で b.txt を変える
async function twoRuns(): Promise<void> {
  write('a.txt', 'a\n')
  write('b.txt', 'b\n')
  commitAll(repo, 'init')
  await invoke('agentChanges:begin', 'send')
  write('a.txt', 'a\nrun1\n')
  await invoke('agentChanges:begin', 'send')
  write('b.txt', 'b\nrun2\n')
}

const pathsOf = async (scope: unknown): Promise<string[]> => {
  const result = (await invoke('agentChanges:list', scope)) as { entries: { path: string }[] }
  return result.entries.map((entry) => entry.path)
}

describe('agentChanges の handler(実 git)', () => {
  it('送信ごとに区切りを取り、範囲ごとの一覧・diff がその実行の変更だけになる', async () => {
    await twoRuns()
    expect(await pathsOf(RUN_1)).toEqual(['a.txt'])
    expect(await pathsOf(RUN_2)).toEqual(['b.txt'])
    expect(await pathsOf(ALL)).toEqual(['a.txt', 'b.txt'])
    expect(await invoke('agentChanges:getDiff', 'a.txt', RUN_1)).toContain('+run1')
    expect(await invoke('agentChanges:getDiff', 'b.txt', RUN_2)).toContain('+run2')
  })

  it('戻す系に実行の範囲を渡すと拒み、作業ツリーを変えない(範囲の検査を外すとこのテストが落ちる)', async () => {
    await twoRuns()
    const before = { a: readRepoFile(repo, 'a.txt'), b: readRepoFile(repo, 'b.txt') }
    const patch = (await invoke('agentChanges:getDiff', 'a.txt', ALL)) as string
    await expect(invoke('agentChanges:revertFile', 'a.txt', RUN_1)).rejects.toThrow(
      AGENT_CHANGES_REVERT_SCOPE_MESSAGE
    )
    await expect(invoke('agentChanges:revertHunk', 'a.txt', patch, RUN_1)).rejects.toThrow(
      AGENT_CHANGES_REVERT_SCOPE_MESSAGE
    )
    await expect(
      invoke(
        'agentChanges:revertAll',
        [
          { path: 'a.txt', status: 'M' },
          { path: 'b.txt', status: 'M' }
        ],
        RUN_2
      )
    ).rejects.toThrow(AGENT_CHANGES_REVERT_SCOPE_MESSAGE)
    expect({ a: readRepoFile(repo, 'a.txt'), b: readRepoFile(repo, 'b.txt') }).toEqual(before)
    expect(trash.trashed).toEqual([])
    // 累積の範囲なら戻せる(拒むのは範囲だけ)
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('a\n')
  })
})
