import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AgentChangeAuthor, AgentChangeEntry } from '@shared/types'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE } from '../agentBaselineCoverage'
import { NOT_RECORDED_DIFF_MESSAGE, getAgentChangeDiff } from '../agentChangeDiff'
import { listAgentChanges } from '../agentChangesQuery'
import {
  AGENT_CHANGES_STALE_MESSAGE,
  AGENT_REVERT_ALL_MISMATCH_MESSAGE,
  AGENT_REVERT_ALL_TOO_MANY_MESSAGE,
  AGENT_REVERT_FILTER_MESSAGE,
  AGENT_REVERT_HUNK_FAILED_MESSAGE,
  revertAgentChange,
  revertAgentChangeHunk,
  revertAllAgentChanges
} from '../agentChangesRevert'
import type { AgentRevertContext } from '../agentChangesRevert'
import { commitAll, initRepo, readRepoFile, runGit, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  createAgentNonGitFolder,
  createFakeTrash,
  disposeAgentBaselineRepo,
  firstHunkPatch,
  folderChangesExcept,
  folderEntries,
  makeRevertContext,
  numberedLines,
  recordBaseline,
  userRepoState
} from './helpers/agentBaselineFixtures'
import type { FakeTrash } from './helpers/agentBaselineFixtures'

let repo: string
let home: string
let tempRoot: string
// ゴミ箱の偽物: 移したパスを控え、実際に作業ツリーから取り除く
let trash: FakeTrash['trash']
let trashed: string[]
const write = (path: string, content: string): void => writeRepoFile(repo, path, content)
const read = (path: string): string => readRepoFile(repo, path)

beforeEach(() => {
  ;({ repo, home, tempRoot } = createAgentBaselineRepo('agent-changes-revert-'))
  ;({ trash, trashed } = createFakeTrash())
})

afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot }))

const record = async (): Promise<AgentRevertContext> =>
  makeRevertContext(await recordBaseline(repo, tempRoot), { trash, tempRoot })

// 利用者の状態(index の更新時刻〈ナノ秒〉と内容・stash・ref・HEAD)。戻す操作の前後で変わらないこと(完了条件 4)
const userState = (): unknown => userRepoState(repo)

const listPaths = async (snapshot: BaselineSnapshot): Promise<string[]> =>
  (await listAgentChanges(snapshot)).entries.map((e) => e.path)

