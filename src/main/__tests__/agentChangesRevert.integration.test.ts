import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { AGENT_BASELINE_BLOB_MISSING_MESSAGE } from '../agentBaselineCoverage'
import { getAgentChangeDiff } from '../agentChangeDiff'
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
  createFakeTrash,
  disposeAgentBaselineRepo,
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

const record = async (): Promise<AgentRevertContext> => ({
  snapshot: await recordBaseline(repo, tempRoot),
  trash
})

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
  const lines = (n: number, replace: Record<number, string> = {}): string =>
    Array.from({ length: n }, (_, i) => replace[i + 1] ?? `l${i + 1}`).join('\n') + '\n'
  // diff の 1 つ目のハンクだけのパッチ
  const firstHunk = (diff: string): string => {
    const parts = diff.split(/(?=^@@ )/m)
    return parts[0] + parts[1]
  }

  it('1 つのハンクだけを実行の前の内容へ戻し、他のハンクと利用者の index は変えない(確認の結果 8)', async () => {
    write('d.txt', lines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', lines(20, { 2: 'A2', 18: 'A18' }))
    const before = userState()
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    await revertAgentChangeHunk(context, 'd.txt', firstHunk(diff))
    expect(read('d.txt')).toBe(lines(20, { 18: 'A18' }))
    expect(userState()).toEqual(before)
  })

  it('diff を取った後にファイルが変わって文脈が合わなければ失敗し、何も変えない', async () => {
    write('d.txt', lines(20))
    commitAll(repo, 'init')
    const context = await record()
    write('d.txt', lines(20, { 2: 'A2' }))
    const diff = await getAgentChangeDiff(context.snapshot, 'd.txt')
    write('d.txt', lines(20, { 2: 'A2', 3: 'later' }))
    await expect(revertAgentChangeHunk(context, 'd.txt', diff)).rejects.toThrow(
      AGENT_REVERT_HUNK_FAILED_MESSAGE
    )
    expect(read('d.txt')).toBe(lines(20, { 2: 'A2', 3: 'later' }))
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
    write('a.txt', lines(5))
    write('b.txt', lines(5))
    commitAll(repo, 'init')
    const context = await record()
    write('a.txt', lines(5, { 2: 'A' }))
    write('b.txt', lines(5, { 2: 'B' }))
    const bDiff = await getAgentChangeDiff(context.snapshot, 'b.txt')
    await expect(revertAgentChangeHunk(context, 'a.txt', bDiff)).rejects.toThrow(
      'パッチの対象がファイルと一致しません'
    )
    expect(read('a.txt')).toBe(lines(5, { 2: 'A' }))
    expect(read('b.txt')).toBe(lines(5, { 2: 'B' }))
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
    await expect(revertAllAgentChanges(context, [...shown].reverse())).resolves.toEqual({
      status: 'done'
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
    await expect(revertAllAgentChanges(context, shown)).resolves.toEqual({
      status: 'partial',
      message:
        'すべて戻すが途中で失敗しました（2 / 3 件を戻し済み）: ゴミ箱へ移動できませんでした: new.txt'
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
    await expect(revertAllAgentChanges(context, entries)).resolves.toEqual({ status: 'done' })
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
