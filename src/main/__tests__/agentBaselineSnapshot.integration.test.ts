import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { createBaselineGit } from '../agentBaselineGit'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import {
  commitAll,
  initRepo,
  killRecordedProcess,
  runGit,
  writeRepoFile
} from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  disposeAgentBaselineRepo,
  recordedSnapshot,
  userRepoState
} from './helpers/agentBaselineFixtures'

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('baseline-snapshot-'))
})

afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

const baselinePaths = async (snapshot: BaselineSnapshot): Promise<string[]> =>
  (await createBaselineGit(repo, snapshot.indexPath).raw(['ls-files', '-z']))
    .split('\0')
    .filter((path) => path !== '')

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD)
const userState = (): unknown => userRepoState(repo)

describe('takeBaselineSnapshot(実 git)', () => {
  it('利用者の index・stash・ref・HEAD を変えずに、未コミットの変更と未追跡を含めて記録する(確認の結果 2)', async () => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('.gitignore', 'ignored/\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nunstaged\n')
    write('b.txt', 'b\nstaged\n')
    runGit(repo, 'add', 'b.txt')
    write('user-untracked.txt', 'u\n')
    write('ignored/x', 'x\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, now: () => 1234 })
    )
    expect(userState()).toEqual(before)
    expect(await baselinePaths(snapshot)).toEqual([
      '.gitignore',
      'a.txt',
      'b.txt',
      'user-untracked.txt'
    ])
    expect(snapshot).toMatchObject({
      folderPath: repo,
      startedAt: 1234,
      head: runGit(repo, 'rev-parse', 'HEAD').trim(),
      excluded: []
    })
    // 記録のインデックスはアプリの一時ディレクトリ(0700)にあり、.git の中には無い
    expect(snapshot.tempDir.startsWith(tempRoot)).toBe(true)
    expect(statSync(snapshot.tempDir).mode & 0o777).toBe(0o700)
    expect(existsSync(snapshot.indexPath)).toBe(true)
  })

  it('Git 管理外のフォルダは not-repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'baseline-plain-'))
    try {
      const result = await takeBaselineSnapshot(plain, { tempRoot })
      expect(result).toEqual({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'not-repository' }
      })
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('リポジトリのサブフォルダは not-toplevel', async () => {
    write('sub/a.txt', 'a\n')
    commitAll(repo, 'init')
    const result = await takeBaselineSnapshot(join(repo, 'sub'), { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'not-toplevel' }
    })
  })

  it('コミットが無いリポジトリ(.git/index が無い)でも記録でき、HEAD は null(確認の結果 15)', async () => {
    write('a.txt', 'a\n')
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
    expect(snapshot.head).toBeNull()
    expect(await baselinePaths(snapshot)).toEqual(['a.txt'])
    expect(existsSync(join(repo, '.git/index'))).toBe(false)
  })

  it('入れ子のリポジトリは gitlink(mode 160000)として記録する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    commitAll(nested, 's')
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
    const staged = await createBaselineGit(repo, snapshot.indexPath).raw(['ls-files', '-s', 'sub'])
    expect(staged.startsWith('160000 ')).toBe(true)
  })

  it('worktree(.git がファイル)では、その worktree の index を写す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const worktree = join(realpathSync(tempRoot), 'wt')
    runGit(repo, 'worktree', 'add', '-q', worktree)
    writeRepoFile(worktree, 'w.txt', 'w\n')
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(worktree, { tempRoot }))
    const listed = await createBaselineGit(worktree, snapshot.indexPath).raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt', 'w.txt'])
  })

  it('5MB を超える未追跡のファイルは記録から除外し、大きさと更新時刻を控える', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    write('small.txt', 's\n')
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
    expect(await baselinePaths(snapshot)).toEqual(['a.txt', 'small.txt'])
    const stat = statSync(join(repo, 'big.bin'))
    expect(snapshot.excluded).toEqual([
      {
        path: 'big.bin',
        size: 6 * 1024 * 1024,
        mtimeMs: stat.mtimeMs,
        dev: stat.dev,
        ino: stat.ino
      }
    ])
  })

  // PR #47 レビュー A-1: 記録の時点の ignore 済みの一覧(.gitignore・.git/info/exclude。ignore されたフォルダは 1 行)
  it('記録の時点に ignore されていた未追跡のファイル・フォルダを控える(追跡中・ignore されていないものは入れない)', async () => {
    write('.gitignore', '.env\nnode_modules/\n*.log\n')
    write('tracked.log', 't\n')
    runGit(repo, 'add', '-f', 'tracked.log')
    commitAll(repo, 'init')
    write('.git/info/exclude', 'local.db\n')
    write('.env', 'S\n')
    write('local.db', 'd\n')
    write('node_modules/x/i.js', 'i\n')
    write('src/a.log', 'l\n')
    write('src/keep.txt', 'k\n')
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
    expect([...snapshot.ignoredAtBaseline].sort()).toEqual([
      '.env',
      'local.db',
      'node_modules/',
      'src/a.log'
    ])
  })

  it('未追跡のファイルが 5,000 件を超えると記録せず、件数を返す', async () => {
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i <= 5_000; i++) writeFileSync(join(repo, 'many', `${i}.txt`), '')
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('除外の後の未追跡の合計が 100MB を超えると記録せず、件数と合計を返す', async () => {
    // 5MB ちょうど(除外しない)の疎なファイルを 21 個 = 105MB
    for (let i = 0; i < 21; i++) {
      write(`f${i}.bin`, '')
      truncateSync(join(repo, `f${i}.bin`), 5 * 1024 * 1024)
    }
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 21,
        untrackedBytes: 21 * 5 * 1024 * 1024
      }
    })
  })

  it('git add が打ち切りの時間を超えたら timeout を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const pidFile = join(home, 'filter.pid')
    // clean filter(LFS などと同じ仕組み)が止まったままの状況を作る
    runGit(repo, 'config', 'filter.slow.clean', `sh -c 'echo $$ > ${pidFile}; exec sleep 5'`)
    write('.gitattributes', '*.slow filter=slow\n')
    write('x.slow', 'x\n')
    try {
      const result = await takeBaselineSnapshot(repo, { tempRoot, timeoutMs: 300 })
      expect(result).toEqual({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'timeout' }
      })
      expect(readdirSync(tempRoot)).toEqual([])
    } finally {
      await killRecordedProcess(pidFile, 1_000)
    }
  })

  it('git を実行できなければ git-failed', async () => {
    vi.stubEnv('PATH', join(home, 'no-bin'))
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
    '%i 回目の確認で取り消されたら canceled を返し、一時ディレクトリを残さない(パターン 141)',
    async (cancelAt) => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      let calls = 0
      const result = await takeBaselineSnapshot(repo, {
        tempRoot,
        isCanceled: () => ++calls >= cancelAt
      })
      expect(result).toEqual({ kind: 'canceled' })
      expect(readdirSync(tempRoot)).toEqual([])
    }
  )

  // 確認は 10 か所(リポジトリか・最上位・写しの元・写し・未追跡の検査・pathspec の書き込み・add・ignore 済みの一覧・HEAD・tree の後)。
  // 取り消されなければ記録が返る
  it('10 回の確認のどれでも取り消されなければ記録を返す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    let calls = 0
    const result = await takeBaselineSnapshot(repo, { tempRoot, isCanceled: () => ++calls >= 11 })
    expect(result.kind).toBe('recorded')
    expect(calls).toBe(10)
  })

  it('HEAD の無い入れ子のリポジトリがあっても記録でき、そのディレクトリは記録に入れない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'emptyrepo')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 'n.txt', 'n\n')
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
    expect(await baselinePaths(snapshot)).toEqual(['a.txt'])
    expect(snapshot.skippedRepos).toEqual(['emptyrepo/'])
  })

  it('未追跡のファイルがちょうど 5,000 件なら記録できる', async () => {
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i < 5_000; i++) writeFileSync(join(repo, 'many', `${i}.txt`), '')
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result.kind).toBe('recorded')
  })

  it('除外の後の未追跡の合計がちょうど 100MiB なら記録できる', async () => {
    for (let i = 0; i < 20; i++) {
      write(`f${i}.bin`, '')
      truncateSync(join(repo, `f${i}.bin`), 5 * 1024 * 1024)
    }
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result.kind).toBe('recorded')
  })

  it('core.splitIndex=true の利用者でも、利用者の .git にファイルを増やさない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    runGit(repo, 'config', 'core.splitIndex', 'true')
    runGit(repo, 'update-index', '--split-index')
    write('b.txt', 'b\n')
    const gitFiles = (): string[] => readdirSync(join(repo, '.git')).sort()
    const before = gitFiles()
    const snapshot = recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot }))
    expect(gitFiles()).toEqual(before)
    expect(await baselinePaths(snapshot)).toEqual(['a.txt', 'b.txt'])
  })

  it('末尾が空白のフォルダ名でも記録できる', async () => {
    const spaced = join(realpathSync(home), 'trail ')
    mkdirSync(spaced)
    initRepo(spaced)
    writeRepoFile(spaced, 'a.txt', 'a\n')
    const result = await takeBaselineSnapshot(spaced, { tempRoot })
    expect(result.kind).toBe('recorded')
  })

  it('HEAD の取得が打ち切りになったら、コミット無しとせず timeout を返す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const realGit = execFileSync('which', ['git']).toString().trim()
    const bin = join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--verify" ] && exec sleep 5; done\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 }
    )
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    const result = await takeBaselineSnapshot(repo, { tempRoot, timeoutMs: 500 })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })
})