describe('revertAgentChange(実 git)', () => {
  it('変更は実行の前の内容(利用者の未ステージの変更を含む)へ戻し、利用者の index・stash・ref・HEAD を変えない(確認の結果 7・9)', async () => {
    write('a.txt', 'a1\na2\na3\n')
    commitAll(repo, 'init')
    write('a.txt', 'a1\na2\na3\nunstaged\n')
    runGit(repo, 'stash', 'list')
    const context = await record()
    write('a.txt', 'a1\na2\na3\nunstaged\nagent\n')
    runGit(repo, 'status', '--porcelain')
    const before = userState()
    await revertAgentChange(context, 'a.txt')
    expect(read('a.txt')).toBe('a1\na2\na3\nunstaged\n')
    expect(userState()).toEqual(before)
    expect(await listPaths(context.snapshot)).toEqual([])
  })

  it('削除は記録の時点の内容で作り直す。利用者の index で未追跡だったファイルも作り直す', async () => {
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    write('user-untracked.txt', 'u\n')
    const context = await record()
    unlinkSync(join(repo, 'c.txt'))
    renameSync(join(repo, 'user-untracked.txt'), join(repo, 'moved.txt'))
    await revertAgentChange(context, 'c.txt')
    await revertAgentChange(context, 'user-untracked.txt')
    expect(read('c.txt')).toBe('c\n')
    expect(read('user-untracked.txt')).toBe('u\n')
    expect(trashed).toEqual([])
  })

  it('追加されたファイル・フォルダはゴミ箱へ移す(フォルダは末尾の / を落としたパスで届く)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    write('newdir/x', '1\n')
    await revertAgentChange(context, 'new.txt')
    await revertAgentChange(context, 'newdir')
    expect(trashed).toEqual([join(repo, 'new.txt'), join(repo, 'newdir')])
    expect(await listPaths(context.snapshot)).toEqual([])
  })

  it('一覧に無いパスは拒否し、何も変えない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(AGENT_CHANGES_STALE_MESSAGE)
    await expect(revertAgentChange(context, '../outside')).rejects.toThrow(
      AGENT_CHANGES_STALE_MESSAGE
    )
  })

  it('記録しなかった(5MB を超える)ファイルは拒否し、何も変えない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    const context = await record()
    truncateSync(join(repo, 'big.bin'), 7 * 1024 * 1024)
    await expect(revertAgentChange(context, 'big.bin')).rejects.toThrow(
      '実行前の内容を記録していないため戻せません: big.bin'
    )
    expect(statSync(join(repo, 'big.bin')).size).toBe(7 * 1024 * 1024)
    expect(trashed).toEqual([])
  })

  it('記録の blob が gc で消えていたら、変更は一覧の取得で失敗し、ファイルを消さない(確認の結果 12 の回帰)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'user edit\n')
    const context = await record()
    write('a.txt', 'agent\n')
    runGit(repo, 'gc', '-q', '--prune=now')
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(
      AGENT_BASELINE_BLOB_MISSING_MESSAGE
    )
    expect(read('a.txt')).toBe('agent\n')
  })

  it('記録の blob が消えた削除は、戻す前の cat-file -t で拒否する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('a.txt', 'user edit\n')
    const context = await record()
    unlinkSync(join(repo, 'a.txt'))
    runGit(repo, 'gc', '-q', '--prune=now')
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(
      `${AGENT_BASELINE_BLOB_MISSING_MESSAGE}: a.txt`
    )
    expect(existsSync(join(repo, 'a.txt'))).toBe(false)
  })

  it('同じ名前のディレクトリに置き換わったファイルは拒否し、ディレクトリの中身を消さない(確認の結果 11)', async () => {
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    const context = await record()
    unlinkSync(join(repo, 'c.txt'))
    write('c.txt/x', 'keep\n')
    await expect(revertAgentChange(context, 'c.txt')).rejects.toThrow(
      '未追跡のファイルと重なるため取り消せません: c.txt'
    )
    expect(read('c.txt/x')).toBe('keep\n')
  })

  it('入れ子のリポジトリ(gitlink)の変更は拒否する', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    commitAll(nested, 's')
    const context = await record()
    writeRepoFile(nested, 't.txt', 't\n')
    commitAll(nested, 't')
    await expect(revertAgentChange(context, 'sub')).rejects.toThrow(
      'サブモジュール・入れ子のリポジトリの変更は戻せません。ターミナルで操作してください: sub'
    )
    expect(existsSync(join(nested, 't.txt'))).toBe(true)
  })

  it('記録から外した入れ子のリポジトリ(コミットが無い)は、戻す・すべて戻すのどちらでも拒否し、中身を消さない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const nested = join(repo, 'sub')
    mkdirSync(nested)
    initRepo(nested)
    writeRepoFile(nested, 's.txt', 's\n')
    const context = await record()
    expect(context.snapshot.skippedRepos).toEqual(['sub/'])
    writeRepoFile(nested, 't.txt', 't\n')
    await expect(revertAgentChange(context, 'sub')).rejects.toThrow(
      '実行前の内容を記録していないため戻せません: sub'
    )
    await expect(revertAllAgentChanges(context, [{ path: 'sub/', status: 'A' }])).rejects.toThrow(
      '戻せないファイルがあるため、何も戻しませんでした（sub）'
    )
    expect(existsSync(join(nested, 's.txt'))).toBe(true)
    expect(existsSync(join(nested, 't.txt'))).toBe(true)
    expect(trashed).toEqual([])
  })

  // Task 6 レビュー I1 の再現 1: フォルダごとゴミ箱へ移すと、記録の前からあった ignore されたファイルも移る
  it('記録の前から ignore されたファイルを持つフォルダは、足されたファイルだけをゴミ箱へ移し、ignore されたファイルを残す', async () => {
    write('.gitignore', '*.log\n')
    commitAll(repo, 'init')
    write('logs/x.log', 'x\n')
    const context = await record()
    expect(await listPaths(context.snapshot)).toEqual([])
    write('logs/new.txt', 'n\n')
    await expect(revertAgentChange(context, 'logs')).rejects.toThrow(AGENT_CHANGES_STALE_MESSAGE)
    await revertAgentChange(context, 'logs/new.txt')
    expect(trashed).toEqual([join(repo, 'logs/new.txt')])
    expect(read('logs/x.log')).toBe('x\n')
    expect(await listPaths(context.snapshot)).toEqual([])
  })

  it('利用者の index でコンフリクト中のファイルは拒否する', async () => {
    write('a.txt', 'base\n')
    commitAll(repo, 'init')
    runGit(repo, 'checkout', '-q', '-b', 'other')
    write('a.txt', 'other\n')
    commitAll(repo, 'other')
    runGit(repo, 'checkout', '-q', 'main')
    write('a.txt', 'main\n')
    commitAll(repo, 'main')
    const context = await record()
    try {
      runGit(repo, 'merge', '-q', 'other')
    } catch {
      // コンフリクトで終了コード 1
    }
    await expect(revertAgentChange(context, 'a.txt')).rejects.toThrow(
      'コンフリクト中のファイルは戻せません: a.txt'
    )
  })
})

