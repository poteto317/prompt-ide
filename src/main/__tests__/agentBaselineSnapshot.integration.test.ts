import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import { parseBaselineTempDirName } from '../agentBaselineTempSweep'
import type {
  BaselineSnapshot,
  BaselineSnapshotResult,
  TakeBaselineOptions
} from '../agentBaselineSnapshot'
import { createBaselineGit } from '../agentBaselineGit'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import {
  TRANSLATED_GIT_LOCALE,
  commitAll,
  findTranslatedGitBinDir,
  initRepo,
  killRecordedProcess,
  runGit,
  stubGitCeiling,
  writeRepoFile
} from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  disposeAgentBaselineRepo,
  FAKE_INSTANCE_ID,
  folderEntries,
  recordedSnapshot,
  snapshotBase,
  userRepoState
} from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo } from './helpers/agentBaselineFixtures'

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('baseline-snapshot-'))
})

afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

const baselinePaths = async (snapshot: BaselineSnapshot): Promise<string[]> =>
  (await createBaselineGit(snapshot).raw(['ls-files', '-z']))
    .split('\0')
    .filter((path) => path !== '')

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD)
const userState = (): unknown => userRepoState(repo)

// 偽の git(PATH の先頭の <binParent>/bin/git): 引数に word があれば script を実行し、それ以外は本物の git に渡す
const fakeGitOn = (binParent: string, word: string, script: string): void => {
  const realGit = execFileSync('which', ['git']).toString().trim()
  const bin = join(binParent, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(
    join(bin, 'git'),
    `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${word}" ] && ${script}; done\nexec "${realGit}" "$@"\n`,
    { mode: 0o755 }
  )
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
}

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
      await takeBaselineSnapshot(repo, {
        tempRoot,
        instanceId: FAKE_INSTANCE_ID,
        now: () => 1234
      })
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

  it('記録の一時ディレクトリの名前に起動ごとの ID を入れ(prompt-ide-agent-baseline-<instanceId>-<6 文字>)、0700 で作る', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: '4242-0a1b2c3d' })
    )
    const name = basename(snapshot.tempDir)
    expect(name).toMatch(/^prompt-ide-agent-baseline-4242-0a1b2c3d-[A-Za-z0-9]{6}$/)
    expect(parseBaselineTempDirName(name)).toEqual({ pid: 4242, instanceId: '4242-0a1b2c3d' })
    expect(statSync(snapshot.tempDir).mode & 0o777).toBe(0o700)
  })

  it('リポジトリのサブフォルダは not-toplevel', async () => {
    write('sub/a.txt', 'a\n')
    commitAll(repo, 'init')
    const result = await takeBaselineSnapshot(join(repo, 'sub'), {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'not-toplevel' }
    })
  })

  it('コミットが無いリポジトリ(.git/index が無い)でも記録でき、HEAD は null(確認の結果 15)', async () => {
    write('a.txt', 'a\n')
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
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
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
    const staged = await createBaselineGit(snapshot).raw(['ls-files', '-s', 'sub'])
    expect(staged.startsWith('160000 ')).toBe(true)
  })

  it('worktree(.git がファイル)では、その worktree の index を写す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const worktree = join(realpathSync(tempRoot), 'wt')
    runGit(repo, 'worktree', 'add', '-q', worktree)
    writeRepoFile(worktree, 'w.txt', 'w\n')
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(worktree, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
    const listed = await createBaselineGit(snapshot).raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt', 'w.txt'])
  })

  it('5MB を超える未追跡のファイルは記録から除外し、大きさと更新時刻を控える', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    write('small.txt', 's\n')
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
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
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
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
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
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
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
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
      const result = await takeBaselineSnapshot(repo, {
        tempRoot,
        instanceId: FAKE_INSTANCE_ID,
        timeoutMs: 300
      })
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
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
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
        instanceId: FAKE_INSTANCE_ID,
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
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID,
      isCanceled: () => ++calls >= 11
    })
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
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
    expect(await baselinePaths(snapshot)).toEqual(['a.txt'])
    expect(snapshot.skippedRepos).toEqual(['emptyrepo/'])
  })

  it('未追跡のファイルがちょうど 5,000 件なら記録できる', async () => {
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i < 5_000; i++) writeFileSync(join(repo, 'many', `${i}.txt`), '')
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
    expect(result.kind).toBe('recorded')
  })

  it('除外の後の未追跡の合計がちょうど 100MiB なら記録できる', async () => {
    for (let i = 0; i < 20; i++) {
      write(`f${i}.bin`, '')
      truncateSync(join(repo, `f${i}.bin`), 5 * 1024 * 1024)
    }
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
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
    const snapshot = recordedSnapshot(
      await takeBaselineSnapshot(repo, { tempRoot, instanceId: FAKE_INSTANCE_ID })
    )
    expect(gitFiles()).toEqual(before)
    expect(await baselinePaths(snapshot)).toEqual(['a.txt', 'b.txt'])
  })

  it('末尾が空白のフォルダ名でも記録できる', async () => {
    const spaced = join(realpathSync(home), 'trail ')
    mkdirSync(spaced)
    initRepo(spaced)
    writeRepoFile(spaced, 'a.txt', 'a\n')
    const result = await takeBaselineSnapshot(spaced, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
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
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID,
      timeoutMs: 500
    })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(readdirSync(tempRoot)).toEqual([])
  })
})

