import { describe, it, expect, afterEach, vi } from 'vitest'
import { devNull } from 'node:os'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  attributionOffRecordingState,
  attributionOffSummary,
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  createFakeTrash,
  disposeAgentBaselineRepo,
  EMPTY_TREE,
  firstHunkPatch,
  folderChangesExcept,
  folderEntries,
  makeAgentChangesRecord,
  makeAttributionOffDeps,
  makeBaselineSnapshot,
  makeRevertContext,
  makeTrackingAttribution,
  numberedLines,
  recordBaseline,
  recordedSnapshot,
  userRepoState
} from './agentBaselineFixtures'
import type { AgentBaselineRepo } from './agentBaselineFixtures'
import { commitAll, runGit, writeRepoFile } from './realGitRepo'
import { AGENT_CHANGES_UNDO_MAX_BYTES } from '../../agentChangesUndo'
import type { AgentChangeEntry } from '@shared/types'

describe('makeAgentChangesRecord', () => {
  it('既定は makeBaselineSnapshot() の始点で、次の番号は実行の数 + 1', () => {
    const runs = [{ runId: 1, number: 1, start: { kind: 'baseline' as const } }]
    expect(makeAgentChangesRecord(runs)).toEqual({
      baseline: makeBaselineSnapshot(),
      runs,
      nextNumber: 2,
      recordSerial: 1,
      protection: {
        refName: 'refs/prompt-ide/agent-changes/1-00000000/1',
        value: null,
        swept: false
      },
      undo: null,
      attribution: makeTrackingAttribution(makeBaselineSnapshot())
    })
  })

  it('保護の ref の名前の既定は、上書きした記録の番号に追従する', () => {
    expect(makeAgentChangesRecord([], { recordSerial: 3 }).protection.refName).toBe(
      'refs/prompt-ide/agent-changes/1-00000000/3'
    )
  })

  it('始点と次の番号を上書きする', () => {
    const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base' })
    expect(makeAgentChangesRecord([], { baseline, nextNumber: 9 })).toEqual({
      baseline,
      runs: [],
      nextNumber: 9,
      recordSerial: 1,
      protection: {
        refName: 'refs/prompt-ide/agent-changes/1-00000000/1',
        value: null,
        swept: false
      },
      undo: null,
      attribution: makeTrackingAttribution(baseline)
    })
  })
})

describe('makeBaselineSnapshot', () => {
  it('既定値で埋める', () => {
    expect(makeBaselineSnapshot()).toEqual({
      folderPath: '/repo',
      tempDir: '/tmp/baseline',
      indexPath: '/tmp/baseline/index',
      gitDir: null,
      startedAt: 0,
      head: null,
      tree: EMPTY_TREE,
      excluded: [],
      skippedRepos: [],
      ignoredAtBaseline: []
    })
  })

  it('渡したフィールドだけを上書きする', () => {
    const excluded = [{ path: 'big.bin', size: 1, mtimeMs: 0, dev: 1, ino: 2 }]
    expect(
      makeBaselineSnapshot({ folderPath: '/f', startedAt: 42, head: 'abc', excluded })
    ).toEqual({
      folderPath: '/f',
      tempDir: '/tmp/baseline',
      indexPath: '/tmp/baseline/index',
      gitDir: null,
      startedAt: 42,
      head: 'abc',
      tree: EMPTY_TREE,
      excluded,
      skippedRepos: [],
      ignoredAtBaseline: []
    })
  })

  it('tempDir を上書きすると indexPath も tempDir/index に追従する', () => {
    expect(makeBaselineSnapshot({ tempDir: '/t/1' })).toMatchObject({
      tempDir: '/t/1',
      indexPath: '/t/1/index'
    })
  })

  it('indexPath を明示すれば tempDir より優先する', () => {
    expect(makeBaselineSnapshot({ tempDir: '/t/1', indexPath: '/other/index' })).toMatchObject({
      tempDir: '/t/1',
      indexPath: '/other/index'
    })
  })

  it('呼ぶたびに別の配列を返す(テスト間で共有しない)', () => {
    const a = makeBaselineSnapshot()
    const b = makeBaselineSnapshot()
    expect(a.excluded).not.toBe(b.excluded)
    expect(a.skippedRepos).not.toBe(b.skippedRepos)
    expect(a.ignoredAtBaseline).not.toBe(b.ignoredAtBaseline)
  })
})

