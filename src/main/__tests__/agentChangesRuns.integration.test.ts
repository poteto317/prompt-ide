import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE } from '../agentBaselineCoverage'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import {
  NOT_RECORDED_DIFF_MESSAGE,
  getAgentChangeDiff,
  getAgentChangeDiffBetween
} from '../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import { commitAll, initRepo, runGit, writeRepoFile } from './helpers/realGitRepo'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import {
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  disposeAgentBaselineRepo,
  recordBaseline,
  recordBaselineFrom,
  userRepoState
} from './helpers/agentBaselineFixtures'

// 実行ごとの記録(設計書「範囲ごとの一覧と diff」)。累積の始点 → 区切り → 区切り と取り、途中の実行は tree どうし、
// 最後の実行は開始の区切りと作業ツリーを比べる

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-runs-'))
})

afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

const startRun = (base: BaselineSnapshot): Promise<BaselineSnapshot> =>
  recordBaselineFrom(repo, tempRoot, base)

const entry = (
  path: string,
  status: 'A' | 'M' | 'D' | 'T',
  extra: { isDirectory?: boolean; notRecorded?: boolean } = {}
): unknown => ({
  path,
  status,
  isDirectory: false,
  notRecorded: false,
  author: null,
  ...extra
})

// diff の変更の行(+++・--- のヘッダーを除く)
const changedLines = (diff: string): string[] =>
  diff.split('\n').filter((line) => /^[+-][^+-]/.test(line))

const big = 6 * 1024 * 1024
const writeBig = (path: string, size = big): void => {
  write(path, '')
  truncateSync(join(repo, path), size)
}