describe('revertAgentChangeHunk(実 git)', () => {
  it('1 つのハンクだけを実行の前の内容へ戻し、他のハンクと利用者の index は変えない(確認の結果 8)', async () => {
    write('d.txt', numberedLines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', numberedLines(20, { 2: 'A2', 18: 'A18' }))
    const before = userState()
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    await revertAgentChangeHunk(context, 'd.txt', firstHunkPatch(diff))
    expect(read('d.txt')).toBe(numberedLines(20, { 18: 'A18' }))
    expect(userState()).toEqual(before)
  })

  // diff.suppressBlankEmpty=true だと空の文脈行が先頭の空白なしの空行で出て、パッチの検査(assertHunkPatchTargets)が
  // 食い違いとして拒否していた。diff を作る git でこの設定を打ち消す
  it('利用者の大域の diff.suppressBlankEmpty=true でも、空行を文脈に含むハンクを戻せる', async () => {
    writeFileSync(join(home, '.gitconfig'), '[diff]\n\tsuppressBlankEmpty = true\n')
    write('d.txt', numberedLines(20, { 3: '', 17: '' }))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', numberedLines(20, { 2: 'A2', 3: '', 17: '', 18: 'A18' }))
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    expect(diff.split('\n').slice(0, -1)).not.toContain('')
    await revertAgentChangeHunk(context, 'd.txt', firstHunkPatch(diff))
    expect(read('d.txt')).toBe(numberedLines(20, { 3: '', 17: '', 18: 'A18' }))
  })

  it('diff を取った後にファイルが変わって文脈が合わなければ失敗し、何も変えない', async () => {
    write('d.txt', numberedLines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', numberedLines(20, { 2: 'A2' }))
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    write('d.txt', numberedLines(20, { 2: 'A2', 3: 'later' }))
    await expect(revertAgentChangeHunk(context, 'd.txt', diff)).rejects.toThrow(
      AGENT_REVERT_HUNK_FAILED_MESSAGE
    )
    expect(read('d.txt')).toBe(numberedLines(20, { 2: 'A2', 3: 'later' }))
  })

  it('追加・削除されたファイルのハンクは拒否する(新規ファイルのパッチの逆適用は削除になる)', async () => {
    write('gone.txt', 'g\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    unlinkSync(join(repo, 'gone.txt'))
    const newDiff = await getAgentChangeDiff(context.snapshot, 'new.txt')
    await expect(revertAgentChangeHunk(context, 'new.txt', newDiff)).rejects.toThrow(
      '追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: new.txt'
    )
    expect(read('new.txt')).toBe('n\n')
    const goneDiff = await getAgentChangeDiff(context.snapshot, 'gone.txt')
    await expect(revertAgentChangeHunk(context, 'gone.txt', goneDiff)).rejects.toThrow(
      '追加・削除されたファイルはハンクでは戻せません。ファイルごと戻してください: gone.txt'
    )
  })

  it('種類が変わった(T)ファイルのハンクは拒否し、何も変えない(最終レビュー A の M2)', async () => {
    write('a.txt', 'other')
    write('target.txt', 't\n')
    commitAll(repo, 'init')
    const context = await record()
    unlinkSync(join(repo, 'a.txt'))
    symlinkSync('target.txt', join(repo, 'a.txt'))
    expect((await listAgentChanges(context.snapshot)).entries.map((e) => e.status)).toEqual(['T'])
    // リンクの指す文字列に合わせた内容のパッチ(逆適用すると、リンクの指す先が書き換わる)
    const patch = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-other',
      '\\ No newline at end of file',
      '+target.txt',
      '\\ No newline at end of file',
      ''
    ].join('\n')
    await expect(revertAgentChangeHunk(context, 'a.txt', patch)).rejects.toThrow(
      '種類が変わったファイルはハンクでは戻せません。ファイルごと戻してください: a.txt'
    )
    expect(readlinkSync(join(repo, 'a.txt'))).toBe('target.txt')
  })

  it('別のファイルを対象にしたパッチは拒否し、どちらのファイルも変えない', async () => {
    write('a.txt', numberedLines(5))
    write('b.txt', numberedLines(5))
    commitAll(repo, 'init')
    const context = await record()
    write('a.txt', numberedLines(5, { 2: 'A' }))
    write('b.txt', numberedLines(5, { 2: 'B' }))
    const bDiff = await getAgentChangeDiff(context.snapshot, 'b.txt')
    await expect(revertAgentChangeHunk(context, 'a.txt', bDiff)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(read('a.txt')).toBe(numberedLines(5, { 2: 'A' }))
    expect(read('b.txt')).toBe(numberedLines(5, { 2: 'B' }))
  })
})

describe('core.splitIndex=true の利用者(実 git)', () => {
  // 一覧・diff・戻す操作の git が記録のインデックスを書き直すとき、利用者の設定で split 形式にすると
  // 共有部分(sharedindex.<sha>)が利用者の .git に作られる(最終レビュー A の I1)
  it('一覧・diff・戻す操作の後も、利用者の .git の中のファイルが増えない', async () => {
    write('a.txt', 'a1\na2\n')
    write('b.txt', 'b\n')
    commitAll(repo, 'init')
    // 記録の経路(agentBaselineSnapshot.integration.test.ts で固定)と切り離すため、設定は記録の後に入れる
    const context = await record()
    runGit(repo, 'config', 'core.splitIndex', 'true')
    const gitFiles = (): string[] => readdirSync(join(repo, '.git')).sort()
    const before = gitFiles()
    write('a.txt', 'a1\na2\nagent\n')
    write('b.txt', 'agent\n')
    write('new.txt', 'n\n')
    expect(await listPaths(context.snapshot)).toEqual(['a.txt', 'b.txt', 'new.txt'])
    expect(gitFiles()).toEqual(before)
    await getAgentChangeDiff(context.snapshot, 'a.txt')
    expect(gitFiles()).toEqual(before)
    await revertAgentChange(context, 'b.txt')
    expect(read('b.txt')).toBe('b\n')
    expect(gitFiles()).toEqual(before)
    await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'new.txt', status: 'A' }
    ])
    expect(read('a.txt')).toBe('a1\na2\n')
    expect(gitFiles()).toEqual(before)
  })
})