describe('takeBaselineSnapshot の tree と区切り(baseIndexPath)(実 git)', () => {
  const takeFrom = async (base?: BaselineSnapshot): Promise<BaselineSnapshot> =>
    recordedSnapshot(await takeBaselineSnapshot(repo, { tempRoot, baseIndexPath: base?.indexPath }))
  const treePaths = (tree: string): string[] =>
    runGit(repo, 'ls-tree', '-r', '--name-only', tree)
      .split('\n')
      .filter((path) => path !== '')
  // 偽の git: 引数に word があれば script を実行し、それ以外は本物の git に渡す
  const fakeGitOn = (word: string, script: string): void => {
    const realGit = execFileSync('which', ['git']).toString().trim()
    const bin = join(home, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${word}" ] && ${script}; done\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 }
    )
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  }

  it('記録のインデックスから作った tree を控え、利用者の index・stash・ref・HEAD を変えない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nb\n')
    write('n.txt', 'n\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    const snapshot = await takeFrom()
    expect(userState()).toEqual(before)
    expect(snapshot.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(runGit(repo, 'cat-file', '-t', snapshot.tree).trim()).toBe('tree')
    expect(treePaths(snapshot.tree)).toEqual(['a.txt', 'n.txt'])
  })

  it('区切りは直前の記録のインデックスを写し、利用者の index を変えずに、直前の記録の後の変更を入れる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const first = await takeFrom()
    write('a.txt', 'a\nrun1\n')
    write('new.txt', 'n\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    const second = await takeFrom(first)
    expect(userState()).toEqual(before)
    expect(second.tempDir).not.toBe(first.tempDir)
    expect(await baselinePaths(second)).toEqual(['a.txt', 'new.txt'])
    expect(
      runGit(repo, 'diff-tree', '-r', '--name-status', '--no-renames', first.tree, second.tree)
        .trim()
        .split('\n')
    ).toEqual(['M\ta.txt', 'A\tnew.txt'])
  })

  it('区切りの未追跡の事前の検査も、利用者の index で数える(累積の始点と同じ基準)', async () => {
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i < 5_000; i++) writeFileSync(join(repo, 'many', `${i}.txt`), '')
    const first = await takeFrom()
    write('one-more.txt', 'x\n')
    // 前の記録に入った 5,000 件も数えるため、5,001 件で記録できない
    expect(await takeBaselineSnapshot(repo, { tempRoot, baseIndexPath: first.indexPath })).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-untracked',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(tempRoot)).toEqual([first.tempDir.slice(tempRoot.length + 1)])
  })

  it('写しの元が無ければ空から始めず git-failed にし、一時ディレクトリを残さない(L-002)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const first = await takeFrom()
    rmSync(first.tempDir, { recursive: true, force: true })
    const result = await takeBaselineSnapshot(repo, { tempRoot, baseIndexPath: first.indexPath })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  // racy-git の守り: git は記録のインデックスの更新時刻以上の更新時刻を持つエントリを中身まで比べる。写しの更新時刻が
  // 写した時刻になると、写しの元を書いたのと同じ秒に同じ大きさで書き換えた変更を stat の一致で見落とす。
  // 同じ秒の書き換えを決定的に作るため、ファイルと写しの元の更新時刻を固定の秒にそろえ、ctime の比較を外す
  const RACY_SECOND = 1_700_000_000
  const setRacyMtime = (path: string): void => utimesSync(path, RACY_SECOND, RACY_SECOND)

  it('区切りの写しは写しの元の更新時刻を引き継ぎ、写しの元と同じ秒に同じ大きさで書き換えた変更も入れる(racy-git)', async () => {
    runGit(repo, 'config', 'core.trustctime', 'false')
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await takeFrom()
    write('a.txt', 'one\n')
    setRacyMtime(join(repo, 'a.txt'))
    const run2 = await takeFrom(baseline)
    // run2 の記録のインデックスを a.txt と同じ秒に書いた状況にする
    setRacyMtime(run2.indexPath)
    write('a.txt', 'ONE\n')
    setRacyMtime(join(repo, 'a.txt'))
    const run3 = await takeFrom(run2)
    expect(
      runGit(repo, 'diff-tree', '-r', '--name-status', '--no-renames', run2.tree, run3.tree).trim()
    ).toBe('M\ta.txt')
  })

  it('累積の始点の写しも .git/index の更新時刻を引き継ぎ、同じ秒に同じ大きさで書き換えた変更を入れる(racy-git)', async () => {
    runGit(repo, 'config', 'core.trustctime', 'false')
    write('a.txt', 'one\n')
    setRacyMtime(join(repo, 'a.txt'))
    commitAll(repo, 'init')
    // 利用者の index を a.txt と同じ秒に書いた状況にする(この後は利用者の index を書き換える git を走らせない)
    setRacyMtime(join(repo, '.git', 'index'))
    write('a.txt', 'ONE\n')
    setRacyMtime(join(repo, 'a.txt'))
    const snapshot = await takeFrom()
    expect(runGit(repo, 'cat-file', '-p', `${snapshot.tree}:a.txt`)).toBe('ONE\n')
  })

  it('write-tree が打ち切りの時間を超えたら timeout を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    fakeGitOn('write-tree', 'exec sleep 5')
    const result = await takeBaselineSnapshot(repo, { tempRoot, timeoutMs: 500 })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('write-tree が失敗したら git-failed を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    fakeGitOn('write-tree', 'exit 1')
    const result = await takeBaselineSnapshot(repo, { tempRoot })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })

  // 未確認事項 2・3。計画の時点に git 2.50.1 の CLI で同じ手順を再現し、同じ tree になることを確かめた
  it('写しの元を直前の記録にしても .git/index から作っても同じ tree になる(未追跡・削除・ignore・入れ子のリポジトリ・5MB を超える新しいファイル)', async () => {
    write('a.txt', 'one\n')
    write('b.txt', 'b\n')
    write('.gitignore', 'ign/\n')
    commitAll(repo, 'init')
    write('user-untracked.txt', 'u\n')
    write('ign/x', 'i\n')
    const first = await takeFrom()
    write('a.txt', 'one\ntwo\n')
    unlinkSync(join(repo, 'b.txt'))
    write('new.txt', 'n\n')
    write('ign/y', 'j\n')
    write('bignew.bin', '')
    truncateSync(join(repo, 'bignew.bin'), 6 * 1024 * 1024)
    const nested = join(repo, 'nested')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 'z.txt', 'z\n')
    commitAll(nested, 'z')
    const empty = join(repo, 'emptyrepo')
    mkdirSync(empty)
    initRepo(empty)
    writeRepoFile(empty, 'n.txt', 'n\n')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
    expect(fromRecord.excluded.map((file) => file.path)).toEqual(['bignew.bin'])
    expect(fromUserIndex.excluded.map((file) => file.path)).toEqual(['bignew.bin'])
    expect(fromRecord.skippedRepos).toEqual(['emptyrepo/'])
    expect(fromUserIndex.skippedRepos).toEqual(['emptyrepo/'])
  })

  it('intent-to-add のエントリがあっても記録でき(write-tree が失敗しない)、どちらの写しの元でも同じ tree になる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('ita0.txt', 'ita0\n')
    runGit(repo, 'add', '-N', 'ita0.txt')
    const first = await takeFrom()
    write('ita1.txt', 'ita1\n')
    runGit(repo, 'add', '-N', 'ita1.txt')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
    expect(treePaths(fromRecord.tree)).toEqual(['a.txt', 'ita0.txt', 'ita1.txt'])
  })

  it('コンフリクト中のエントリがあっても記録でき、どちらの写しの元でも同じ tree になる(作業ツリーに残す・消す)', async () => {
    write('f.txt', 'base\n')
    commitAll(repo, 'base')
    runGit(repo, 'checkout', '-qb', 'other')
    write('f.txt', 'other\n')
    commitAll(repo, 'other')
    runGit(repo, 'checkout', '-q', 'main')
    write('f.txt', 'mine\n')
    commitAll(repo, 'mine')
    const first = await takeFrom()
    expect(() => runGit(repo, 'merge', '-q', 'other')).toThrow()
    expect(runGit(repo, 'ls-files', '-u').trim()).not.toBe('')
    const kept = await takeFrom(first)
    expect(kept.tree).toBe((await takeFrom()).tree)
    unlinkSync(join(repo, 'f.txt'))
    const removed = await takeFrom(kept)
    expect(removed.tree).toBe((await takeFrom()).tree)
  })

  it('前の記録に入った未追跡のファイルが 5MB を超えて大きくなったら、区切りでは除外され、.git/index から作った場合と同じ tree・excluded になる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('log.txt', 'small\n')
    const first = await takeFrom()
    expect(await baselinePaths(first)).toEqual(['a.txt', 'log.txt'])
    truncateSync(join(repo, 'log.txt'), 6 * 1024 * 1024)
    const before = userState()
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(userState()).toEqual(before)
    expect(await baselinePaths(fromRecord)).toEqual(['a.txt'])
    expect(fromRecord.excluded.map((file) => file.path)).toEqual(['log.txt'])
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
    expect(fromRecord.excluded).toEqual(fromUserIndex.excluded)
  })

  // 計画の時点の実測では写しの元によって tree が違ったが、除外の判定を利用者の index にそろえ、記録のインデックスから外すため同じになる
  it('前の記録で追跡していた 5MB を超えるファイルを利用者が git rm --cached すると、区切りでも除外し、.git/index から作った場合と同じ tree になる', async () => {
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    commitAll(repo, 'big')
    const first = await takeFrom()
    runGit(repo, 'rm', '-q', '--cached', 'big.bin')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(await baselinePaths(fromRecord)).toEqual([])
    expect(fromRecord.excluded.map((file) => file.path)).toEqual(['big.bin'])
    expect(await baselinePaths(fromUserIndex)).toEqual([])
    expect(fromUserIndex.excluded.map((file) => file.path)).toEqual(['big.bin'])
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
  })

  // ローカルレビュー第 1 周の指摘 1。写しの元に追跡中として残ったエントリが、利用者から見て未追跡で今 ignore されていれば、
  // 区切りの記録のインデックスからも外す(.git/index から作った場合と同じ tree・ignoredAtBaseline にする)
  describe('前の記録に入ったエントリが後から ignore されたとき', () => {
    // 実行ごとの一覧(途中の実行・最後の実行)に、path が通常の行(notRecorded でない)として出ないこと
    const expectNotListedAsRecorded = async (
      start: BaselineSnapshot,
      end: BaselineSnapshot,
      path: string
    ): Promise<void> => {
      const between = (await listAgentChangesBetween(start, end)).entries
      expect(between.filter((e) => e.path === path && !e.notRecorded)).toEqual([])
      const last = (await listAgentChanges(end)).entries
      expect(last.filter((e) => e.path === path && !e.notRecorded)).toEqual([])
    }

    it('前の記録に未追跡として入ったファイルを後で .gitignore に足して書き換えても、区切りは .git/index から作った場合と同じ tree・ignoredAtBaseline になる', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('build.log', 'one\n')
      const first = await takeFrom()
      expect(await baselinePaths(first)).toEqual(['a.txt', 'build.log'])
      write('.gitignore', 'build.log\n')
      write('build.log', 'one\ntwo\n')
      const before = userState()
      const second = await takeFrom(first)
      const fromUserIndex = await takeFrom()
      expect(userState()).toEqual(before)
      expect(await baselinePaths(second)).toEqual(['.gitignore', 'a.txt'])
      expect(second.tree).toBe(fromUserIndex.tree)
      expect(second.ignoredAtBaseline).toEqual(fromUserIndex.ignoredAtBaseline)
      expect(second.ignoredAtBaseline).toContain('build.log')
      write('build.log', 'one\ntwo\nthree\n')
      const third = await takeFrom(second)
      expect(third.tree).toBe(second.tree)
      write('build.log', 'four\n')
      await expectNotListedAsRecorded(second, third, 'build.log')
      expect(userState()).toEqual(before)
    })

    it('利用者が git rm --cached してから .gitignore に足したファイルも、区切りは .git/index から作った場合と同じ tree・ignoredAtBaseline になる', async () => {
      write('a.txt', 'a\n')
      write('.env', 'SECRET=1\n')
      commitAll(repo, 'init')
      const first = await takeFrom()
      expect(await baselinePaths(first)).toEqual(['.env', 'a.txt'])
      runGit(repo, 'rm', '-q', '--cached', '.env')
      write('.gitignore', '.env\n')
      write('.env', 'SECRET=2\n')
      const before = userState()
      const second = await takeFrom(first)
      const fromUserIndex = await takeFrom()
      expect(userState()).toEqual(before)
      expect(await baselinePaths(second)).toEqual(['.gitignore', 'a.txt'])
      expect(second.tree).toBe(fromUserIndex.tree)
      expect(second.ignoredAtBaseline).toEqual(fromUserIndex.ignoredAtBaseline)
      expect(second.ignoredAtBaseline).toContain('.env')
      write('.env', 'SECRET=3\n')
      const third = await takeFrom(second)
      expect(third.tree).toBe(second.tree)
      write('.env', 'SECRET=4\n')
      await expectNotListedAsRecorded(second, third, '.env')
      expect(userState()).toEqual(before)
    })

    // ローカルレビュー第 2 周の指摘 1。git rm --pathspec-from-file はエントリ数 × pathspec の数の時間になり、数万件で打ち切りを
    // 超える。引き継いだ ignore 済みのパスは update-index --force-remove --stdin(-z)で外す。git の呼び出しを控えて確かめる
    it('大量の ignore 済みのパスを引き継いでも、update-index で外して .git/index から作った場合と同じ tree になる(pathspec として解釈しない)', async () => {
      const count = 8_000
      write('a.txt', 'a\n')
      for (let i = 0; i < count; i++) write(`deps/m${i}.js`, `${i}\n`)
      // pathspec の magic・glob・改行を含む名前も、パスそのものとして外す
      const oddNames = ['deps/[ab].js', 'deps/*.js', 'deps/:(glob)x', 'deps/line\nbreak.js']
      for (const name of oddNames) write(name, 'odd\n')
      write('deps/a.js', 'kept\n')
      commitAll(repo, 'deps')
      const first = await takeFrom()
      // 利用者が追跡から外して ignore する。deps/a.js だけは追跡し続ける(glob として解釈すると [ab].js・*.js に巻き込まれる)
      runGit(repo, 'rm', '-r', '-q', '--cached', 'deps')
      runGit(repo, 'add', '-f', 'deps/a.js')
      write('.gitignore', 'deps/\n')
      const before = userState()
      const log = join(home, 'git-args.log')
      const realGit = execFileSync('which', ['git']).toString().trim()
      const bin = join(home, 'bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(
        join(bin, 'git'),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${realGit}" "$@"\n`,
        { mode: 0o755 }
      )
      vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
      const second = await takeFrom(first)
      vi.unstubAllEnvs()
      const calls = readFileSync(log, 'utf8').split('\n')
      expect(calls.some((line) => /update-index -z --force-remove --stdin/.test(line))).toBe(true)
      expect(calls.filter((line) => /(^| )rm( |$)/.test(line))).toEqual([])
      const fromUserIndex = await takeFrom()
      expect(userState()).toEqual(before)
      expect(await baselinePaths(second)).toEqual(['.gitignore', 'a.txt', 'deps/a.js'])
      expect(second.tree).toBe(fromUserIndex.tree)
      expect(second.ignoredAtBaseline).toEqual(fromUserIndex.ignoredAtBaseline)
    }, 60_000)
  })
})