describe('実行ごとの一覧と diff(実 git)', () => {
  it('区切りを 2 つ取ると、途中の実行・最後の実行・累積の一覧が、それぞれの範囲の変更だけになる', async () => {
    write('a.txt', 'one\ntwo\nthree\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'one\ntwo\nthree\nrun1\n')
    const run2 = await startRun(baseline)
    write('a.txt', 'ONE\ntwo\nthree\nrun1\n')
    write('c.txt', 'c\n')
    const run3 = await startRun(run2)
    write('b.txt', 'b\nrun3\n')
    // 実行 1(途中): a.txt だけ
    expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([entry('a.txt', 'M')])
    // 実行 2(途中): a.txt と c.txt
    expect((await listAgentChangesBetween(run2, run3)).entries).toEqual([
      entry('a.txt', 'M'),
      entry('c.txt', 'A')
    ])
    // 実行 3(最後): 開始の区切り → 作業ツリー
    expect((await listAgentChanges(run3)).entries).toEqual([entry('b.txt', 'M')])
    // 累積: 始点 → 作業ツリー
    expect((await listAgentChanges(baseline)).entries).toEqual([
      entry('a.txt', 'M'),
      entry('b.txt', 'M'),
      entry('c.txt', 'A')
    ])
  })

  it('同じファイルを実行 1 と実行 2 で変えると、実行 2 の diff は実行 2 の行だけで、文脈に実行 1 の行が入る', async () => {
    write('a.txt', 'one\ntwo\nthree\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'one\ntwo\nthree\nrun1\n')
    const run2 = await startRun(baseline)
    write('a.txt', 'ONE\ntwo\nthree\nrun1\n')
    expect(changedLines(await getAgentChangeDiffBetween(baseline, run2, 'a.txt'))).toEqual([
      '+run1'
    ])
    // 最後の実行(開始の区切り → 作業ツリー)
    const lastDiff = await getAgentChangeDiff(run2, 'a.txt')
    expect(changedLines(lastDiff)).toEqual(['-one', '+ONE'])
    expect(lastDiff).toContain(' run1')
    // 同じ範囲を途中の実行として比べても同じ(tree どうし)
    const run3 = await startRun(run2)
    const betweenDiff = await getAgentChangeDiffBetween(run2, run3, 'a.txt')
    expect(changedLines(betweenDiff)).toEqual(['-one', '+ONE'])
    expect(betweenDiff).toContain(' run1')
    expect(betweenDiff).toContain('--- a/a.txt')
  })

  it('区切り・diff-tree・tree どうしの diff の前後で、利用者の index・stash・ref・HEAD が変わらない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nuser\n')
    runGit(repo, 'add', 'a.txt')
    runGit(repo, 'status', '--porcelain')
    const before = userRepoState(repo)
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'a\nuser\nrun1\n')
    const run2 = await startRun(baseline)
    await listAgentChangesBetween(baseline, run2)
    await getAgentChangeDiffBetween(baseline, run2, 'a.txt')
    expect(userRepoState(repo)).toEqual(before)
  })

  it('途中の実行は新しいフォルダを 1 行にまとめず、ファイルごとの行にする', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('newdir/x.txt', 'x\n')
    write('newdir/y.txt', 'y\n')
    const run2 = await startRun(baseline)
    expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
      entry('newdir/x.txt', 'A'),
      entry('newdir/y.txt', 'A')
    ])
    // 最後の実行(作業ツリーとの比較)は今どおり 1 行にまとめる
    expect((await listAgentChanges(baseline)).entries).toEqual([
      entry('newdir/', 'A', { isDirectory: true })
    ])
  })

  it('途中の実行の一覧は 500 件で打ち切り、全件数を返す', async () => {
    write('keep.txt', 'k\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    mkdirSync(join(repo, 'many'))
    for (let i = 0; i < 501; i++)
      writeFileSync(join(repo, 'many', `${String(i).padStart(3, '0')}.txt`), `${i}\n`)
    const run2 = await startRun(baseline)
    const list = await listAgentChangesBetween(baseline, run2)
    expect(list.entries).toHaveLength(500)
    expect(list.totalCount).toBe(501)
    expect(list.truncated).toBe(true)
  })

  it('途中の実行の間に HEAD が変わったら headChanged、変わらなければ false', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'b\n')
    const run2 = await startRun(baseline)
    commitAll(repo, 'agent')
    write('c.txt', 'c\n')
    const run3 = await startRun(run2)
    expect((await listAgentChangesBetween(baseline, run2)).headChanged).toBe(false)
    expect((await listAgentChangesBetween(run2, run3)).headChanged).toBe(true)
  })

  describe('記録しなかったパス', () => {
    it('5MB を超えるファイルを実行の途中で作ると A、消すと D、大きさ・更新時刻を変えると M で、どれも notRecorded', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      writeBig('kept.bin')
      writeBig('resized.bin')
      writeBig('touched.bin')
      writeBig('gone.bin')
      const baseline = await recordBaseline(repo, tempRoot)
      writeBig('created.bin')
      truncateSync(join(repo, 'resized.bin'), big + 1)
      utimesSync(join(repo, 'touched.bin'), new Date(), new Date(Date.now() + 5_000))
      unlinkSync(join(repo, 'gone.bin'))
      const run2 = await startRun(baseline)
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
        entry('created.bin', 'A', { notRecorded: true }),
        entry('gone.bin', 'D', { notRecorded: true }),
        entry('resized.bin', 'M', { notRecorded: true }),
        entry('touched.bin', 'M', { notRecorded: true })
      ])
      expect(await getAgentChangeDiffBetween(baseline, run2, 'created.bin')).toBe(
        NOT_RECORDED_DIFF_MESSAGE
      )
    })

    it('実行の途中で作ったコミットの無い入れ子のリポジトリは、フォルダの A の notRecorded の行', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      const baseline = await recordBaseline(repo, tempRoot)
      const nested = join(repo, 'emptyrepo')
      mkdirSync(nested)
      initRepo(nested)
      writeRepoFile(nested, 'n.txt', 'n\n')
      const run2 = await startRun(baseline)
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
        entry('emptyrepo/', 'A', { isDirectory: true, notRecorded: true })
      ])
      expect(await getAgentChangeDiffBetween(baseline, run2, 'emptyrepo')).toBe(
        NOT_RECORDED_DIFF_MESSAGE
      )
    })

    // 計画の時点で調整した細部: 累積の一覧と同じく、ignore されたファイルの出現・削除は出さない
    it('実行の途中で ignore されたファイル・フォルダが現れても消えても、行にしない', async () => {
      write('.gitignore', 'build/\ndist/\n*.log\n')
      write('build/old.js', 'o\n')
      write('old.log', 'o\n')
      commitAll(repo, 'init')
      const baseline = await recordBaseline(repo, tempRoot)
      write('build/new.js', 'n\n')
      write('dist/app.js', 'a\n')
      write('new.log', 'n\n')
      unlinkSync(join(repo, 'old.log'))
      const run2 = await startRun(baseline)
      expect(run2.ignoredAtBaseline).toContain('dist/')
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([])
    })

    it('始まりで ignore されていて終わりで記録したパスは、M の notRecorded の 1 行(両端に何かがある)', async () => {
      write('.gitignore', 'secret.txt\n')
      commitAll(repo, 'init')
      write('secret.txt', 's\n')
      const baseline = await recordBaseline(repo, tempRoot)
      write('.gitignore', '')
      const run2 = await startRun(baseline)
      expect((await listAgentChangesBetween(baseline, run2)).entries).toEqual([
        entry('.gitignore', 'M'),
        entry('secret.txt', 'M', { notRecorded: true })
      ])
      expect(await getAgentChangeDiffBetween(baseline, run2, 'secret.txt')).toBe(
        NOT_RECORDED_DIFF_MESSAGE
      )
    })
  })

  it('gc --prune=now の後は、途中の実行の一覧・diff が gc の文言で失敗する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    write('a.txt', 'a\nrun1\n')
    const run2 = await startRun(baseline)
    runGit(repo, 'gc', '-q', '--prune=now')
    await expect(listAgentChangesBetween(baseline, run2)).rejects.toThrow(
      AGENT_BASELINE_BLOB_MISSING_MESSAGE
    )
    await expect(getAgentChangeDiffBetween(baseline, run2, 'a.txt')).rejects.toThrow(
      AGENT_BASELINE_BLOB_MISSING_MESSAGE
    )
  })
})