describe('revertAllAgentChanges(実 git)', () => {
  const setup = async (): Promise<AgentRevertContext> => {
    write('a.txt', 'a\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    write('a.txt', 'a\nuser\n')
    const context = await record()
    write('a.txt', 'a\nuser\nagent\n')
    unlinkSync(join(repo, 'c.txt'))
    write('new.txt', 'n\n')
    return context
  }
  const shown = [
    { path: 'a.txt', status: 'M' as const },
    { path: 'c.txt', status: 'D' as const },
    { path: 'new.txt', status: 'A' as const }
  ]

  it('確認のときの一覧と一致すれば、すべて実行の前の状態へ戻す。利用者の index などは変えない', async () => {
    const context = await setup()
    const before = userState()
    await expect(revertAllAgentChanges(context, [...shown].reverse())).resolves.toMatchObject({
      status: 'done',
      applied: 3,
      capture: expect.objectContaining({ kind: 'saved' })
    })
    expect(read('a.txt')).toBe('a\nuser\n')
    expect(read('c.txt')).toBe('c\n')
    expect(trashed).toEqual([join(repo, 'new.txt')])
    expect(userState()).toEqual(before)
  })

  it.each([
    ['件数が違う', shown.slice(0, 2)],
    ['状態の文字が違う', [shown[0], shown[1], { path: 'new.txt', status: 'M' as const }]],
    ['パスが入れ替わった', [shown[0], shown[1], { path: 'other.txt', status: 'A' as const }]]
  ])('%s なら何も変えずに中止する(パターン 62)', async (_label, expected) => {
    const context = await setup()
    await expect(revertAllAgentChanges(context, expected)).rejects.toThrow(
      AGENT_REVERT_ALL_MISMATCH_MESSAGE
    )
    expect(read('a.txt')).toBe('a\nuser\nagent\n')
    expect(existsSync(join(repo, 'c.txt'))).toBe(false)
    expect(trashed).toEqual([])
  })

  // 記録の時点のファイル c.txt が同名のフォルダに置き換わると、フォルダの中身は ls-files --others に出ない(c.txt の D だけ)
  it('1 件でも戻せなければ、何も戻さずに拒否する', async () => {
    const context = await setup()
    write('c.txt/x', 'keep\n')
    await expect(revertAllAgentChanges(context, shown)).rejects.toThrow(
      '戻せないファイルがあるため、何も戻しませんでした（c.txt）'
    )
    expect(read('a.txt')).toBe('a\nuser\nagent\n')
    expect(trashed).toEqual([])
  })

  it('途中で失敗したら、1 件以上済んでいれば partial を返す', async () => {
    const context = await setup()
    context.trash = async () => {
      throw new Error('trash failed')
    }
    await expect(revertAllAgentChanges(context, shown)).resolves.toMatchObject({
      status: 'partial',
      message:
        'すべて戻すが途中で失敗しました（2 / 3 件を戻し済み）: ゴミ箱へ移動できませんでした: new.txt',
      applied: 2,
      capture: expect.objectContaining({ kind: 'saved' })
    })
    expect(read('a.txt')).toBe('a\nuser\n')
  })

  it('1 件目で失敗したら例外にする(何も変わっていない)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    write('new.txt', 'n\n')
    context.trash = async () => {
      throw new Error('trash failed')
    }
    await expect(
      revertAllAgentChanges(context, [{ path: 'new.txt', status: 'A' }])
    ).rejects.toThrow('すべて戻すが途中で失敗しました（0 / 1 件を戻し済み）')
  })

  // Task 6 レビュー I1 の再現 2: すべて戻すが、記録の前からあった .env をフォルダごとゴミ箱へ移す
  it('記録の前から ignore されたファイル(.env)を持つフォルダへ足されたファイルを戻しても、.env を残す', async () => {
    write('a.txt', 'a\n')
    write('.gitignore', '.env\n')
    commitAll(repo, 'init')
    write('config/.env', 'SECRET=1\n')
    const context = await record()
    write('config/app.json', '{}\n')
    write('a.txt', 'agent\n')
    const entries = (await listAgentChanges(context.snapshot)).entries
    expect(entries.map((e) => e.path)).toEqual(['a.txt', 'config/app.json'])
    await expect(revertAllAgentChanges(context, entries)).resolves.toMatchObject({
      status: 'done',
      applied: entries.length
    })
    expect(trashed).toEqual([join(repo, 'config/app.json')])
    expect(read('config/.env')).toBe('SECRET=1\n')
    expect(read('a.txt')).toBe('a\n')
  })

  // 境界: ちょうど 500 件は上限の拒否ではなく照合へ進む(照合が合わないので MISMATCH)
  it('一覧がちょうど 500 件なら上限では拒否しない', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const context = await record()
    for (let i = 0; i < 500; i++) write(`many/${i}.txt`, '')
    await expect(revertAllAgentChanges(context, [])).rejects.toThrow(
      AGENT_REVERT_ALL_MISMATCH_MESSAGE
    )
    expect(trashed).toEqual([])
  })

  it('一覧が 500 件を超えると拒否する', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const context = await record()
    for (let i = 0; i < 501; i++) write(`many/${i}.txt`, '')
    await expect(revertAllAgentChanges(context, [])).rejects.toThrow(
      AGENT_REVERT_ALL_TOO_MANY_MESSAGE
    )
    expect(trashed).toEqual([])
  })
})

