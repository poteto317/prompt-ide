import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FolderAccessManager } from '../../folderAccessManager'
import { AgentBaselineRegistry } from '../../agentBaselineRegistry'
import type { AgentBaselineProtectionDeps } from '../../agentBaselineRegistry'
import { runBaselineGitWithInput } from '../../agentBaselineGit'
import {
  removeBaselineDir,
  removeBaselineDirSync,
  takeBaselineSnapshot
} from '../../agentBaselineSnapshot'
import { registerAgentChangesHandlers } from '../../handlers/agentChangesHandlers'
import { AGENT_CHANGES_REVERT_SCOPE_MESSAGE } from '../../handlers/agentChangesPayloadParser'
import { isProcessAliveOnThisMachine, protectionRefGit } from '../../agentChangesProtectionRef'
import { createProtectionInstanceId } from '../../agentChangesProtectionRules'
import type { AgentChangesProtectionGit } from '../../agentChangesProtectionRef'
import {
  AGENT_CHANGES_UNDO_MAX_BYTES,
  AGENT_CHANGES_UNDO_TEMP_PREFIX,
  executeAgentChangesUndo
} from '../../agentChangesUndo'
import {
  collectAgentChangeEntries,
  collectAgentChangeEntriesBetween
} from '../../agentChangesQuery'
import { AGENT_REVERT_ALL_MISMATCH_MESSAGE } from '../../agentChangesRevert'
import { commitAll, readRepoFile, runGit, writeRepoFile } from '../helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createFakeAttributionSource,
  createFakeTrash,
  disposeAgentBaselineRepo,
  repoLocation
} from '../helpers/agentBaselineFixtures'
import type { FakeAttributionSource, FakeTrash } from '../helpers/agentBaselineFixtures'

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
// 保護の ref の instanceId(テストの中で固定する。記録の番号は registry を作るたびに 1 から)
const INSTANCE_ID = createProtectionInstanceId(process.pid, 'abcdef01')
const REF_1 = `refs/prompt-ide/agent-changes/${INSTANCE_ID}/1`

let repo: string
let home: string
let tempRoot: string
let registry: AgentBaselineRegistry
let trash: FakeTrash
let folderAccess: FolderAccessManager
let noHooksDir: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

// registry の依存。区別は既定で lost(区別の区切りを取らない)。区別を試す describe は attributionSource を渡す
function makeRegistry(
  protection: Partial<AgentBaselineProtectionDeps> = {},
  attributionSource: FakeAttributionSource = createFakeAttributionSource({
    lost: 'receiver-unavailable'
  })
): AgentBaselineRegistry {
  return new AgentBaselineRegistry({
    takeSnapshot: (folderPath, options) =>
      takeBaselineSnapshot(folderPath, { ...options, tempRoot, instanceId: INSTANCE_ID }),
    collectBetween: (start, end) => collectAgentChangeEntriesBetween(start, end),
    collectCurrent: (snapshot) => collectAgentChangeEntries(snapshot),
    removeDir: removeBaselineDir,
    removeDirSync: removeBaselineDirSync,
    now: Date.now,
    protection: {
      instanceId: INSTANCE_ID,
      noHooksDir,
      git: protectionRefGit,
      isProcessAlive: isProcessAliveOnThisMachine,
      ...protection
    },
    executeUndo: (folderPath, undo) =>
      executeAgentChangesUndo({ folderPath, undo, trash: trash.trash }),
    attributionSource,
    attributionDevLog: null,
    attributionWarn: () => undefined
  })
}

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-handlers-int-'))
  handles.clear()
  trash = createFakeTrash()
  folderAccess = new FolderAccessManager()
  folderAccess.set(1, repo)
  noHooksDir = join(tempRoot, 'no-hooks')
  mkdirSync(noHooksDir, { mode: 0o700 })
  registry = makeRegistry()
  registerAgentChangesHandlers(ipcMain as never, {
    registry,
    folderAccess,
    trash: trash.trash,
    undoCapture: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
  })
})

// 古い registry を閉じ、依存を差し替えた新しい registry で handler を登録し直す
function rebuildRegistry(
  protection: Partial<AgentBaselineProtectionDeps> = {},
  attributionSource?: FakeAttributionSource
): void {
  registry.close()
  handles.clear()
  registry = makeRegistry(protection, attributionSource)
  registerAgentChangesHandlers(ipcMain as never, {
    registry,
    folderAccess,
    trash: trash.trash,
    undoCapture: { tempRoot, maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES }
  })
}

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