describe('makeAttributionOffDeps', () => {
  it('区別をやめる合図(receiver-unavailable)の追跡・空の差分・ログなしの依存を、呼ぶたびに新しく作る', async () => {
    const deps = makeAttributionOffDeps()
    expect(deps.attributionSource.activityOf(1)).toEqual({
      phase: 'paused',
      lost: 'receiver-unavailable',
      unassignable: false
    })
    expect(deps.attributionSource.toolStartSeqOf(1)).toBe(0)
    const snapshot = makeBaselineSnapshot()
    await expect(deps.collectBetween(snapshot, snapshot)).resolves.toEqual([])
    await expect(deps.collectCurrent(snapshot)).resolves.toEqual([])
    expect(deps.attributionDevLog).toBeNull()
    expect(() => deps.attributionWarn('失敗', new Error('boom'))).not.toThrow()
    expect(makeAttributionOffDeps().attributionSource).not.toBe(deps.attributionSource)
  })
})

describe('createFakeTrash', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('渡されたパスを順に控え、作業ツリーから取り除く(ファイルとフォルダ)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-trash-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'a.txt'), 'a')
    mkdirSync(join(dir, 'd'))
    writeFileSync(join(dir, 'd', 'b.txt'), 'b')
    const { trash, trashed } = createFakeTrash()
    expect(trashed).toEqual([])
    await trash(join(dir, 'd'))
    await trash(join(dir, 'a.txt'))
    expect(trashed).toEqual([join(dir, 'd'), join(dir, 'a.txt')])
    expect(existsSync(join(dir, 'd'))).toBe(false)
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
  })

  it('偽物ごとに控えを分ける', async () => {
    const first = createFakeTrash()
    const second = createFakeTrash()
    await first.trash(join(tmpdir(), 'fake-trash-missing-x'))
    expect(first.trashed).toHaveLength(1)
    expect(second.trashed).toEqual([])
  })
})

describe('createAgentBaselineRepo / disposeAgentBaselineRepo', () => {
  let dirs: AgentBaselineRepo | null = null
  afterEach(() => {
    if (dirs !== null) disposeAgentBaselineRepo(dirs)
    dirs = null
    vi.unstubAllEnvs()
  })

  it('realpath 済みの初期化したリポジトリと、home・tempRoot の一時ディレクトリを作る', () => {
    dirs = createAgentBaselineRepo('baseline-fixtures-')
    expect(dirs.repo).toBe(realpathSync(dirs.repo))
    expect(runGit(dirs.repo, 'symbolic-ref', 'HEAD').trim()).toBe('refs/heads/main')
    expect(existsSync(dirs.home)).toBe(true)
    expect(existsSync(dirs.tempRoot)).toBe(true)
    expect(new Set([dirs.repo, dirs.home, dirs.tempRoot]).size).toBe(3)
  })

  it('stubIsolatedGitEnv と stubGitHome の両方で、対象の git を開発者の設定から切り離す', () => {
    dirs = createAgentBaselineRepo('baseline-fixtures-')
    expect(process.env.GIT_CONFIG_GLOBAL).toBe(devNull)
    expect(process.env.GIT_CONFIG_NOSYSTEM).toBe('1')
    expect(process.env.HOME).toBe(dirs.home)
    expect(process.env.XDG_CONFIG_HOME).toBe(dirs.home)
  })

  it('後始末で 3 つのディレクトリを消し、環境変数を戻す', () => {
    const homeBefore = process.env.HOME
    const created = createAgentBaselineRepo('baseline-fixtures-')
    disposeAgentBaselineRepo(created)
    expect(existsSync(created.repo)).toBe(false)
    expect(existsSync(created.home)).toBe(false)
    expect(existsSync(created.tempRoot)).toBe(false)
    expect(process.env.HOME).toBe(homeBefore)
  })
})