// コードレビュー ループ 1 の I1: 記録の `git add -A` は clean filter を通した後の内容を blob にするため、戻すと
// 記録の時点の作業ツリーにあった内容(clean が落とす行)が失われる。filter の付いたファイルは 3 経路とも拒否する
describe('.gitattributes の filter が付いたファイル(実 git)', () => {
  const setup = async (): Promise<AgentRevertContext> => {
    // リポジトリのローカル設定に置く(stubGitHome の隔離のまま動く)
    runGit(repo, 'config', 'filter.strip.clean', "sed '/^OUT/d'")
    runGit(repo, 'config', 'filter.strip.smudge', 'cat')
    write('.gitattributes', '*.nb filter=strip\n*.txt filter=strip\nplain.txt -filter\n')
    write('a.nb', 'cell1\n')
    write('gone.nb', 'g\n')
    write('plain.txt', 'p\n')
    write('other.md', 'o\n')
    commitAll(repo, 'init')
    write('a.nb', 'cell1\nOUT expensive result\n')
    const context = await record()
    write('a.nb', 'cell1 changed\nOUT expensive result\n')
    write('plain.txt', 'p\nagent\n')
    return context
  }
  const FILTER_REASON = `${AGENT_REVERT_FILTER_MESSAGE}: `

  it('ファイル単位で戻すのを拒否し、記録の時点の作業ツリーの内容(clean が落とす行)を残す', async () => {
    const context = await setup()
    await expect(revertAgentChange(context, 'a.nb')).rejects.toThrow(`${FILTER_REASON}a.nb`)
    expect(read('a.nb')).toBe('cell1 changed\nOUT expensive result\n')
  })

  it('削除されたファイルも拒否し、作り直さない', async () => {
    const context = await setup()
    unlinkSync(join(repo, 'gone.nb'))
    await expect(revertAgentChange(context, 'gone.nb')).rejects.toThrow(`${FILTER_REASON}gone.nb`)
    expect(existsSync(join(repo, 'gone.nb'))).toBe(false)
  })

  it('ハンク単位で戻すのを拒否し、何も変えない', async () => {
    const context = await setup()
    const diff = await getAgentChangeDiff(context.snapshot, 'a.nb')
    await expect(revertAgentChangeHunk(context, 'a.nb', diff)).rejects.toThrow(
      `${FILTER_REASON}a.nb`
    )
    expect(read('a.nb')).toBe('cell1 changed\nOUT expensive result\n')
  })

  it('すべて戻すは 1 件でも filter の付いたファイルがあれば何も戻さない', async () => {
    const context = await setup()
    const entries = (await listAgentChanges(context.snapshot)).entries
    // 一覧には行を出す(戻す段階で拒否する)
    expect(entries.map((e) => e.path)).toEqual(['a.nb', 'plain.txt'])
    await expect(revertAllAgentChanges(context, entries)).rejects.toThrow(
      '戻せないファイルがあるため、何も戻しませんでした（a.nb）'
    )
    expect(read('a.nb')).toBe('cell1 changed\nOUT expensive result\n')
    expect(read('plain.txt')).toBe('p\nagent\n')
  })

  it('filter の無いファイル(unspecified・-filter で unset)は従来どおり戻せる', async () => {
    const context = await setup()
    write('other.md', 'o\nagent\n')
    await revertAgentChange(context, 'plain.txt')
    await revertAgentChange(context, 'other.md')
    expect(read('plain.txt')).toBe('p\n')
    expect(read('other.md')).toBe('o\n')
  })
})

// コードレビュー ループ 2 の I1: check-attr は既定で作業ツリーの .gitattributes を読む。記録の後に .gitattributes が
// 編集されても、記録の時点(記録のインデックスの .gitattributes)の filter で拒否し、作業ツリーで新たに付いた filter でも拒否する
describe('記録の後に .gitattributes が変わった場合の filter(実 git)', () => {
  const ATTRIBUTES_AT_RECORD = '*.nb filter=strip\n*.txt filter=strip\nplain.txt -filter\n'
  const recordWith = async (
    attributesAtRecord: string | null,
    attributesAfter: string
  ): Promise<AgentRevertContext> => {
    runGit(repo, 'config', 'filter.strip.clean', "sed '/^OUT/d'")
    runGit(repo, 'config', 'filter.strip.smudge', 'cat')
    if (attributesAtRecord !== null) write('.gitattributes', attributesAtRecord)
    write('a.nb', 'cell1\n')
    write('plain.txt', 'p\n')
    write('other.md', 'o\n')
    commitAll(repo, 'init')
    write('a.nb', 'cell1\nOUT expensive result\n')
    const context = await record()
    write('a.nb', 'cell1 changed\nOUT expensive result\n')
    write('plain.txt', 'p\nagent\n')
    write('other.md', 'o\nagent\n')
    // エージェントの編集
    write('.gitattributes', attributesAfter)
    return context
  }
  const scenarios: Array<{ name: string; atRecord: string | null; after: string }> = [
    {
      name: '(a) filter の行を消した',
      atRecord: ATTRIBUTES_AT_RECORD,
      after: '*.txt filter=strip\nplain.txt -filter\n'
    },
    {
      name: '(b) 別の内容(filter を unset)に書き換えた',
      atRecord: ATTRIBUTES_AT_RECORD,
      after: '*.nb -filter\n*.txt -filter\n'
    },
    {
      name: '(c) 作業ツリーにだけ .gitattributes を足して filter を付けた',
      atRecord: null,
      after: '*.nb filter=strip\n'
    }
  ]
  const FILTER_REASON = `${AGENT_REVERT_FILTER_MESSAGE}: a.nb`

  describe.each(scenarios)('$name', ({ atRecord, after }) => {
    it('ファイル単位で戻すのを拒否し、作業ツリーを変えない', async () => {
      const context = await recordWith(atRecord, after)
      await expect(revertAgentChange(context, 'a.nb')).rejects.toThrow(FILTER_REASON)
      expect(read('a.nb')).toBe('cell1 changed\nOUT expensive result\n')
      expect(read('.gitattributes')).toBe(after)
    })

    it('ハンク単位で戻すのを拒否し、作業ツリーを変えない', async () => {
      const context = await recordWith(atRecord, after)
      const diff = await getAgentChangeDiff(context.snapshot, 'a.nb')
      await expect(revertAgentChangeHunk(context, 'a.nb', diff)).rejects.toThrow(FILTER_REASON)
      expect(read('a.nb')).toBe('cell1 changed\nOUT expensive result\n')
      expect(read('.gitattributes')).toBe(after)
    })

    it('すべて戻すは何も戻さない(.gitattributes も)', async () => {
      const context = await recordWith(atRecord, after)
      const entries = (await listAgentChanges(context.snapshot)).entries
      expect(entries.map((e) => e.path)).toContain('.gitattributes')
      expect(entries.map((e) => e.path)).toContain('a.nb')
      await expect(revertAllAgentChanges(context, entries)).rejects.toThrow(
        /戻せないファイルがあるため、何も戻しませんでした（[^）]*a\.nb/
      )
      expect(read('a.nb')).toBe('cell1 changed\nOUT expensive result\n')
      expect(read('.gitattributes')).toBe(after)
      expect(read('plain.txt')).toBe('p\nagent\n')
      expect(read('other.md')).toBe('o\nagent\n')
      expect(trashed).toEqual([])
    })

    it('filter の無い通常のファイルは従来どおり戻せる', async () => {
      const context = await recordWith(atRecord, after)
      await revertAgentChange(context, 'other.md')
      expect(read('other.md')).toBe('o\n')
    })
  })
})