// refs/prompt-ide/ の下の ref の一覧(名前と種類)
const protectionRefs = (): string =>
  runGit(repo, 'for-each-ref', '--format=%(refname) %(objecttype)', 'refs/prompt-ide/')
// 記録 1 の保護の tree の子の名前
const lsTree = (): string => runGit(repo, 'ls-tree', '--name-only', REF_1)
const gcNow = (): void => {
  runGit(repo, 'gc', '-q', '--prune=now')
}

describe('記録の gc からの保護(実 git)', () => {
  it('ref は記録の番号の名前で tree を指し、子は累積の始点と区切りの実行(実行 1 は始点のため作らない)', async () => {
    await twoRuns()
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))
    expect(protectionRefs()).toBe(`${REF_1} tree\n`)
  })

  it('gc --prune=now の後も、記録だけが持つ object から一覧・diff・戻すが成功する', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    // コミットしない利用者の変更(累積の始点だけが持つ blob)
    write('a.txt', 'a\nuser\n')
    await invoke('agentChanges:begin', 'send')
    write('a.txt', 'a\nuser\nrun1\n')
    await invoke('agentChanges:begin', 'send')
    write('b.txt', 'b\nrun2\n')
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))
    gcNow()
    expect(await pathsOf(ALL)).toEqual(['a.txt', 'b.txt'])
    // 途中の実行(両端の tree が記録だけの object)
    expect(await pathsOf(RUN_1)).toEqual(['a.txt'])
    expect(await invoke('agentChanges:getDiff', 'a.txt', ALL)).toContain('+run1')
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('a\nuser\n')
  }, 30_000)

  it('clear で ref を消し、区切りだけが持つ blob は gc で消える', async () => {
    await twoRuns()
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))
    const blob = runGit(repo, 'rev-parse', `${REF_1}:run-2/a.txt`).trim()
    await invoke('agentChanges:clear')
    expect(protectionRefs()).toBe('')
    gcNow()
    expect(() => runGit(repo, 'cat-file', '-t', blob)).toThrow()
  })

  it('利用者のコミット・ブランチ・タグ・HEAD・stash・index を変えない', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    const userState = (): unknown => ({
      log: runGit(repo, 'log', '--all', '--oneline'),
      refs: runGit(repo, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'),
      head: runGit(repo, 'rev-parse', 'HEAD'),
      stash: runGit(repo, 'stash', 'list'),
      index: readFileSync(join(repo, '.git/index')).toString('base64'),
      indexMtimeNs: statSync(join(repo, '.git/index'), { bigint: true }).mtimeNs
    })
    const before = userState()
    await invoke('agentChanges:begin', 'send')
    write('a.txt', 'a\nrun1\n')
    await invoke('agentChanges:begin', 'send')
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))
    expect(userState()).toEqual(before)
  })

  it('ref の作成・更新・削除で reference-transaction の hook が動かない', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    // commitAll も hook を動かすため、hook はコミットの後に置く
    commitAll(repo, 'init')
    const marker = join(repo, 'hook-ran')
    const hook = join(repo, '.git/hooks/reference-transaction')
    mkdirSync(join(repo, '.git/hooks'), { recursive: true })
    // hook の環境には GIT_DIR が無いため、書き込み先は絶対パスで埋め込む
    writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\n`)
    chmodSync(hook, 0o755)
    expect(existsSync(marker)).toBe(false)
    await invoke('agentChanges:begin', 'send')
    write('a.txt', 'a\nrun1\n')
    await invoke('agentChanges:begin', 'send')
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))
    expect(existsSync(marker)).toBe(false)
    // 記録を捨てるとき(clear)の ref の削除でも動かない
    await invoke('agentChanges:clear')
    expect(protectionRefs()).toBe('')
    expect(existsSync(marker)).toBe(false)
  })

  it('利用者が ref を消したら作り直さない', async () => {
    await twoRuns()
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-2\n'))
    runGit(repo, 'update-ref', '-d', REF_1)
    write('c.txt', 'c\n')
    await invoke('agentChanges:begin', 'send')
    // 列が進む(保護の同期の後ろに並ぶ)のを待つ
    await invoke('agentChanges:list', ALL)
    expect(protectionRefs()).toBe('')
  })

  it('同期の待ちの間に gc で消えた区切りの tree は項目から除き、後の同期は残った項目と新しい区切りで作る', async () => {
    let releaseGate = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    let filterCalls = 0
    let madeTrees = 0
    const git: AgentChangesProtectionGit = {
      ...protectionRefGit,
      // 2 回目の同期だけを待たせる(1 回目は通す)
      filterExistingTrees: async (ctx, entries) => {
        filterCalls += 1
        if (filterCalls === 2) await gate
        return protectionRefGit.filterExistingTrees(ctx, entries)
      },
      makeTree: async (ctx, entries) => {
        const tree = await protectionRefGit.makeTree(ctx, entries)
        madeTrees += 1
        return tree
      }
    }
    rebuildRegistry({ git })
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    await invoke('agentChanges:begin', 'send')
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\n'))
    write('a.txt', 'a\nrun1\n')
    await invoke('agentChanges:begin', 'send')
    await vi.waitFor(() => expect(filterCalls).toBe(2))
    gcNow()
    releaseGate()
    // 2 回目の同期は run-2 を除いた値(= 今の値)を作り、ref を変えない
    await vi.waitFor(() => expect(madeTrees).toBe(2))
    expect(lsTree()).toBe('baseline\n')
    // 写しの元(run-2 の記録のインデックス)の a.txt の blob は gc で消えているため、大きさを変えて読み直させる
    write('b.txt', 'b\nrun3\n')
    write('a.txt', 'a\nrun3-x\n')
    await invoke('agentChanges:begin', 'send')
    await vi.waitFor(() => expect(lsTree()).toBe('baseline\nrun-3\n'))
    await invoke('agentChanges:clear')
    expect(protectionRefs()).toBe('')
  })

  it('SHA-256 のリポジトリでも ref を作る', async () => {
    const shaRepo = realpathSync(mkdtempSync(join(tmpdir(), 'agent-changes-sha256-')))
    try {
      runGit(shaRepo, 'init', '-q', '--object-format=sha256', '-b', 'main')
      runGit(shaRepo, 'config', 'user.name', 'tester')
      runGit(shaRepo, 'config', 'user.email', 'tester@example.com')
      writeRepoFile(shaRepo, 'a.txt', 'a\n')
      commitAll(shaRepo, 'init')
      folderAccess.set(1, shaRepo)
      rebuildRegistry()
      await invoke('agentChanges:begin', 'send')
      await vi.waitFor(() =>
        expect(
          runGit(shaRepo, 'for-each-ref', '--format=%(objectname)', 'refs/prompt-ide/')
        ).toMatch(/^[0-9a-f]{64}\n$/)
      )
    } finally {
      registry.close()
      removeTempPathSync(shaRepo)
    }
  })

  it('残った ref の掃除は、死んだ pid の自分の形の名前と値だけを消す', async () => {
    rebuildRegistry({ isProcessAlive: (pid) => pid !== 4242 })
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const tree = runGit(repo, 'write-tree').trim()
    const indexPath = join(repo, '.git/index')
    const ownShaped = (
      await runBaselineGitWithInput(
        repoLocation(repo, indexPath),
        ['mktree', '-z'],
        `040000 tree ${tree}\tbaseline\0`
      )
    ).trim()
    const emptyTree = (
      await runBaselineGitWithInput(repoLocation(repo, indexPath), ['mktree', '-z'], '')
    ).trim()
    const head = runGit(repo, 'rev-parse', 'HEAD').trim()
    const stale = 'refs/prompt-ide/agent-changes/4242-00000000'
    runGit(repo, 'update-ref', `${stale}/1`, ownShaped)
    runGit(repo, 'update-ref', `${stale}/2`, head)
    runGit(repo, 'update-ref', `${stale}/3`, emptyTree)
    runGit(repo, 'update-ref', 'refs/prompt-ide/agent-changes/foo/1', ownShaped)
    // 生きている pid の自分の形の ref は消さない
    const alive = 'refs/prompt-ide/agent-changes/4243-00000000/1'
    runGit(repo, 'update-ref', alive, ownShaped)
    await invoke('agentChanges:begin', 'send')
    await vi.waitFor(() => expect(protectionRefs()).toContain(REF_1))
    expect(runGit(repo, 'for-each-ref', '--format=%(refname)', 'refs/prompt-ide/')).toBe(
      [`${stale}/2`, `${stale}/3`, alive, REF_1, 'refs/prompt-ide/agent-changes/foo/1']
        .sort()
        .map((name) => `${name}\n`)
        .join('')
    )
  })
})

// 戻す → 取り消すの往復を handler から通す(設計書「取り消しの流れ」の結合)。renderer に渡すのは要約だけで、控えの置き場所は渡さない
describe('戻す → 取り消すの往復(実 git)', () => {
  const undoOfList = async (): Promise<unknown> =>
    ((await invoke('agentChanges:list', ALL)) as { undo: unknown }).undo
  const undoTempDirs = (): string[] =>
    readdirSync(tempRoot).filter((name) => name.startsWith(AGENT_CHANGES_UNDO_TEMP_PREFIX))
  const fileSummary = {
    undoId: 1,
    operation: 'file',
    entries: [{ path: 'a.txt', action: 'rewrite' }]
  }

  beforeEach(async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    await invoke('agentChanges:begin', 'send')
  })

  it('1 ファイルを戻して取り消すと、エージェントの内容に戻り、控えは消える。2 回目の取り消しは拒む', async () => {
    write('a.txt', 'a\nagent\n')
    const reverted = await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(reverted).toEqual({ undo: { kind: 'saved' }, undoSummary: fileSummary })
    expect(JSON.stringify(reverted)).not.toContain(tempRoot)
    expect(readRepoFile(repo, 'a.txt')).toBe('a\n')
    expect(await undoOfList()).toEqual(fileSummary)
    await expect(invoke('agentChanges:undoRevert', 1)).resolves.toEqual({
      status: 'done',
      restoredPaths: ['a.txt'],
      trashedPaths: [],
      undoSummary: null
    })
    expect(readRepoFile(repo, 'a.txt')).toBe('a\nagent\n')
    expect(await undoOfList()).toBeNull()
    expect(await pathsOf(ALL)).toEqual(['a.txt'])
    await expect(invoke('agentChanges:undoRevert', 1)).rejects.toThrow(
      '取り消せる操作が変わりました。一覧を更新してください'
    )
  })

  it('すべて戻すの結果は戻せた件数と all の要約。戻した後に変わったファイルがあれば取り消さずに控えを捨てる', async () => {
    write('a.txt', 'a\nagent\n')
    write('new.txt', 'new\n')
    const result = (await invoke(
      'agentChanges:revertAll',
      [
        { path: 'a.txt', status: 'M' },
        { path: 'new.txt', status: 'A' }
      ],
      ALL
    )) as { undoSummary: { undoId: number } | null }
    expect(result).toEqual({
      status: 'done',
      revertedCount: 2,
      undo: { kind: 'saved' },
      undoSummary: {
        undoId: expect.any(Number),
        operation: 'all',
        entries: [
          { path: 'a.txt', action: 'rewrite' },
          { path: 'new.txt', action: 'recreate' }
        ]
      }
    })
    expect(JSON.stringify(result)).not.toContain(tempRoot)
    write('a.txt', 'later\n')
    await expect(invoke('agentChanges:undoRevert', result.undoSummary?.undoId)).rejects.toThrow(
      '戻した後に変わったファイルがあるため、取り消せません（a.txt）'
    )
    expect(readRepoFile(repo, 'a.txt')).toBe('later\n')
    expect(await undoOfList()).toBeNull()
  })

  // registry → 取り消しの実行 → 注入した trash の配線(ipcHandlers と同じ組み立て)を通す
  it('戻すときに作り直したファイルは、取り消しで trash へ移し、結果の trashedPaths に入れる', async () => {
    write('c.txt', 'c\n')
    commitAll(repo, 'init c')
    await invoke('agentChanges:clear')
    await invoke('agentChanges:begin', 'send')
    rmSync(join(repo, 'c.txt'))
    const reverted = (await invoke('agentChanges:revertFile', 'c.txt', ALL)) as {
      undoSummary: { undoId: number; entries: unknown[] } | null
    }
    expect(reverted.undoSummary?.entries).toEqual([{ path: 'c.txt', action: 'trash' }])
    expect(readRepoFile(repo, 'c.txt')).toBe('c\n')
    await expect(invoke('agentChanges:undoRevert', reverted.undoSummary?.undoId)).resolves.toEqual({
      status: 'done',
      restoredPaths: [],
      trashedPaths: ['c.txt'],
      undoSummary: null
    })
    expect(trash.trashed).toEqual([join(repo, 'c.txt')])
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
  })

  // 取り消しの実行の keepUndo(読み込みの失敗だけ)と、registry の控えを残す規則のつながりを本物同士で通す
  it.skipIf(process.getuid?.() === 0)(
    '読み込めないだけなら取り消さずに控えを残し、読めるようになれば同じ undoId で取り消せる',
    async () => {
      write('sub/s.txt', 's\n')
      commitAll(repo, 'init sub')
      await invoke('agentChanges:clear')
      await invoke('agentChanges:begin', 'send')
      write('sub/s.txt', 's\nagent\n')
      const reverted = (await invoke('agentChanges:revertFile', 'sub/s.txt', ALL)) as {
        undoSummary: { undoId: number } | null
      }
      const undoId = reverted.undoSummary?.undoId
      const sub = join(repo, 'sub')
      chmodSync(sub, 0o600)
      try {
        await expect(invoke('agentChanges:undoRevert', undoId)).rejects.toThrow(
          '取り消しの対象を読み込めませんでした（sub/s.txt）'
        )
      } finally {
        chmodSync(sub, 0o755)
      }
      expect(readRepoFile(repo, 'sub/s.txt')).toBe('s\n')
      expect(await undoOfList()).toEqual(reverted.undoSummary)
      await expect(invoke('agentChanges:undoRevert', undoId)).resolves.toMatchObject({
        status: 'done',
        restoredPaths: ['sub/s.txt']
      })
      expect(readRepoFile(repo, 'sub/s.txt')).toBe('s\nagent\n')
    }
  )

  it('clear の後に控えの一時ディレクトリが残らない', async () => {
    write('a.txt', 'a\nagent\n')
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(undoTempDirs()).toHaveLength(1)
    await invoke('agentChanges:clear')
    expect(undoTempDirs()).toEqual([])
  })
})

describe('戻す操作の吸収(実 git)', () => {
  it('エージェントの変更を行の ↶ で戻した後に、エージェントが同じファイルを書き直しても、利用者の集合に入らない(吸収を外すとこのテストが落ちる)', async () => {
    write('a.txt', 'base\n')
    commitAll(repo, 'base')
    const source = createFakeAttributionSource({ phase: 'idle' })
    rebuildRegistry({}, source)
    const change = (phase: 'idle' | 'agent'): void => {
      source.set({ phase })
      registry.notifyAttributionSignal(1)
    }
    await invoke('agentChanges:begin', 'manual')
    change('agent')
    await registry.waitForAgentPhase(1, new AbortController().signal)
    write('a.txt', 'agent\n')
    change('idle')
    await invoke('agentChanges:list', ALL)
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('base\n')
    change('agent')
    await registry.waitForAgentPhase(1, new AbortController().signal)
    write('a.txt', 'agent again\n')
    change('idle')
    const attribution = await registry.withRecord(1, repo, async (record) => record.attribution)
    expect(attribution).toMatchObject({
      kind: 'tracking',
      userPaths: new Set(),
      agentPaths: new Set(['a.txt'])
    })
  }, 30_000)
})

describe('記録の区別と一覧の author・すべて戻す(実 git)', () => {
  let source: FakeAttributionSource
  const change = (phase: 'idle' | 'agent'): void => {
    source.set({ phase })
    registry.notifyAttributionSignal(1)
  }
  // 並んでいる同期を走らせ終える(列の後ろに何もしないタスクを並べて待つ)
  const settled = async (): Promise<void> => {
    await registry.withRecord(1, repo, async () => undefined)
  }
  // 受け口と同じく、通し番号を進めて段階を agent にしてから区切りを待つ
  const toolStarts = async (): Promise<void> => {
    source.seq += 1
    change('agent')
    await registry.waitForAgentPhase(1, new AbortController().signal)
  }
  const authorsByPath = async (): Promise<Record<string, string | null>> => {
    const result = (await invoke('agentChanges:list', ALL)) as {
      entries: { path: string; author: string | null }[]
    }
    return Object.fromEntries(result.entries.map((entry) => [entry.path, entry.author]))
  }
  // idle の間に利用者が a.txt、agent の間にエージェントが b.txt・c.txt を変え、idle に戻った後(今の区間)に利用者が c.txt・d.txt を変える
  const userAndAgentChanges = async (): Promise<void> => {
    write('a.txt', 'user\n')
    await toolStarts()
    write('b.txt', 'agent\n')
    write('c.txt', 'agent\n')
    change('idle')
    await settled()
    write('c.txt', 'agent\nuser\n')
    write('d.txt', 'user\n')
  }

  beforeEach(async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    source = createFakeAttributionSource({ phase: 'idle' })
    rebuildRegistry({}, source)
    await invoke('agentChanges:begin', 'manual')
  })

  it('idle の間の利用者の変更は user、agent の間のエージェントの変更は agent、両方は mixed。同期の前の今の区間の利用者の編集も user', async () => {
    await userAndAgentChanges()
    expect(await authorsByPath()).toEqual({
      'a.txt': 'user',
      'b.txt': 'agent',
      'c.txt': 'mixed',
      'd.txt': 'user'
    })
  })

  it('すべて戻すは user・mixed の行を戻さず agent の行だけを戻す(除く規則を外すとこのテストが落ちる)', async () => {
    await userAndAgentChanges()
    await expect(
      invoke('agentChanges:revertAll', [{ path: 'b.txt', status: 'M' }], ALL)
    ).resolves.toMatchObject({ status: 'done', revertedCount: 1 })
    expect(readRepoFile(repo, 'a.txt')).toBe('user\n')
    expect(readRepoFile(repo, 'b.txt')).toBe('b\n')
    expect(readRepoFile(repo, 'c.txt')).toBe('agent\nuser\n')
    expect(readRepoFile(repo, 'd.txt')).toBe('user\n')
  })

  it('すべて戻すの確認の一覧に user の行を含めると、中止して何も変えない', async () => {
    await userAndAgentChanges()
    await expect(
      invoke(
        'agentChanges:revertAll',
        [
          { path: 'a.txt', status: 'M' },
          { path: 'b.txt', status: 'M' }
        ],
        ALL
      )
    ).rejects.toThrow(AGENT_REVERT_ALL_MISMATCH_MESSAGE)
    expect(readRepoFile(repo, 'a.txt')).toBe('user\n')
    expect(readRepoFile(repo, 'b.txt')).toBe('agent\n')
    expect(readRepoFile(repo, 'c.txt')).toBe('agent\nuser\n')
    expect(readRepoFile(repo, 'd.txt')).toBe('user\n')
  })

  it('行の ↶ で戻した後にエージェントが同じファイルを書き直しても、一覧で mixed にならない(戻す操作は利用者の変更に数えない)', async () => {
    await toolStarts()
    write('a.txt', 'agent\n')
    change('idle')
    await settled()
    await invoke('agentChanges:revertFile', 'a.txt', ALL)
    expect(readRepoFile(repo, 'a.txt')).toBe('a\n')
    await toolStarts()
    write('a.txt', 'agent again\n')
    change('idle')
    await settled()
    expect(await authorsByPath()).toEqual({ 'a.txt': 'agent' })
  }, 30_000)

  it('判定の区切りの object が gc で消えて区別をやめた記録も、一覧は出て要約は lost(それまでの印は残る)', async () => {
    write('a.txt', 'user\n')
    await toolStarts()
    write('b.txt', 'agent\n')
    // 判定の区切りは保護の ref で守らない。次の区切り(写しの元は gc で消えた区切り)を取れずに区別をやめる
    runGit(repo, 'gc', '-q', '--prune=now')
    change('idle')
    await settled()
    const result = (await invoke('agentChanges:list', ALL)) as {
      kind: string
      attribution: unknown
      entries: { path: string; author: string | null }[]
    }
    expect(result).toMatchObject({
      kind: 'recording',
      attribution: { kind: 'lost', reason: 'checkpoint-failed', hadMarks: true }
    })
    expect(Object.fromEntries(result.entries.map((entry) => [entry.path, entry.author]))).toEqual({
      'a.txt': 'user',
      'b.txt': 'agent'
    })
  })
})