// diff.suppressBlankEmpty=true だと空の文脈行が先頭の空白なしの空行で出て、ハンクを戻すパッチの検査に通らない。
// 途中の実行の diff(tree どうし)でも、diff を作る git でこの設定を打ち消す
describe('getAgentChangeDiffBetween と利用者の大域の diff.suppressBlankEmpty(実 git)', () => {
  it('空の文脈行も先頭に空白を付けて出す', async () => {
    writeFileSync(join(home, '.gitconfig'), '[diff]\n\tsuppressBlankEmpty = true\n')
    write('a.txt', 'a1\n\na3\n')
    commitAll(repo, 'init')
    const baseline = await recordBaseline(repo, tempRoot)
    const run2 = await startRun(baseline)
    write('a.txt', 'a1\n\nA3\n')
    const run3 = await startRun(run2)
    const diff = await getAgentChangeDiffBetween(run2, run3, 'a.txt')
    expect(diff).toContain('\n \n')
    expect(diff.split('\n').slice(0, -1)).not.toContain('')
  })
})

describe('Git 管理外のフォルダの実行ごとの一覧と diff(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)

  beforeEach(() => {
    ;({
      repo: folder,
      home: folderHome,
      tempRoot: folderTemp
    } = createAgentNonGitFolder('agent-changes-runs-plain-'))
  })

  afterEach(() =>
    disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp })
  )

  it('隠れた git の区切りでも、途中の実行は tree どうし、最後の実行は作業ツリーと比べる', async () => {
    put('a.txt', 'a\n')
    put('b.txt', 'b\n')
    const base = await recordBaseline(folder, folderTemp)
    put('a.txt', 'a\nrun1\n')
    const second = await recordBaselineFrom(folder, folderTemp, base)
    // 前提: 区切りは始点の隠れた git を共有する(作らないことは agentBaselineSnapshot.integration.test.ts で試す)
    expect(second.gitDir).toBe(base.gitDir)
    put('b.txt', 'b\nrun2\n')
    expect(
      (await listAgentChangesBetween(base, second)).entries.map((e) => [e.path, e.status])
    ).toEqual([['a.txt', 'M']])
    expect((await listAgentChangesBetween(base, second)).headChanged).toBe(false)
    expect((await listAgentChanges(second)).entries.map((e) => [e.path, e.status])).toEqual([
      ['b.txt', 'M']
    ])
    expect(changedLines(await getAgentChangeDiffBetween(base, second, 'a.txt'))).toEqual(['+run1'])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('隠れた git(gitDir)を消すと、途中の実行の一覧・diff は「記録が見つかりません」で拒否する(L-002)', async () => {
    put('a.txt', 'a\n')
    const base = await recordBaseline(folder, folderTemp)
    put('a.txt', 'a\nrun1\n')
    const second = await recordBaselineFrom(folder, folderTemp, base)
    if (base.gitDir === null) throw new Error('隠れた git の記録ではない')
    removeTempPathSync(base.gitDir)
    await expect(listAgentChangesBetween(base, second)).rejects.toThrow('記録が見つかりません')
    await expect(getAgentChangeDiffBetween(base, second, 'a.txt')).rejects.toThrow(
      '記録が見つかりません'
    )
  })
})