// PR #47 レビュー A-1: 一覧・戻すの判定は「いまの」ignore の規則を使うため、記録の後に規則から行が消えると、記録の前からあった
// ignore 済みのファイルが「追加」に見え、戻すとゴミ箱へ移っていた。記録の時点の ignore 済みの一覧(ignoredAtBaseline)に当たる行を
// notRecorded にして、既存の拒否の経路に乗せる。5MiB 超の除外ファイルのリネームは inode の照合で同じ扱いにする
describe('記録の時点に ignore されていたファイル・記録から外した大きいファイル(実 git)', () => {
  const NOT_RECORDED = '実行前の内容を記録していないため戻せません'

  const expectNothingReverted = async (
    context: AgentRevertContext,
    paths: string[]
  ): Promise<void> => {
    for (const path of paths) {
      await expect(revertAgentChange(context, path)).rejects.toThrow(`${NOT_RECORDED}: ${path}`)
    }
    const entries = (await listAgentChanges(context.snapshot)).entries
    await expect(revertAllAgentChanges(context, entries)).rejects.toThrow(
      '戻せないファイルがあるため、何も戻しませんでした'
    )
    expect(trashed).toEqual([])
  }

  it('.gitignore から行を消すと、記録の前からあった .env・node_modules/ は notRecorded になり、ファイル・すべて戻すのどちらでも戻らない', async () => {
    write('.gitignore', '.env\nnode_modules/\n')
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('.env', 'SECRET=1\n')
    write('node_modules/x/i.js', 'i\n')
    const context = await record()
    write('.gitignore', '')
    const entries = (await listAgentChanges(context.snapshot)).entries
    expect(entries).toEqual([
      { path: '.env', status: 'A', isDirectory: false, notRecorded: true, author: null },
      { path: '.gitignore', status: 'M', isDirectory: false, notRecorded: false, author: null },
      { path: 'node_modules/', status: 'A', isDirectory: true, notRecorded: true, author: null }
    ])
    expect(await getAgentChangeDiff(context.snapshot, '.env')).toBe(NOT_RECORDED_DIFF_MESSAGE)
    await expectNothingReverted(context, ['.env', 'node_modules'])
    expect(read('.env')).toBe('SECRET=1\n')
    expect(read('node_modules/x/i.js')).toBe('i\n')
    expect(read('.gitignore')).toBe('')
  })

  it('.git/info/exclude から行を消すと、記録の前からあった local.db は notRecorded になり戻らない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('.git/info/exclude', 'local.db\n')
    write('local.db', 'db\n')
    const context = await record()
    write('.git/info/exclude', '')
    expect((await listAgentChanges(context.snapshot)).entries).toEqual([
      { path: 'local.db', status: 'A', isDirectory: false, notRecorded: true, author: null }
    ])
    await expectNothingReverted(context, ['local.db'])
    expect(read('local.db')).toBe('db\n')
  })

  it('5MiB 超で記録から外したファイルをリネームすると、移した先は notRecorded になり戻らない', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('big.bin', '')
    truncateSync(join(repo, 'big.bin'), 6 * 1024 * 1024)
    const context = await record()
    expect(context.snapshot.excluded.map((file) => file.path)).toEqual(['big.bin'])
    renameSync(join(repo, 'big.bin'), join(repo, 'moved.bin'))
    expect((await listAgentChanges(context.snapshot)).entries).toEqual([
      { path: 'big.bin', status: 'D', isDirectory: false, notRecorded: true, author: null },
      { path: 'moved.bin', status: 'A', isDirectory: false, notRecorded: true, author: null }
    ])
    await expectNothingReverted(context, ['moved.bin', 'big.bin'])
    expect(statSync(join(repo, 'moved.bin')).size).toBe(6 * 1024 * 1024)
  })

  it('新しいフォルダの中に記録の前の ignore 済みフォルダがあれば展開し、そのフォルダの 1 行だけを notRecorded にする(足したファイルは戻せる)', async () => {
    write('.gitignore', 'cache/\n')
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('build/cache/c.bin', 'c\n')
    const context = await record()
    write('.gitignore', '')
    write('build/new.txt', 'n\n')
    const entries = (await listAgentChanges(context.snapshot)).entries
    expect(entries).toEqual([
      { path: '.gitignore', status: 'M', isDirectory: false, notRecorded: false, author: null },
      { path: 'build/cache/', status: 'A', isDirectory: true, notRecorded: true, author: null },
      { path: 'build/new.txt', status: 'A', isDirectory: false, notRecorded: false, author: null }
    ])
    await revertAgentChange(context, 'build/new.txt')
    expect(trashed).toEqual([join(repo, 'build/new.txt')])
    await expect(revertAgentChange(context, 'build/cache')).rejects.toThrow(NOT_RECORDED)
    expect(read('build/cache/c.bin')).toBe('c\n')
  })

  it('記録の後に作られた ignore 済みのファイルは、規則を消した後も従来どおり戻せる(過剰に拒否しない)', async () => {
    write('.gitignore', '.env\n')
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context = await record()
    write('.env', 'agent\n')
    write('.gitignore', '')
    expect((await listAgentChanges(context.snapshot)).entries).toContainEqual({
      path: '.env',
      status: 'A',
      isDirectory: false,
      notRecorded: false,
      author: null
    })
    await revertAgentChange(context, '.env')
    expect(trashed).toEqual([join(repo, '.env')])
  })

  it('通常の追加ファイルは従来どおり戻せる(ignore 済みが記録にあっても)', async () => {
    write('.gitignore', '.env\n')
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    write('.env', 'SECRET=1\n')
    const context = await record()
    write('new.txt', 'n\n')
    const entries = (await listAgentChanges(context.snapshot)).entries
    expect(entries).toEqual([
      { path: 'new.txt', status: 'A', isDirectory: false, notRecorded: false, author: null }
    ])
    await expect(revertAllAgentChanges(context, entries)).resolves.toMatchObject({
      status: 'done',
      applied: entries.length
    })
    expect(trashed).toEqual([join(repo, 'new.txt')])
    expect(read('.env')).toBe('SECRET=1\n')
  })
})