describe('takeBaselineSnapshot の tree と区切り(base)(実 git)', () => {
  const takeFrom = async (base?: BaselineSnapshot): Promise<BaselineSnapshot> =>
    recordedSnapshot(
      await takeBaselineSnapshot(repo, {
        tempRoot,
        instanceId: FAKE_INSTANCE_ID,
        base: base === undefined ? undefined : snapshotBase(base)
      })
    )
  const treePaths = (tree: string): string[] =>
    runGit(repo, 'ls-tree', '-r', '--name-only', tree)
      .split('\n')
      .filter((path) => path !== '')

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
    expect(
      await takeBaselineSnapshot(repo, {
        tempRoot,
        instanceId: FAKE_INSTANCE_ID,
        base: snapshotBase(first)
      })
    ).toEqual({
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
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID,
      base: snapshotBase(first)
    })
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
    // 止める前に印を書かせ、write-tree まで進んだことを確かめる(先の git で打ち切られた回を合格にしない。第 9 周の指摘 2)
    const marker = join(home, 'reached-write-tree')
    fakeGitOn(home, 'write-tree', `{ : > '${marker}'; exec sleep 30; }`)
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID,
      timeoutMs: 2_000
    })
    expect(result).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(existsSync(marker)).toBe(true)
    expect(readdirSync(tempRoot)).toEqual([])
  })

  it('write-tree が失敗したら git-failed を返し、一時ディレクトリを消す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    fakeGitOn(home, 'write-tree', 'exit 1')
    const result = await takeBaselineSnapshot(repo, {
      tempRoot,
      instanceId: FAKE_INSTANCE_ID
    })
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

  // ローカルレビュー第 14 周の指摘 1。git rm --cached は gitlink を外すとき、記録のインデックスと作業ツリーの .gitmodules が
  // 違えば exit 128 で止まる。gitlink は .gitmodules を見ない update-index --force-remove で外す
  it('前の記録で gitlink として入った入れ子のリポジトリの HEAD が生まれていない状態に戻り、.gitmodules も変わっていても、区切りは記録でき、.git/index から作った場合と同じ tree になる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'v')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 'z.txt', 'z\n')
    commitAll(nested, 'z')
    write('.gitmodules', '[submodule "v"]\n\tpath = v\n')
    const first = await takeFrom()
    expect(await baselinePaths(first)).toEqual(['.gitmodules', 'a.txt', 'v'])
    runGit(nested, 'checkout', '-q', '--orphan', 'x')
    write('.gitmodules', '[submodule "v"]\n\tpath = v\n\turl = ./v\n')
    const fromRecord = await takeFrom(first)
    const fromUserIndex = await takeFrom()
    expect(fromRecord.skippedRepos).toEqual(['v/'])
    expect(await baselinePaths(fromRecord)).toEqual(['.gitmodules', 'a.txt'])
    expect(fromRecord.tree).toBe(fromUserIndex.tree)
  }, 30_000)

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

  it('リポジトリの方式の記録の区切りで .git が消えていたら not-repository で、隠れた git を作らない(L-041)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const first = await takeFrom()
    // .git を消した後に上のフォルダのリポジトリ(TMPDIR がリポジトリの中にある環境など)を拾わない
    stubGitCeiling(dirname(repo))
    rmSync(join(repo, '.git'), { recursive: true, force: true })
    expect(
      await takeBaselineSnapshot(repo, {
        tempRoot,
        instanceId: FAKE_INSTANCE_ID,
        base: snapshotBase(first)
      })
    ).toEqual({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } })
    expect(readdirSync(tempRoot)).toEqual([basename(first.tempDir)])
  })
})

