import { describe, it, expect, afterEach, vi } from 'vitest'
import { devNull } from 'node:os'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createAgentBaselineRepo,
  createFakeTrash,
  disposeAgentBaselineRepo,
  EMPTY_TREE,
  makeAgentChangesRecord,
  makeBaselineSnapshot,
  recordBaseline,
  recordedSnapshot,
  userRepoState
} from './agentBaselineFixtures'
import type { AgentBaselineRepo } from './agentBaselineFixtures'
import { commitAll, runGit, writeRepoFile } from './realGitRepo'

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
      undo: null
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
      undo: null
    })
  })
})

describe('makeBaselineSnapshot', () => {
  it('既定値で埋める', () => {
    expect(makeBaselineSnapshot()).toEqual({
      folderPath: '/repo',
      tempDir: '/tmp/baseline',
      indexPath: '/tmp/baseline/index',
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
    await expect(recordBaseline(dirs.home, dirs.tempRoot)).rejects.toThrow('記録できなかった')
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