describe('recordBaseline / recordedSnapshot / userRepoState(実 git)', () => {
  let dirs: AgentBaselineRepo
  afterEach(() => disposeAgentBaselineRepo(dirs))

  it('記録を取って snapshot を返す', async () => {
    dirs = createAgentBaselineRepo('baseline-fixtures-')
    writeRepoFile(dirs.repo, 'a.txt', 'a\n')
    commitAll(dirs.repo, 'init')
    const snapshot = await recordBaseline(dirs.repo, dirs.tempRoot)
    expect(snapshot.folderPath).toBe(dirs.repo)
    expect(snapshot.tempDir.startsWith(dirs.tempRoot)).toBe(true)
  })

  it('recorded でなければ例外にする', async () => {
    dirs = createAgentBaselineRepo('baseline-fixtures-')
    expect(() => recordedSnapshot({ kind: 'canceled' })).toThrow('記録できなかった')
    // .git の中は記録できない(inside-git-dir。Git 管理外のフォルダは隠れた git で記録できるため、HOME では例外にならない)
    await expect(recordBaseline(join(dirs.repo, '.git'), dirs.tempRoot)).rejects.toThrow(
      '記録できなかった'
    )
  })

  it('利用者の index が変われば userRepoState も変わる', () => {
    dirs = createAgentBaselineRepo('baseline-fixtures-')
    writeRepoFile(dirs.repo, 'a.txt', 'a\n')
    commitAll(dirs.repo, 'init')
    const before = userRepoState(dirs.repo)
    expect(userRepoState(dirs.repo)).toEqual(before)
    writeRepoFile(dirs.repo, 'b.txt', 'b\n')
    runGit(dirs.repo, 'add', 'b.txt')
    expect(userRepoState(dirs.repo)).not.toEqual(before)
  })
})

describe('attributionOffSummary', () => {
  it('makeAttributionOffDeps の registry の記録の区別の要約(receiver-unavailable・lostAt は始点の時刻・集合なし)', () => {
    expect(attributionOffSummary(42)).toEqual({
      kind: 'lost',
      reason: 'receiver-unavailable',
      lostAt: 42,
      hadMarks: false,
      since: null,
      hadUnassignedSince: false
    })
  })
})

describe('attributionOffRecordingState', () => {
  it('既定は実行なし・取り消しの控えなしで、区別の要約は attributionOffSummary(始点の時刻)', () => {
    expect(attributionOffRecordingState(42)).toEqual({
      kind: 'recording',
      startedAt: 42,
      runs: [],
      undo: null,
      attribution: attributionOffSummary(42),
      storage: 'repository'
    })
  })

  it('実行・取り消しの控えを上書きできる', () => {
    const runs = [
      {
        runId: 1,
        number: 1,
        startedAt: 42,
        endedAt: null,
        availability: { kind: 'available' as const }
      }
    ]
    const undo = { undoId: 1, operation: 'file' as const, entries: [] }
    expect(attributionOffRecordingState(42, { runs, undo })).toMatchObject({ runs, undo })
  })
})

describe('createAgentNonGitFolder / folderEntries', () => {
  let dirs: AgentBaselineRepo | null = null

  afterEach(() => {
    if (dirs !== null) disposeAgentBaselineRepo(dirs)
    dirs = null
  })

  it('realpath 済みの Git 管理外のフォルダ(.git が無い)を作る', () => {
    dirs = createAgentNonGitFolder('baseline-fixtures-plain-')
    expect(dirs.repo).toBe(realpathSync(dirs.repo))
    expect(existsSync(join(dirs.repo, '.git'))).toBe(false)
  })

  it('上のフォルダのリポジトリを拾わないよう、GIT_CEILING_DIRECTORIES をフォルダの親にする', () => {
    dirs = createAgentNonGitFolder('baseline-fixtures-plain-')
    expect(process.env.GIT_CEILING_DIRECTORIES).toBe(dirname(dirs.repo))
  })

  it('disposeAgentBaselineRepo で 3 つのディレクトリを消す', () => {
    const created = createAgentNonGitFolder('baseline-fixtures-plain-')
    disposeAgentBaselineRepo(created)
    expect(existsSync(created.repo)).toBe(false)
    expect(existsSync(created.home)).toBe(false)
    expect(existsSync(created.tempRoot)).toBe(false)
  })

  it('folderEntries はフォルダの中のパスを再帰で並べ、中身が変わると値が変わる', () => {
    dirs = createAgentNonGitFolder('baseline-fixtures-plain-')
    mkdirSync(join(dirs.repo, 'd'))
    writeFileSync(join(dirs.repo, 'd', 'x.txt'), 'x')
    writeFileSync(join(dirs.repo, 'a.txt'), 'a')
    const before = folderEntries(dirs.repo)
    expect(Object.keys(before).sort()).toEqual(['a.txt', 'd', 'd/x.txt'])
    writeFileSync(join(dirs.repo, 'd', 'x.txt'), 'xx')
    const after = folderEntries(dirs.repo)
    expect(after['d/x.txt']).not.toBe(before['d/x.txt'])
    expect(after['a.txt']).toBe(before['a.txt'])
  })
})