describe('Git 管理外のフォルダ(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)
  const take = (options: Partial<TakeBaselineOptions> = {}): Promise<BaselineSnapshotResult> =>
    takeBaselineSnapshot(folder, {
      tempRoot: folderTemp,
      instanceId: FAKE_INSTANCE_ID,
      ...options
    })
  const gitDirOf = (snapshot: BaselineSnapshot): string => {
    if (snapshot.gitDir === null) throw new Error('隠れた git の記録ではない')
    return snapshot.gitDir
  }

  beforeEach(() => {
    ;({
      repo: folder,
      home: folderHome,
      tempRoot: folderTemp
    } = createAgentNonGitFolder('baseline-plain-'))
  })

  afterEach(() =>
    disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp })
  )

  it('累積の始点: 通常・実行ビット・シンボリックリンク(指す先を辿らない)・バイナリを記録し、HEAD は null、gitDir は一時ディレクトリの中。フォルダの中は変わらない(.git を作らない)', async () => {
    put('a.txt', 'a\n')
    put('run.sh', '#!/bin/sh\n')
    chmodSync(join(folder, 'run.sh'), 0o755)
    symlinkSync('../outside.txt', join(folder, 'link.txt'))
    writeFileSync(join(folder, 'bin.dat'), Buffer.from([0, 1, 2, 255]))
    const before = folderEntries(folder)
    const snapshot = recordedSnapshot(await take())
    expect(folderEntries(folder)).toEqual(before)
    expect(existsSync(join(folder, '.git'))).toBe(false)
    expect(snapshot.head).toBeNull()
    expect(snapshot.gitDir).toBe(join(snapshot.tempDir, 'git'))
    expect(snapshot.tree).toMatch(/^[0-9a-f]{40}$/)
    const staged = await createBaselineGit(snapshot).raw(['ls-files', '-s'])
    expect(staged).toMatch(/^100644 \S+ 0\ta\.txt$/m)
    expect(staged).toMatch(/^100755 \S+ 0\trun\.sh$/m)
    expect(staged).toMatch(/^100644 \S+ 0\tbin\.dat$/m)
    const linkBlob = /^120000 (\S+) 0\tlink\.txt$/m.exec(staged)?.[1] ?? ''
    // リンクは指す先の文字列を記録する(フォルダの外を辿らない。L-016)
    expect(await createBaselineGit(snapshot).raw(['cat-file', '-p', linkBlob])).toBe(
      '../outside.txt'
    )
  })

  // 方式の判定の checkIsRepo は「リポジトリでない」を git の英語の文言で見分けるため、方式の判定の git だけを英語の環境で動かす
  // (翻訳を持つ git がこのマシンに無ければ飛ばす。環境の組み立ては agentBaselineGit.test.ts の buildModeGitEnv で確かめる)
  const translatedGitBinDir = findTranslatedGitBinDir()
  it.skipIf(translatedGitBinDir === null)(
    '翻訳を持つ git と翻訳されたロケール(LC_ALL・LANGUAGE)でも、Git 管理外のフォルダは隠れた git で記録する',
    async () => {
      vi.stubEnv('PATH', `${translatedGitBinDir}:${process.env.PATH ?? ''}`)
      vi.stubEnv('LC_ALL', TRANSLATED_GIT_LOCALE)
      vi.stubEnv('LANGUAGE', 'fr')
      put('a.txt', 'a\n')
      const snapshot = recordedSnapshot(await take())
      expect(snapshot.gitDir).toBe(join(snapshot.tempDir, 'git'))
      expect(existsSync(join(folder, '.git'))).toBe(false)
    }
  )

  it('フォルダの .gitignore と既定の一覧(node_modules/・dist/・.DS_Store。深い dist/ も)は記録せず、記録の時点の ignore 済みの一覧に入る', async () => {
    put('a.txt', 'a\n')
    put('.gitignore', 'secret.txt\n')
    put('secret.txt', 's\n')
    put('node_modules/m.js', 'm\n')
    put('dist/out.js', 'o\n')
    put('packages/x/dist/y.js', 'y\n')
    put('.DS_Store', 'x')
    const snapshot = recordedSnapshot(await take())
    expect(await baselinePaths(snapshot)).toEqual(['.gitignore', 'a.txt'])
    expect(snapshot.ignoredAtBaseline).toEqual(
      expect.arrayContaining(['.DS_Store', 'dist/', 'node_modules/', 'secret.txt'])
    )
  })

  it('フォルダの .gitignore の !dist/ で既定の一覧を打ち消すと記録する(確認の結果 11)', async () => {
    put('.gitignore', '!dist/\n')
    put('dist/out.js', 'o\n')
    expect(await baselinePaths(recordedSnapshot(await take()))).toEqual([
      '.gitignore',
      'dist/out.js'
    ])
  })

  it('ignore されていないファイルが 5,000 件を超えると too-many-files(件数)で、一時ディレクトリを残さない(既定の一覧の中は数えない)', async () => {
    mkdirSync(join(folder, 'many'))
    for (let i = 0; i <= 5_000; i++) writeFileSync(join(folder, 'many', `${i}.txt`), '')
    put('node_modules/skip.js', 'x\n')
    expect(await take()).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(folderTemp)).toEqual([])
  })

  it('区切りの未追跡の事前の検査も空の index で数える(始点の記録に入ったファイルも数える)。超えたら too-many-files で、区切りの一時ディレクトリを残さない', async () => {
    mkdirSync(join(folder, 'many'))
    // 始点は上限(AGENT_BASELINE_MAX_UNTRACKED_FILES = 5,000)より 1 件少ない 4,999 件で記録できる
    for (let i = 0; i < 4_999; i++) writeFileSync(join(folder, 'many', `${i}.txt`), '')
    const first = recordedSnapshot(await take())
    // 2 件足すと、始点の記録に入った 4,999 件も数えて 5,001 件になる(記録のインデックスを基準にすると 2 件に見える)
    put('one.txt', '1\n')
    put('two.txt', '2\n')
    expect(await take({ base: snapshotBase(first) })).toEqual({
      kind: 'unavailable',
      state: {
        kind: 'unavailable',
        reason: 'too-many-files',
        untrackedCount: 5_001,
        untrackedBytes: 0
      }
    })
    expect(readdirSync(folderTemp)).toEqual([basename(first.tempDir)])
  })

  it('5MB を超えるファイルは記録から除外して控える', async () => {
    put('a.txt', 'a\n')
    put('big.bin', '')
    truncateSync(join(folder, 'big.bin'), 6 * 1024 * 1024)
    const snapshot = recordedSnapshot(await take())
    expect(await baselinePaths(snapshot)).toEqual(['a.txt'])
    expect(snapshot.excluded.map((file) => file.path)).toEqual(['big.bin'])
  })

  it.each(['bare リポジトリのフォルダ', '.git の中'] as const)(
    '%s は inside-git-dir で、一時ディレクトリを作らず、中身も変えない',
    async (kind) => {
      let target: string
      if (kind === 'bare リポジトリのフォルダ') {
        target = join(folder, 'x.git')
        runGit(folder, 'init', '-q', '--bare', target)
      } else {
        runGit(folder, 'init', '-q')
        target = join(folder, '.git')
      }
      const before = folderEntries(target)
      expect(
        await takeBaselineSnapshot(target, {
          tempRoot: folderTemp,
          instanceId: FAKE_INSTANCE_ID
        })
      ).toEqual({ kind: 'unavailable', state: { kind: 'unavailable', reason: 'inside-git-dir' } })
      expect(folderEntries(target)).toEqual(before)
      expect(readdirSync(folderTemp)).toEqual([])
    }
  )

  it('区切りは始点と同じ隠れた git を使い、新しい隠れた git を作らない(区切りの一時ディレクトリに git が無い)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    put('a.txt', 'a\nrun1\n')
    put('n.txt', 'n\n')
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(second.gitDir).toBe(first.gitDir)
    expect(readdirSync(second.tempDir)).not.toContain('git')
    expect(second.head).toBeNull()
    expect(
      (
        await createBaselineGit(first).raw([
          'diff-tree',
          '-r',
          '--name-status',
          '--no-renames',
          first.tree,
          second.tree
        ])
      )
        .trim()
        .split('\n')
    ).toEqual(['M\ta.txt', 'A\tn.txt'])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('区切りの写しの元に引き継いだパスが今 ignore されるなら外す(利用者の追跡済みの一覧は空として求める)', async () => {
    put('a.txt', 'a\n')
    put('later.txt', 'l\n')
    const first = recordedSnapshot(await take())
    put('.gitignore', 'later.txt\n')
    put('later.txt', 'l2\n')
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(await baselinePaths(second)).toEqual(['.gitignore', 'a.txt'])
    expect(second.ignoredAtBaseline).toContain('later.txt')
  })

  // ローカルレビュー第 14 周の指摘 1(隠れた git の形)
  it('区切りの前に入れ子のリポジトリの HEAD が生まれていない状態に戻り、.gitmodules も変わっていても、区切りは記録でき、その gitlink を外す', async () => {
    put('a.txt', 'a\n')
    const nested = join(folder, 'v')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 'z.txt', 'z\n')
    commitAll(nested, 'z')
    put('.gitmodules', '[submodule "v"]\n\tpath = v\n')
    const first = recordedSnapshot(await take())
    expect(await baselinePaths(first)).toEqual(['.gitmodules', 'a.txt', 'v'])
    runGit(nested, 'checkout', '-q', '--orphan', 'x')
    put('.gitmodules', '[submodule "v"]\n\tpath = v\n\turl = ./v\n')
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(second.skippedRepos).toEqual(['v/'])
    expect(await baselinePaths(second)).toEqual(['.gitmodules', 'a.txt'])
    expect(second.tree).toBe(recordedSnapshot(await take()).tree)
  }, 30_000)

  it('区切りで記録の隠れた git(base.gitDir)が無ければ git-failed で、新しい隠れた git を作らない(L-002)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    const gitDir = gitDirOf(first)
    rmSync(gitDir, { recursive: true, force: true })
    expect(await take({ base: snapshotBase(first) })).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(folderTemp)).toEqual([basename(first.tempDir)])
    expect(existsSync(gitDir)).toBe(false)
  })

  it('区切りで base.gitDir がシンボリックリンクなら git-failed で、リンクの先を使わない(L-437)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    const gitDir = gitDirOf(first)
    renameSync(gitDir, `${gitDir}-real`)
    symlinkSync(`${gitDir}-real`, gitDir)
    expect(await take({ base: snapshotBase(first) })).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(folderTemp)).toEqual([basename(first.tempDir)])
  })

  it('記録中に利用者が git init しても、区切りは隠れた git のまま取れ、.git を記録せず、利用者の .git を変えない(L-041)', async () => {
    put('a.txt', 'a\n')
    const first = recordedSnapshot(await take())
    runGit(folder, 'init', '-q')
    put('b.txt', 'b\n')
    const gitBefore = folderEntries(join(folder, '.git'))
    const second = recordedSnapshot(await take({ base: snapshotBase(first) }))
    expect(second.gitDir).toBe(first.gitDir)
    expect(second.head).toBeNull()
    expect(await baselinePaths(second)).toEqual(['a.txt', 'b.txt'])
    expect(folderEntries(join(folder, '.git'))).toEqual(gitBefore)
  })

  // 親の環境は env の選択肢で渡す(方式の判定の createModeGit は process.env を引き継ぐため、process.env に入れると方式の判定そのものが
  // 別のリポジトリを指す。リポジトリの方式の今の挙動と同じで範囲外)。隠れた git の作成と記録の git が位置の変数を外すことを確かめる
  it('親の環境に別のリポジトリを指す GIT_DIR・GIT_OBJECT_DIRECTORY があっても、そのリポジトリを変えずに隠れた git で記録する(L-075)', async () => {
    const other = realpathSync(mkdtempSync(join(folderHome, 'other-')))
    initRepo(other)
    writeRepoFile(other, 'o.txt', 'o\n')
    commitAll(other, 'init')
    const otherBefore = folderEntries(join(other, '.git'))
    put('a.txt', 'a\n')
    const snapshot = recordedSnapshot(
      await take({
        env: {
          ...process.env,
          GIT_DIR: join(other, '.git'),
          GIT_OBJECT_DIRECTORY: join(other, '.git', 'objects')
        }
      })
    )
    expect(folderEntries(join(other, '.git'))).toEqual(otherBefore)
    expect(await baselinePaths(snapshot)).toEqual(['a.txt'])
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    '%i 回目の確認で取り消されたら canceled を返し、一時ディレクトリを残さない(パターン 141)',
    async (cancelAt) => {
      put('a.txt', 'a\n')
      let calls = 0
      expect(await take({ isCanceled: () => ++calls >= cancelAt })).toEqual({ kind: 'canceled' })
      expect(readdirSync(folderTemp)).toEqual([])
    }
  )

  // 確認は 9 か所(リポジトリか・.git の中か・隠れた git の作成・未追跡の検査・add の前・add・ignore 済みの一覧・HEAD・tree の後)
  it('9 回の確認のどれでも取り消されなければ記録を返す', async () => {
    put('a.txt', 'a\n')
    let calls = 0
    const result = await take({ isCanceled: () => ++calls >= 10 })
    expect(result.kind).toBe('recorded')
    expect(calls).toBe(9)
  })

  it('隠れた git を作れなければ git-failed で、一時ディレクトリを残さない', async () => {
    put('a.txt', 'a\n')
    fakeGitOn(folderHome, '--bare', 'exit 1')
    expect(await take()).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'git-failed' }
    })
    expect(readdirSync(folderTemp)).toEqual([])
  })

  it('隠れた git の作成が打ち切りの時間を超えたら timeout で、一時ディレクトリを残さない', async () => {
    put('a.txt', 'a\n')
    // 止める前に印を書かせ、方式の判定の git(checkIsRepo・rev-parse --git-dir)で先に打ち切られた回を合格にしない(第 9 周の指摘 2)。
    // 打ち切りの時間は、作ったばかりの偽の git の初回の起動が遅くても方式の判定を越えられる長さにする(300ms では判定で打ち切られる回があった)
    const marker = join(folderHome, 'reached-init-bare')
    fakeGitOn(folderHome, '--bare', `{ : > '${marker}'; exec sleep 30; }`)
    expect(await take({ timeoutMs: 2_000 })).toEqual({
      kind: 'unavailable',
      state: { kind: 'unavailable', reason: 'timeout' }
    })
    expect(existsSync(marker)).toBe(true)
    expect(readdirSync(folderTemp)).toEqual([])
  })
})