describe('revertAllAgentChanges の利用者の変更の除外(実 git・偽の attributeEntries)', () => {
  const authors: Record<string, AgentChangeAuthor> = {
    'a.txt': 'user',
    'b.txt': 'agent',
    'c.txt': 'mixed'
  }
  const attributeByPath = vi.fn(async (entries: AgentChangeEntry[]) =>
    entries.map((entry) => ({ ...entry, author: authors[entry.path] ?? null }))
  )
  // a.txt は利用者の変更、b.txt はエージェントの変更、c.txt は両方、new.txt は区別していない行
  const setup = async (): Promise<AgentRevertContext> => {
    write('a.txt', 'a\n')
    write('b.txt', 'b\n')
    write('c.txt', 'c\n')
    commitAll(repo, 'init')
    const context = { ...(await record()), attributeEntries: attributeByPath }
    write('a.txt', 'a\nuser\n')
    write('b.txt', 'b\nagent\n')
    write('c.txt', 'c\nboth\n')
    write('new.txt', 'n\n')
    return context
  }

  // 本体を { } で包む(mockClear は mock 自身を返し、beforeEach が返した関数は後始末として引数なしで呼ばれるため)
  beforeEach(() => {
    attributeByPath.mockClear()
  })

  it('user・mixed の行を戻さず、agent・null の行だけを戻す(除く規則を外すとこのテストが落ちる)', async () => {
    const context = await setup()
    await expect(
      revertAllAgentChanges(context, [
        { path: 'b.txt', status: 'M' },
        { path: 'new.txt', status: 'A' }
      ])
    ).resolves.toMatchObject({ status: 'done', applied: 2 })
    expect(read('a.txt')).toBe('a\nuser\n')
    expect(read('c.txt')).toBe('c\nboth\n')
    expect(read('b.txt')).toBe('b\n')
    expect(trashed).toEqual([join(repo, 'new.txt')])
  })

  it('確認の一覧に user の行を含めると、何も変えずに中止する', async () => {
    const context = await setup()
    await expect(
      revertAllAgentChanges(context, [
        { path: 'a.txt', status: 'M' },
        { path: 'b.txt', status: 'M' },
        { path: 'new.txt', status: 'A' }
      ])
    ).rejects.toThrow(AGENT_REVERT_ALL_MISMATCH_MESSAGE)
    expect(read('b.txt')).toBe('b\nagent\n')
    expect(trashed).toEqual([])
  })

  it('件数の上限は除く前の件数で検査し、上限を超えたら author を求めない', async () => {
    write('many/keep.txt', 'k\n')
    commitAll(repo, 'init')
    const context = { ...(await record()), attributeEntries: attributeByPath }
    for (let i = 0; i < 501; i++) write(`many/${i}.txt`, '')
    await expect(revertAllAgentChanges(context, [])).rejects.toThrow(
      AGENT_REVERT_ALL_TOO_MANY_MESSAGE
    )
    expect(attributeByPath).not.toHaveBeenCalled()
  })

  it('対象が 0 件(すべて利用者の変更)で確認の一覧も空なら、何も変えずに applied 0 で終わる(古い写しからの依頼でも変えない。L-058)', async () => {
    write('a.txt', 'a\n')
    commitAll(repo, 'init')
    const context: AgentRevertContext = {
      ...(await record()),
      attributeEntries: async (entries) => entries.map((entry) => ({ ...entry, author: 'user' }))
    }
    write('a.txt', 'a\nuser\n')
    await expect(revertAllAgentChanges(context, [])).resolves.toMatchObject({
      status: 'done',
      applied: 0
    })
    expect(read('a.txt')).toBe('a\nuser\n')
    expect(trashed).toEqual([])
  })
})

