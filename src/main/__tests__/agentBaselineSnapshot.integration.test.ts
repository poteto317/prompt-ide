import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { takeBaselineSnapshot } from '../agentBaselineSnapshot'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { createBaselineGit } from '../agentBaselineGit'
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

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
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

  // 確認は 9 か所(リポジトリか・最上位・未追跡の検査・index の場所・写し・pathspec の書き込み・add・ignore 済みの一覧・HEAD の後)。
  // 取り消されなければ記録が返る
  it('9 回の確認のどれでも取り消されなければ記録を返す', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    let calls = 0
    const result = await takeBaselineSnapshot(repo, { tempRoot, isCanceled: () => ++calls >= 10 })
    expect(result.kind).toBe('recorded')
    expect(calls).toBe(9)
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