// 読めないフォルダ(mode 000 など)は、git の ls-files --others・add -A が警告(could not open directory)だけ出して exit 0 で
// 飛ばすため、記録にも ignoredAtBaseline にも入らず黙って記録できていた。後で読めるようになると「追加」として一覧に出て、戻すと
// 記録の前からあったフォルダがゴミ箱へ移っていた(ローカルレビュー第 33 周の指摘 1)。読めないファイル(add -A が exit 128)と同じく
// git-failed にする。root は mode 000 でも読めるため、Windows は chmod でフォルダを読めなくできないため飛ばす
const cannotMakeUnreadableDirectory = process.platform === 'win32' || process.getuid?.() === 0
describe.skipIf(cannotMakeUnreadableDirectory)('読めないフォルダがあると記録しない(実 git)', () => {
  describe.each([
    ['リポジトリの方式', createAgentBaselineRepo],
    ['隠れた git', createAgentNonGitFolder]
  ] as const)('%s', (_label, createFolder) => {
    let dirs: AgentBaselineRepo
    const lockedDirs: string[] = []
    const gitFailed = { kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } }
    const take = (base?: BaselineSnapshot): Promise<BaselineSnapshotResult> =>
      takeBaselineSnapshot(dirs.repo, {
        tempRoot: dirs.tempRoot,
        instanceId: FAKE_INSTANCE_ID,
        base: base === undefined ? undefined : snapshotBase(base)
      })
    const lock = (rel: string, mode = 0o000): void => {
      const dir = join(dirs.repo, rel)
      chmodSync(dir, mode)
      lockedDirs.push(dir)
    }

    beforeEach(() => {
      dirs = createFolder('baseline-unreadable-')
    })

    // 読めないままでは片付けられないため、先に戻す
    afterEach(() => {
      for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o755)
      disposeAgentBaselineRepo(dirs)
    })

    it('累積の始点: 読めない未追跡のフォルダがあれば git-failed で、一時ディレクトリを残さない', async () => {
      writeRepoFile(dirs.repo, 'a.txt', 'a\n')
      writeRepoFile(dirs.repo, 'sec/important.txt', 's\n')
      lock('sec')
      expect(await take()).toEqual(gitFailed)
      expect(readdirSync(dirs.tempRoot)).toEqual([])
    }, 30_000)

    it('区切り: 前の記録の後に読めなくなった深いフォルダがあれば git-failed で、自分の一時ディレクトリだけを消す', async () => {
      writeRepoFile(dirs.repo, 'a.txt', 'a\n')
      writeRepoFile(dirs.repo, 'deep/sec/important.txt', 's\n')
      const first = recordedSnapshot(await take())
      lock('deep/sec')
      expect(await take(first)).toEqual(gitFailed)
      expect(readdirSync(dirs.tempRoot)).toEqual([basename(first.tempDir)])
    }, 30_000)

    // 読める(r)が実行(x)できないフォルダは opendir が通るため could not open directory の警告が出ず、中の追跡済みのファイルは
    // lstat が EACCES で失敗して git が「d/f: Permission denied」の行だけを出し、exit 0 で古い内容のまま記録していた(git 2.50.1・
    // 2.53.0 で実測。ローカルレビュー第 35 周の指摘 1)。前の記録で追跡済みにしてから変え、chmod 600 にして区切りを取る
    it('区切り: 実行の権限が無いフォルダ(chmod 600)の中に追跡済みのファイルだけがあれば git-failed で、自分の一時ディレクトリだけを消す', async () => {
      writeRepoFile(dirs.repo, 'a.txt', 'a\n')
      writeRepoFile(dirs.repo, 'd/f.txt', 'v1\n')
      const first = recordedSnapshot(await take())
      writeRepoFile(dirs.repo, 'd/f.txt', 'v2\n')
      lock('d', 0o600)
      expect(await take(first)).toEqual(gitFailed)
      expect(readdirSync(dirs.tempRoot)).toEqual([basename(first.tempDir)])
    }, 30_000)

    // フォルダの外の大域の除外・属性のファイル(~/.config/git/ignore・attributes)が読めないと、git は
    // 「warning: unable to access '<絶対パス>': Permission denied」を出して exit 0 で続ける。これを読めないパスに数え、どのフォルダでも
    // 記録が失敗していた(ローカルレビュー第 36 周の指摘 1)。隔離した HOME の ~/.config を mode 000 にして、始点と区切りを取る
    it('大域の除外・属性のファイルが読めなくても(~/.config が mode 000)、累積の始点と区切りを記録できる', async () => {
      const configDir = join(dirs.home, '.config')
      mkdirSync(join(configDir, 'git'), { recursive: true })
      writeFileSync(join(configDir, 'git', 'ignore'), '*.log\n')
      writeFileSync(join(configDir, 'git', 'attributes'), '* text=auto\n')
      vi.stubEnv('XDG_CONFIG_HOME', configDir)
      writeRepoFile(dirs.repo, 'a.txt', 'a\n')
      chmodSync(configDir, 0o000)
      lockedDirs.push(configDir)
      const first = recordedSnapshot(await take())
      writeRepoFile(dirs.repo, 'a.txt', 'b\n')
      recordedSnapshot(await take(first))
    }, 30_000)

    // git の警告の文言は翻訳されるため、記録の git を英語の環境で動かして見分ける(翻訳を持つ git がこのマシンに無ければ飛ばす)
    const translatedBinDir = findTranslatedGitBinDir()
    it.skipIf(translatedBinDir === null)(
      '翻訳を持つ git と翻訳されたロケール(LC_ALL・LANGUAGE)でも、読めないフォルダがあれば git-failed',
      async () => {
        vi.stubEnv('PATH', `${translatedBinDir}:${process.env.PATH ?? ''}`)
        vi.stubEnv('LC_ALL', TRANSLATED_GIT_LOCALE)
        vi.stubEnv('LANGUAGE', 'fr')
        writeRepoFile(dirs.repo, 'sec/important.txt', 's\n')
        lock('sec')
        expect(await take()).toEqual(gitFailed)
        expect(readdirSync(dirs.tempRoot)).toEqual([])
      },
      30_000
    )
  })
})