// Git 管理外のフォルダ(隠れた git)。ファイルの先頭の beforeEach もリポジトリを作るが、この節では使わない
describe('Git 管理外のフォルダの戻す操作(隠れた git)(実 git)', () => {
  let folder: string
  let folderHome: string
  let folderTemp: string
  let plainTrash: FakeTrash['trash']
  let plainTrashed: string[]
  const put = (p: string, content: string): void => writeRepoFile(folder, p, content)
  const readPlain = (p: string): string => readFileSync(join(folder, p), 'utf8')
  const recordPlain = async (): Promise<AgentRevertContext> =>
    makeRevertContext(await recordBaseline(folder, folderTemp), {
      trash: plainTrash,
      tempRoot: folderTemp
    })

  beforeEach(() => {
    ;({
      repo: folder,
      home: folderHome,
      tempRoot: folderTemp
    } = createAgentNonGitFolder('agent-changes-revert-plain-'))
    ;({ trash: plainTrash, trashed: plainTrashed } = createFakeTrash())
  })

  afterEach(() =>
    disposeAgentBaselineRepo({ repo: folder, home: folderHome, tempRoot: folderTemp })
  )

  it('行の ↶: 変更は記録の時点の内容へ、削除は作り直し、追加はゴミ箱へ。変えたもの以外のフォルダの中は変わらない(.git を作らない)', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    put('keep.txt', 'k\n')
    const context = await recordPlain()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    put('c.txt', 'c\n')
    const before = folderEntries(folder)
    await revertAgentChange(context, 'a.txt')
    await revertAgentChange(context, 'b.txt')
    await revertAgentChange(context, 'c.txt')
    expect(readPlain('a.txt')).toBe('one\n')
    expect(readPlain('b.txt')).toBe('b\n')
    expect(plainTrashed).toEqual([join(folder, 'c.txt')])
    expect(folderChangesExcept(before, folderEntries(folder), ['a.txt', 'b.txt', 'c.txt'])).toEqual(
      []
    )
    expect(existsSync(join(folder, '.git'))).toBe(false)
    expect((await listAgentChanges(context.snapshot)).entries).toEqual([])
  })

  it('シンボリックリンクは元の指す先(フォルダの外を含む)のリンクとして作り直し、指す先を書き換えない(L-016)', async () => {
    put('a.txt', 'a\n')
    const outside = join(folderHome, 'outside.txt')
    writeFileSync(outside, 'outside\n')
    symlinkSync('a.txt', join(folder, 'link.txt'))
    symlinkSync(outside, join(folder, 'out.txt'))
    const context = await recordPlain()
    unlinkSync(join(folder, 'link.txt'))
    unlinkSync(join(folder, 'out.txt'))
    symlinkSync('a.txt', join(folder, 'out.txt'))
    await revertAgentChange(context, 'link.txt')
    await revertAgentChange(context, 'out.txt')
    expect(readlinkSync(join(folder, 'link.txt'))).toBe('a.txt')
    expect(readlinkSync(join(folder, 'out.txt'))).toBe(outside)
    expect(readFileSync(outside, 'utf8')).toBe('outside\n')
  }, 30_000)

  it('実行ビットの変更を戻す', async () => {
    put('run.sh', '#!/bin/sh\necho run\n')
    chmodSync(join(folder, 'run.sh'), 0o755)
    const context = await recordPlain()
    put('run.sh', '#!/bin/sh\necho changed\n')
    chmodSync(join(folder, 'run.sh'), 0o644)
    await revertAgentChange(context, 'run.sh')
    expect(readPlain('run.sh')).toBe('#!/bin/sh\necho run\n')
    expect(statSync(join(folder, 'run.sh')).mode & 0o111).not.toBe(0)
  })

  it('ハンクを戻す(パッチはフォルダからの相対で解釈する。確認の結果 10)', async () => {
    put('d.txt', numberedLines(20))
    const context = await recordPlain()
    put('d.txt', numberedLines(20, { 2: 'A2', 18: 'A18' }))
    const before = folderEntries(folder)
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    await revertAgentChangeHunk(context, 'd.txt', firstHunkPatch(diff))
    expect(readPlain('d.txt')).toBe(numberedLines(20, { 18: 'A18' }))
    expect(folderChangesExcept(before, folderEntries(folder), ['d.txt'])).toEqual([])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  })

  it('サブディレクトリ・空白・日本語を含むパスのハンクを戻し、記録のインデックスと gitDir の中は変わらない(--index を付けない)', async () => {
    const target = 'sub dir/日本語/ファ イル.txt'
    put(target, numberedLines(20))
    const context = await recordPlain()
    const { indexPath, gitDir } = context.snapshot
    if (gitDir === null) throw new Error('隠れた git の記録のはず')
    // ファイルの一覧と内容のハッシュ(サブディレクトリの中を含む)
    const digestDir = (dir: string): Record<string, string> =>
      Object.fromEntries(
        Object.entries(folderEntries(dir)).map(([rel, meta]) => [
          rel,
          meta.startsWith('file')
            ? createHash('sha256')
                .update(readFileSync(join(dir, rel)))
                .digest('hex')
            : meta.split(' ')[0]
        ])
      )
    const digestIndex = (): string =>
      `${createHash('sha256').update(readFileSync(indexPath)).digest('hex')} ${statSync(indexPath).mtimeMs}`
    put(target, numberedLines(20, { 2: 'A2', 18: 'A18' }))
    const diff = await getAgentChangeDiff(context.snapshot, target)
    const beforeIndex = digestIndex()
    const beforeGitDir = digestDir(gitDir)
    const beforeFolder = folderEntries(folder)
    await revertAgentChangeHunk(context, target, firstHunkPatch(diff))
    expect(readPlain(target)).toBe(numberedLines(20, { 18: 'A18' }))
    expect(digestIndex()).toBe(beforeIndex)
    expect(digestDir(gitDir)).toEqual(beforeGitDir)
    expect(folderChangesExcept(beforeFolder, folderEntries(folder), [target])).toEqual([])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  }, 30_000)

  it('すべて戻す(変更・削除・追加・新しいフォルダ)', async () => {
    put('a.txt', 'one\n')
    put('b.txt', 'b\n')
    const context = await recordPlain()
    put('a.txt', 'one\nagent\n')
    unlinkSync(join(folder, 'b.txt'))
    put('c.txt', 'c\n')
    put('d/x.txt', 'x\n')
    const result = await revertAllAgentChanges(context, [
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'D' },
      { path: 'c.txt', status: 'A' },
      { path: 'd/', status: 'A' }
    ])
    expect(result).toMatchObject({ status: 'done', applied: 4 })
    expect(readPlain('a.txt')).toBe('one\n')
    expect(readPlain('b.txt')).toBe('b\n')
    expect(plainTrashed.sort()).toEqual([join(folder, 'c.txt'), join(folder, 'd')])
    expect(existsSync(join(folder, '.git'))).toBe(false)
  }, 30_000)
})
