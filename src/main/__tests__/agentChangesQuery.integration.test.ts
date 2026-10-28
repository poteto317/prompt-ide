import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import {
  NOT_RECORDED_DIFF_MESSAGE,
  buildAddedFolderDiffMessage,
  getAgentChangeDiff
} from '../agentChangeDiff'
import { listAgentChanges } from '../agentChangesQuery'
import { commitAll, initRepo, runGit, writeRepoFile } from './helpers/realGitRepo'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import {
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  disposeAgentBaselineRepo,
  folderEntries,
  recordBaseline,
  userRepoState
} from './helpers/agentBaselineFixtures'

let repo: string
let home: string
let tempRoot: string
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-query-'))
})

afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

const record = (): Promise<BaselineSnapshot> => recordBaseline(repo, tempRoot)

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

describe('listAgentChanges(実 git)', () => {
  it('実行の前からの利用者の変更を出さず、エージェントの変更だけを出す。利用者の index を変えない(確認の結果 3・5)', async () => {
    write('a.txt', 'a1\na2\na3\n')
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    write('d.txt', 'd1\nd2\nd3\nd4\nd5\nd6\nd7\nd8\n')
    write('.gitignore', 'ignored/\n')
    commitAll(repo, 'init')
    // 利用者の実行の前の変更(未ステージ・ステージ済み・未追跡)
    write('a.txt', 'a1\na2\na3\nunstaged\n')
    write('b.txt', 'b\nstaged\n')
    runGit(repo, 'add', 'b.txt')
    write('user-untracked.txt', 'u\n')
    runGit(repo, 'status', '--porcelain')
    const snapshot = await record()
    // エージェントの変更
    write('a.txt', 'a1\na2\na3\nunstaged\nagent\n')
    write('d.txt', 'd1\nd2\nd3\nD4\nd5\nd6\nd7\nd8\n')
    unlinkSync(join(repo, 'c.txt'))
    renameSync(join(repo, 'user-untracked.txt'), join(repo, 'moved.txt'))
    write('new.txt', 'n\n')
    write('newdir/x', '1\n')
    write('newdir/y', '2\n')
    mkdirSync(join(repo, 'emptydir'))
    write('ignored/gen', 'g\n')
    const before = userRepoState(repo)
    const list = await listAgentChanges(snapshot)
    expect(list).toEqual({
      entries: [
        entry('a.txt', 'M'),
        entry('c.txt', 'D'),
        entry('d.txt', 'M'),
        entry('moved.txt', 'A'),
        entry('new.txt', 'A'),
        entry('newdir/', 'A', { isDirectory: true }),
        entry('user-untracked.txt', 'D')
      ],
      totalCount: 7,
      truncated: false,
      headChanged: false
    })
    // a.txt の diff はエージェントの行だけ(実行の前の unstaged は文脈の行)
    const diff = await getAgentChangeDiff(snapshot, 'a.txt')
    expect(diff.split('\n').filter((line) => /^[+-][^+-]/.test(line))).toEqual(['+agent'])
    expect(diff).toContain(' unstaged')
    expect(userRepoState(repo)).toEqual(before)
  })

  it('内容が同じまま更新時刻だけ変わったファイルは出さない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    utimesSync(join(repo, 'a.txt'), new Date(), new Date(Date.now() + 5_000))
    expect((await listAgentChanges(snapshot)).entries).toEqual([])
  })

  it('記録の時点からの種類の変更(ファイル → リンク)は T、入れ子のリポジトリのコミットは M', async () => {
    write('a.txt', 'a\n')
    write('target.txt', 't\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    commitAll(nested, 's')
    const snapshot = await record()
    unlinkSync(join(repo, 'a.txt'))
    symlinkSync('target.txt', join(repo, 'a.txt'))
    writeRepoFile(nested, 't.txt', 't\n')
    commitAll(nested, 't')
    expect((await listAgentChanges(snapshot)).entries).toEqual([
      entry('a.txt', 'T'),
      entry('sub', 'M')
    ])
  })

  it('記録の後に HEAD が変わったら headChanged(コミットしても内容が記録と違えば一覧に残る)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    write('a.txt', 'agent\n')
    commitAll(repo, 'agent')
    expect(await listAgentChanges(snapshot)).toMatchObject({
      entries: [entry('a.txt', 'M')],
      headChanged: true
    })
  })

  it('500 件で打ち切り、全件数を返す', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    for (let i = 0; i < 501; i++)
      writeFileSync(join(repo, 'many', `${String(i).padStart(3, '0')}.txt`), '')
    const list = await listAgentChanges(snapshot)
    expect(list.entries).toHaveLength(500)
    expect(list.totalCount).toBe(501)
    expect(list.truncated).toBe(true)
    expect(list.entries[0].path).toBe('many/000.txt')
  })

  it('ちょうど 500 件なら打ち切らない', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    for (let i = 0; i < 500; i++)
      writeFileSync(join(repo, 'many', `${String(i).padStart(3, '0')}.txt`), '')
    const list = await listAgentChanges(snapshot)
    expect(list.entries).toHaveLength(500)
    expect(list.totalCount).toBe(500)
    expect(list.truncated).toBe(false)
  })

  it('スペース・改行・先頭のハイフン・引用符を含むパスを正しく出す', async () => {
    const names = ['sp ace.txt', 'new\nline.txt', '-dash.txt', 'q"uote\'s.txt']
    for (const name of names) write(name, 'x\n')
    write('keep.txt', 'k\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    for (const name of names) write(name, 'y\n')
    write('new file "x".txt', 'n\n')
    const list = await listAgentChanges(snapshot)
    expect(list.entries.map((e) => e.path)).toEqual(
      [...names, 'new file "x".txt'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    )
    expect(await getAgentChangeDiff(snapshot, '-dash.txt')).toContain('+y')
  })

  it('記録の時点からあった HEAD の無い入れ子のリポジトリは、行を notRecorded にする', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'empty-sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 'n.txt', 'n\n')
    const snapshot = await record()
    expect((await listAgentChanges(snapshot)).entries).toEqual([
      entry('empty-sub/', 'A', { isDirectory: true, notRecorded: true })
    ])
    expect(await getAgentChangeDiff(snapshot, 'empty-sub')).toBe(NOT_RECORDED_DIFF_MESSAGE)
  })

  it('記録の時点で未追跡のフォルダの中にあった HEAD の無い入れ子のリポジトリは、フォルダをまとめずにその行を notRecorded にする', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'outer/sub')
    mkdirSync(nested, { recursive: true })
    initRepo(nested)
    writeRepoFile(nested, 'n.txt', 'n\n')
    const snapshot = await record()
    write('outer/m.txt', 'm\n')
    expect((await listAgentChanges(snapshot)).entries).toEqual([
      entry('outer/m.txt', 'A'),
      entry('outer/sub/', 'A', { isDirectory: true, notRecorded: true })
    ])
  })

  // 記録の前から ignore されたファイルだけを持つフォルダを 1 行にまとめると、戻すときにそのファイルごとゴミ箱へ移る(Task 6 レビュー I1)
  it('ignore されたファイルを含むフォルダはまとめずに中のファイルを 1 行ずつ出す。含まない新しいフォルダは 1 行のまま', async () => {
    write('.gitignore', '*.log\n')
    commitAll(repo, 'init')
    write('logs/x.log', 'x\n')
    const snapshot = await record()
    expect((await listAgentChanges(snapshot)).entries).toEqual([])
    write('logs/new.txt', 'n\n')
    write('logs/deep/d.txt', 'd\n')
    write('nd/a.txt', 'a\n')
    write('nd/b/c.txt', 'c\n')
    expect((await listAgentChanges(snapshot)).entries).toEqual([
      entry('logs/deep/d.txt', 'A'),
      entry('logs/new.txt', 'A'),
      entry('nd/', 'A', { isDirectory: true })
    ])
  })

  it('記録のインデックスが無ければ、全体が追加に見えるのではなく例外を投げる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    rmSync(snapshot.indexPath)
    await expect(listAgentChanges(snapshot)).rejects.toThrow('記録が見つかりません')
    await expect(getAgentChangeDiff(snapshot, 'a.txt')).rejects.toThrow('記録が見つかりません')
  })

  it('HEAD の取得が失敗(打ち切り)したら、headChanged: true にせず例外を投げる', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    const realGit = execFileSync('which', ['git']).toString().trim()
    const bin = join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--verify" ] && exec sleep 5; done\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 }
    )
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    await expect(listAgentChanges(snapshot, { timeoutMs: 500 })).rejects.toThrow()
  })

  describe('記録しなかった(5MB を超える)未追跡のファイル', () => {
    const big = 6 * 1024 * 1024

    it('変わっていなければ出さない', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('big.bin', '')
      truncateSync(join(repo, 'big.bin'), big)
      const snapshot = await record()
      expect((await listAgentChanges(snapshot)).entries).toEqual([])
    })

    it('変わったら M、消えたら D で、どちらも notRecorded', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('big1.bin', '')
      truncateSync(join(repo, 'big1.bin'), big)
      write('big2.bin', '')
      truncateSync(join(repo, 'big2.bin'), big)
      const snapshot = await record()
      truncateSync(join(repo, 'big1.bin'), big + 1)
      unlinkSync(join(repo, 'big2.bin'))
      expect((await listAgentChanges(snapshot)).entries).toEqual([
        entry('big1.bin', 'M', { notRecorded: true }),
        entry('big2.bin', 'D', { notRecorded: true })
      ])
    })

    it('大きさだけ・更新時刻だけの変更も M にする', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('size.bin', '')
      truncateSync(join(repo, 'size.bin'), big)
      write('time.bin', '')
      truncateSync(join(repo, 'time.bin'), big)
      // 更新時刻を整数秒にそろえ、書き戻しても同じ値になるようにする
      const mtime = new Date(1_700_000_000_000)
      utimesSync(join(repo, 'size.bin'), mtime, mtime)
      const snapshot = await record()
      truncateSync(join(repo, 'size.bin'), big + 1)
      utimesSync(join(repo, 'size.bin'), mtime, mtime)
      utimesSync(join(repo, 'time.bin'), new Date(), new Date(Date.now() + 5_000))
      expect((await listAgentChanges(snapshot)).entries).toEqual([
        entry('size.bin', 'M', { notRecorded: true }),
        entry('time.bin', 'M', { notRecorded: true })
      ])
    })

    it('消えた・縮んだファイルの diff は、記録していない旨の 1 行', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('gone.bin', '')
      truncateSync(join(repo, 'gone.bin'), big)
      write('shrunk.bin', '')
      truncateSync(join(repo, 'shrunk.bin'), big)
      const snapshot = await record()
      unlinkSync(join(repo, 'gone.bin'))
      writeFileSync(join(repo, 'shrunk.bin'), 'small\n')
      expect(await getAgentChangeDiff(snapshot, 'gone.bin')).toBe(NOT_RECORDED_DIFF_MESSAGE)
      expect(await getAgentChangeDiff(snapshot, 'shrunk.bin')).toBe(NOT_RECORDED_DIFF_MESSAGE)
    })

    // 記録の前からあったフォルダを 1 行にまとめると、何もしなくても行が出続け、すべて戻すが常に拒否される(Task 6 レビュー M1)
    it('記録の時点で未追跡のフォルダの中にあったら、フォルダをまとめずに中のファイルを 1 行ずつ出す', async () => {
      write('a.txt', 'a\n')
      commitAll(repo, 'init')
      write('out/big.bin', '')
      truncateSync(join(repo, 'out/big.bin'), big)
      const snapshot = await record()
      expect((await listAgentChanges(snapshot)).entries).toEqual([])
      write('out/new.txt', 'n\n')
      truncateSync(join(repo, 'out/big.bin'), big + 1)
      expect((await listAgentChanges(snapshot)).entries).toEqual([
        entry('out/big.bin', 'M', { notRecorded: true }),
        entry('out/new.txt', 'A')
      ])
    })
  })
})