describe('folderChangesExcept', () => {
  const before = { a: 'file 1', d: 'dir 1', 'd/x': 'file 1', 'd/y': 'file 1', z: 'file 1' }

  it('変えたパス・その中・その祖先のフォルダの違いを除く', () => {
    const after = { a: 'file 1', d: 'dir 2', 'd/x': 'file 2', 'd/y': 'file 1', z: 'file 1' }
    expect(folderChangesExcept(before, after, ['d/x'])).toEqual([])
    const inside = { ...before, d: 'dir 2', 'd/x': 'file 2', 'd/y': 'file 2' }
    expect(folderChangesExcept(before, inside, ['d'])).toEqual([])
  })

  it('それ以外の変更・追加・削除を並べて返す', () => {
    const after = { a: 'file 2', d: 'dir 1', 'd/x': 'file 1', 'd/y': 'file 1', n: 'file 1' }
    expect(folderChangesExcept(before, after, ['d/x'])).toEqual(['a', 'n', 'z'])
  })
})

describe('makeRevertContext', () => {
  const snapshot = makeBaselineSnapshot()
  const trash = async (): Promise<void> => undefined

  it('既定は本番の控えの上限で、gitOptions を置かず、attributeEntries は行をそのまま返す', async () => {
    const context = makeRevertContext(snapshot, { trash, tempRoot: '/tmp/undo' })
    expect(context).toEqual({
      snapshot,
      trash,
      undoCapture: { tempRoot: '/tmp/undo', maxBytes: AGENT_CHANGES_UNDO_MAX_BYTES },
      attributeEntries: expect.any(Function)
    })
    expect('gitOptions' in context).toBe(false)
    const entries: AgentChangeEntry[] = [
      { path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false, author: null }
    ]
    expect(await context.attributeEntries(entries)).toBe(entries)
  })

  it('控えの上限と gitOptions を渡せば、その値にする(gitOptions の env が undefined でも欄を置く)', () => {
    const context = makeRevertContext(snapshot, {
      trash,
      tempRoot: '/tmp/undo',
      maxBytes: 10,
      gitOptions: { env: undefined }
    })
    expect(context.undoCapture).toEqual({ tempRoot: '/tmp/undo', maxBytes: 10 })
    expect(context.gitOptions).toEqual({ env: undefined })
    expect('gitOptions' in context).toBe(true)
  })
})

describe('numberedLines / firstHunkPatch', () => {
  it('numberedLines は l1〜ln の行(末尾に改行)で、replace の行番号(1 始まり)だけ差し替える', () => {
    expect(numberedLines(3)).toBe('l1\nl2\nl3\n')
    expect(numberedLines(3, { 2: 'X' })).toBe('l1\nX\nl3\n')
  })

  it('firstHunkPatch はヘッダーと 1 つ目の @@ の節だけを返す', () => {
    const header = 'diff --git a/d.txt b/d.txt\n--- a/d.txt\n+++ b/d.txt\n'
    const first = '@@ -1,3 +1,3 @@\n l1\n-l2\n+A2\n'
    const second = '@@ -17,3 +17,3 @@\n l17\n-l18\n+A18\n'
    expect(firstHunkPatch(header + first + second)).toBe(header + first)
  })
})
