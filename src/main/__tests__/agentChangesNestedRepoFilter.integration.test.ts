import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { getAgentChangeDiff } from '../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import { revertAgentChange, revertAllAgentChanges } from '../agentChangesRevert'
import { commitAll, initRepo, runGit, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  createFakeTrash,
  disposeAgentBaselineRepo,
  makeRevertContext,
  recordBaseline,
  recordBaselineFrom
} from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo } from './helpers/agentBaselineFixtures'

// フォルダの下の入れ子のリポジトリ(未追跡。記録のインデックスには gitlink として入る)の設定の filter が、記録・一覧・diff・
// 区切り・戻すで動かず、入れ子の .git/index も書き換わらないことを実 git で試す(ローカルレビュー第 13 周の指摘 1。設計書
// 「セキュリティ」)。作業ツリーと比べる diff は gitlink ごとに入れ子の中で `git status` を起動し、入れ子の .git/config の
// filter.<名前>.clean が動く。記録の git の diff には命令行の --ignore-submodules=dirty を付け(-c の diff.ignoreSubmodules は
// フォルダの .gitmodules の submodule.<名前>.ignore に打ち消される)、区切りの `git add -A`(引き継いだ gitlink の dirty を
// 調べる。add は .gitmodules・diff.ignoreSubmodules を見ずに常に調べる)の前には、引き継いだ入れ子のリポジトリの gitlink を外す。
// 入れ子のリポジトリは別の場所で作って複製し(展開・複製と同じく inode と ctime が入れ子の index と食い違う)、filter の印は HOME
// (一時ディレクトリ)の中に書く。利用者の ~/.gitconfig には書かない(HOME は createAgent* が一時ディレクトリにする)

type Mode = { name: string; create: (prefix: string) => AgentBaselineRepo; isRepo: boolean }

const MODES: Mode[] = [
  { name: 'Git 管理外のフォルダ(隠れた git)', create: createAgentNonGitFolder, isRepo: false },
  { name: 'リポジトリの方式', create: createAgentBaselineRepo, isRepo: true }
]