describe('getAgentChangeDiff(実 git)', () => {
  it('記録の後に作られたファイルは未追跡の疑似 diff、フォルダは件数の 1 行、削除は削除の diff', async () => {
    write('a.txt', 'a\n')
    write('gone.txt', 'g\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    write('new.txt', 'n1\nn2\n')
    write('newdir/x', '1\n')
    write('newdir/sub/y', '2\n')
    unlinkSync(join(repo, 'gone.txt'))
    expect(await getAgentChangeDiff(snapshot, 'new.txt')).toBe(
      'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+n1\n+n2\n'
    )
    expect(await getAgentChangeDiff(snapshot, 'newdir')).toBe(buildAddedFolderDiffMessage(2))
    expect(await getAgentChangeDiff(snapshot, 'gone.txt')).toContain('deleted file mode 100644')
    expect(await getAgentChangeDiff(snapshot, 'missing.txt')).toBe('')
  })

  it('日本語のパスの diff のヘッダーを引用符で囲まない(core.quotePath=false)', async () => {
    write('日本.txt', 'a\n')
    commitAll(repo, 'init')
    const snapshot = await record()
    write('日本.txt', 'b\n')
    expect(await getAgentChangeDiff(snapshot, '日本.txt')).toContain('+++ b/日本.txt')
  })
})

describe('buildAddedFolderDiffMessage', () => {
  it('件数を入れた 1 行', () => {
    expect(buildAddedFolderDiffMessage(3)).toBe('フォルダが追加されました（3 件のファイル）\n')
  })
})

// Git 管理外のフォルダ(隠れた git)。ファイルの先頭の beforeEach もリポジトリを作るが、この節では使わない
describe('Git 管理外のフォルダの一覧と diff(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)

  beforeEach(() => {
    ;({
      repo: folder,
      home: folderHome,
      tempRoot: folderTemp
    } = createAgentNonGitFolder('agent-changes-query-plain-'))
  })

  afterEach(() =>
    disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp })
  )

  it('一覧は M・D・A・新しいフォルダの 1 行を出し、headChanged は false。diff は各行の変更と新しいフォルダの件数を返す。一覧・diff の前後でフォルダの中は変わらない(.git を作らない)', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    expect(snapshot.gitDir).not.toBeNull()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    put('c.txt', 'c\n')
    put('d/x.txt', 'x\n')
    const before = folderEntries(folder)
    const list = await listAgentChanges(snapshot)
    expect(list.entries.map((e) => [e.path, e.status, e.isDirectory])).toEqual([
      ['a.txt', 'M', false],
      ['b.txt', 'D', false],
      ['c.txt', 'A', false],
      ['d/', 'A', true]
    ])
    expect(list.headChanged).toBe(false)
    expect(await getAgentChangeDiff(snapshot, 'a.txt')).toContain('+agent')
    expect(await getAgentChangeDiff(snapshot, 'b.txt')).toContain('-b')
    expect(await getAgentChangeDiff(snapshot, 'c.txt')).toContain('+c')
    expect(await getAgentChangeDiff(snapshot, 'd')).toBe(
      'フォルダが追加されました（1 件のファイル）\n'
    )
    expect(folderEntries(folder)).toEqual(before)
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('既定の一覧の中(node_modules/)の変更は一覧に出ない', async () => {
    put('a.txt', 'a\n')
    put('node_modules/m.js', 'm\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    put('node_modules/m.js', 'changed\n')
    put('node_modules/new.js', 'n\n')
    expect((await listAgentChanges(snapshot)).entries).toEqual([])
  })

  it('記録中に利用者が git init してコミットしても、一覧は隠れた git で問い合わせ、.git の行も HEAD の帯も出ない', async () => {
    put('a.txt', 'a\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    initRepo(folder)
    commitAll(folder, 'init')
    put('c.txt', 'c\n')
    const list = await listAgentChanges(snapshot)
    expect(list.entries.map((e) => e.path)).toEqual(['c.txt'])
    expect(list.headChanged).toBe(false)
  })

  it('隠れた git(gitDir)を消すと、一覧・diff は「記録が見つかりません」で拒否する(git の fatal をそのまま見せない。L-002)', async () => {
    put('a.txt', 'a\n')
    const snapshot = await recordBaseline(folder, folderTemp)
    put('a.txt', 'a\nb\n')
    if (snapshot.gitDir === null) throw new Error('隠れた git の記録ではない')
    removeTempPathSync(snapshot.gitDir)
    await expect(listAgentChanges(snapshot)).rejects.toThrow('記録が見つかりません')
    await expect(getAgentChangeDiff(snapshot, 'a.txt')).rejects.toThrow('記録が見つかりません')
  })
})