describe.each(MODES)('入れ子のリポジトリの filter($name・実 git)', ({ create, isRepo }) => {
  let dirs: AgentBaselineRepo
  let folder: string
  let marker: string
  let nestedSource: string
  let nestedIndex: string

  // 入れ子の .git/index の更新時刻(ナノ秒)と内容
  const nestedIndexState = (): { mtimeNs: bigint; content: Buffer } => ({
    mtimeNs: statSync(nestedIndex, { bigint: true }).mtimeNs,
    content: readFileSync(nestedIndex)
  })

  beforeEach(() => {
    dirs = create('agent-nested-filter-')
    folder = dirs.repo
    marker = join(dirs.home, 'filter-ran')
    writeRepoFile(folder, 'top.txt', 'top\n')
    // フォルダの .gitmodules で submodule.<名前>.ignore = none にしても、命令行の --ignore-submodules=dirty が勝つ
    writeRepoFile(
      folder,
      '.gitmodules',
      '[submodule "v"]\n\tpath = vendor\n\turl = ./vendor\n\tignore = none\n'
    )
    if (isRepo) commitAll(folder, 'init')
    // 入れ子のリポジトリ(コミットあり)を HOME の中で作り、filter を設定してからフォルダの下へ複製する
    nestedSource = join(dirs.home, 'nested-src')
    mkdirSync(nestedSource)
    initRepo(nestedSource)
    writeRepoFile(nestedSource, 'a.txt', 'a\n')
    writeRepoFile(nestedSource, '.gitattributes', '* filter=mark\n')
    commitAll(nestedSource, 'nested init')
    runGit(nestedSource, 'config', 'filter.mark.clean', `sh -c 'echo clean >> "${marker}"; cat'`)
    runGit(nestedSource, 'config', 'filter.mark.smudge', 'cat')
    cpSync(nestedSource, join(folder, 'vendor'), { recursive: true })
    nestedIndex = join(folder, 'vendor', '.git', 'index')
  })

  afterEach(() => disposeAgentBaselineRepo(dirs))

  const revertContext = (snapshot: BaselineSnapshot): ReturnType<typeof makeRevertContext> =>
    makeRevertContext(snapshot, { trash: createFakeTrash().trash, tempRoot: dirs.tempRoot })

  it('記録 → 一覧 → diff(ファイルと入れ子のリポジトリの行)の後に、filter が動かず入れ子の .git/index も変わらない', async () => {
    const before = nestedIndexState()
    const baseline = await recordBaseline(folder, dirs.tempRoot)
    writeRepoFile(folder, 'top.txt', 'top\nagent\n')
    const list = await listAgentChanges(baseline)
    expect(list.entries.map((e) => [e.path, e.status])).toEqual([['top.txt', 'M']])
    await getAgentChangeDiff(baseline, 'top.txt')
    expect(await getAgentChangeDiff(baseline, 'vendor')).toBe('')
    expect(existsSync(marker)).toBe(false)
    expect(nestedIndexState()).toEqual(before)
  }, 30_000)

  it('区切りの記録(引き継いだ記録のインデックスでの add -A)と実行ごとの一覧の後に、filter が動かず入れ子の .git/index も変わらない', async () => {
    const before = nestedIndexState()
    const baseline = await recordBaseline(folder, dirs.tempRoot)
    writeRepoFile(folder, 'top.txt', 'top\nagent\n')
    const checkpoint = await recordBaselineFrom(folder, dirs.tempRoot, baseline)
    const second = await recordBaselineFrom(folder, dirs.tempRoot, checkpoint)
    expect(
      (await listAgentChangesBetween(baseline, checkpoint)).entries.map((e) => e.path)
    ).toEqual(['top.txt'])
    expect((await listAgentChangesBetween(checkpoint, second)).entries).toEqual([])
    expect(existsSync(marker)).toBe(false)
    expect(nestedIndexState()).toEqual(before)
  }, 30_000)

  it('戻す(行の ↶・すべて戻す)の後に、filter が動かず入れ子の .git/index も変わらない', async () => {
    const before = nestedIndexState()
    // b.txt はコミットしない(リポジトリの方式で commitAll すると vendor も利用者の index に入り、利用者が追跡するサブモジュール
    // 〈利用者のリポジトリの通常の git の挙動のため対象外〉になる)
    writeRepoFile(folder, 'b.txt', 'b\n')
    const baseline = await recordBaseline(folder, dirs.tempRoot)
    writeRepoFile(folder, 'top.txt', 'top\nagent\n')
    writeRepoFile(folder, 'b.txt', 'b\nagent\n')
    const context = revertContext(baseline)
    await revertAgentChange(context, 'top.txt')
    await revertAllAgentChanges(context, [{ path: 'b.txt', status: 'M' }])
    expect(readFileSync(join(folder, 'top.txt'), 'utf8')).toBe('top\n')
    expect(readFileSync(join(folder, 'b.txt'), 'utf8')).toBe('b\n')
    expect(existsSync(marker)).toBe(false)
    expect(nestedIndexState()).toEqual(before)
  }, 30_000)

  it('入れ子のリポジトリの HEAD の違い(コミットの差)は今までどおり M の行と Subproject commit の diff で出る(累積・区切り)', async () => {
    const baseline = await recordBaseline(folder, dirs.tempRoot)
    const vendor = join(folder, 'vendor')
    writeRepoFile(vendor, 'b.txt', 'b\n')
    // テスト側の commit は filter を打ち消して動かす(印はこの後の操作だけで見る)
    runGit(vendor, '-c', 'filter.mark.clean=cat', 'add', '-A')
    runGit(vendor, '-c', 'filter.mark.clean=cat', 'commit', '-qm', 'nested b')
    const before = nestedIndexState()
    const list = await listAgentChanges(baseline)
    expect(list.entries.map((e) => [e.path, e.status])).toEqual([['vendor', 'M']])
    expect(await getAgentChangeDiff(baseline, 'vendor')).toContain('+Subproject commit ')
    const checkpoint = await recordBaselineFrom(folder, dirs.tempRoot, baseline)
    expect(
      (await listAgentChangesBetween(baseline, checkpoint)).entries.map((e) => [e.path, e.status])
    ).toEqual([['vendor', 'M']])
    expect((await listAgentChanges(checkpoint)).entries).toEqual([])
    expect(existsSync(marker)).toBe(false)
    expect(nestedIndexState()).toEqual(before)
  }, 30_000)
})
