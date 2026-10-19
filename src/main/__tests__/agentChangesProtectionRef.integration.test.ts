import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitAll, runGit, writeRepoFile } from './helpers/realGitRepo'
import {
  createAgentBaselineRepo,
  disposeAgentBaselineRepo,
  recordBaseline,
  repoLocation
} from './helpers/agentBaselineFixtures'
import type { AgentBaselineRepo } from './helpers/agentBaselineFixtures'
import { runBaselineGitWithInput } from '../agentBaselineGit'
import {
  createProtectionRef,
  deleteProtectionRef,
  deleteProtectionRefSync,
  filterExistingProtectionTrees,
  makeProtectionTree,
  readProtectionRef,
  sweepStaleProtectionRefs,
  updateProtectionRef
} from '../agentChangesProtectionRef'
import type { ProtectionGitContext } from '../agentChangesProtectionRef'
import { protectionRefName } from '../agentChangesProtectionRules'

// 実 git で、保護の ref の部品(設計書の確認の結果 1〜8)の回帰を固定する
const INSTANCE = '1-00000000'
const MISSING_TREE = '1'.repeat(40)

let dirs: AgentBaselineRepo
let noHooksDir: string
let extraDirs: string[]
let ctx: ProtectionGitContext

const makeCtx = (folderPath: string): ProtectionGitContext => ({
  folderPath,
  indexPath: join(folderPath, '.git/index'),
  noHooksDir
})

// a.txt をコミットして tree を返す
const commitTree = (): string => {
  writeRepoFile(dirs.repo, 'a.txt', 'a\n')
  commitAll(dirs.repo, 'init')
  return runGit(dirs.repo, 'write-tree').trim()
}

const refNames = (cwd = dirs.repo): string =>
  runGit(cwd, 'for-each-ref', '--format=%(refname)', 'refs/prompt-ide/')

const tempDir = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  extraDirs.push(dir)
  return dir
}

beforeEach(() => {
  dirs = createAgentBaselineRepo('agent-protection-ref-')
  noHooksDir = mkdtempSync(join(tmpdir(), 'agent-protection-nohooks-'))
  extraDirs = []
  ctx = makeCtx(dirs.repo)
})

afterEach(() => {
  disposeAgentBaselineRepo(dirs)
  for (const dir of [noHooksDir, ...extraDirs]) rmSync(dir, { recursive: true, force: true })
})

describe('保護の ref の作成(確認の結果 1・2)', () => {
  it('mktree の tree を指す ref が作られ、ls-tree・読み直しで値を読める', async () => {
    const tree = commitTree()
    const value = await makeProtectionTree(ctx, [
      { name: 'baseline', tree },
      { name: 'run-2', tree }
    ])
    const ref = protectionRefName(INSTANCE, 1)
    await createProtectionRef(ctx, ref, value)
    expect(
      runGit(dirs.repo, 'for-each-ref', '--format=%(objecttype) %(objectname)', 'refs/prompt-ide/')
    ).toBe(`tree ${value}\n`)
    const names = runGit(dirs.repo, 'ls-tree', '--name-only', value).trim().split('\n')
    expect(names).toEqual(['baseline', 'run-2'])
    expect(await readProtectionRef(ctx, ref)).toBe(value)
  })

  it('ref を作る前と後で、利用者の見える履歴・ブランチの出力が変わらない', async () => {
    const tree = commitTree()
    const observe = (): string[] => [
      runGit(dirs.repo, 'log', '--all', '--oneline'),
      runGit(dirs.repo, 'rev-list', '--all'),
      runGit(dirs.repo, 'branch', '-a'),
      runGit(dirs.repo, 'describe', '--all')
    ]
    const before = observe()
    const value = await makeProtectionTree(ctx, [{ name: 'baseline', tree }])
    await createProtectionRef(ctx, protectionRefName(INSTANCE, 1), value)
    expect(observe()).toEqual(before)
  })
})

describe('gc からの保護(確認の結果 3)', () => {
  it('ref がある間は記録の blob が gc で消えず、ref を消すと消える', async () => {
    commitTree()
    writeRepoFile(dirs.repo, 'only.txt', 'only\n')
    const snapshot = await recordBaseline(dirs.repo, dirs.tempRoot)
    const blob = runGit(dirs.repo, 'rev-parse', `${snapshot.tree}:only.txt`).trim()
    const value = await makeProtectionTree(ctx, [{ name: 'baseline', tree: snapshot.tree }])
    const ref = protectionRefName(INSTANCE, 1)
    await createProtectionRef(ctx, ref, value)
    rmSync(join(dirs.repo, 'only.txt'))
    runGit(dirs.repo, 'gc', '-q', '--prune=now')
    expect(runGit(dirs.repo, 'cat-file', '-t', blob)).toBe('blob\n')
    await deleteProtectionRef(ctx, ref, value)
    runGit(dirs.repo, 'gc', '-q', '--prune=now')
    expect(() => runGit(dirs.repo, 'cat-file', '-t', blob)).toThrow()
  })
})

describe('compare-and-swap(確認の結果 4)', () => {
  const ref = protectionRefName(INSTANCE, 1)
  let value: string
  let newValue: string
  let otherTree: string

  // ref を value で作っておく
  beforeEach(async () => {
    const tree = commitTree()
    value = await makeProtectionTree(ctx, [{ name: 'baseline', tree }])
    newValue = await makeProtectionTree(ctx, [{ name: 'run-1', tree }])
    otherTree = await makeProtectionTree(ctx, [{ name: 'run-7', tree }])
    await createProtectionRef(ctx, ref, value)
  })

  it('作成は ref が既にあれば reject し、値を変えない', async () => {
    await expect(createProtectionRef(ctx, ref, newValue)).rejects.toThrow()
    expect(await readProtectionRef(ctx, ref)).toBe(value)
  })

  it('削除は期待の値が違えば reject し、値を変えない', async () => {
    await expect(deleteProtectionRef(ctx, ref, otherTree)).rejects.toThrow()
    expect(await readProtectionRef(ctx, ref)).toBe(value)
  })

  it('更新は期待の値が違えば reject し、値を変えない', async () => {
    await expect(updateProtectionRef(ctx, ref, newValue, otherTree)).rejects.toThrow()
    expect(await readProtectionRef(ctx, ref)).toBe(value)
  })

  it('更新は期待の値が合えば書き換える', async () => {
    await updateProtectionRef(ctx, ref, newValue, value)
    expect(await readProtectionRef(ctx, ref)).toBe(newValue)
  })

  it('pack-refs の後も削除できる', async () => {
    runGit(dirs.repo, 'pack-refs', '--all')
    await deleteProtectionRef(ctx, ref, value)
    expect(await readProtectionRef(ctx, ref)).toBeNull()
  })
})

describe('hook を動かさない(確認の結果 5)', () => {
  it('作成・更新・削除・同期の削除のどれも reference-transaction の hook を動かさない', async () => {
    // コミットも reference-transaction の hook を動かすため、hook を置く前に済ませる
    const tree = commitTree()
    const value = await makeProtectionTree(ctx, [{ name: 'baseline', tree }])
    const value2 = await makeProtectionTree(ctx, [{ name: 'run-1', tree }])
    const marker = join(dirs.repo, 'hook-ran')
    const hook = join(dirs.repo, '.git/hooks/reference-transaction')
    writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\n`)
    chmodSync(hook, 0o755)
    runGit(dirs.repo, 'config', 'core.hooksPath', '.git/hooks')

    const ref1 = protectionRefName(INSTANCE, 1)
    const ref2 = protectionRefName(INSTANCE, 2)
    await createProtectionRef(ctx, ref1, value)
    await updateProtectionRef(ctx, ref1, value2, value)
    await deleteProtectionRef(ctx, ref1, value2)
    await createProtectionRef(ctx, ref2, value)
    expect(deleteProtectionRefSync(ctx, ref2, value)).toBe(true)
    expect(existsSync(marker)).toBe(false)

    // 対照: 普通の git の ref の更新では hook が動く
    runGit(dirs.repo, 'update-ref', 'refs/x', 'HEAD')
    expect(existsSync(marker)).toBe(true)
  })
})

describe('deleteProtectionRefSync', () => {
  const ref = protectionRefName(INSTANCE, 1)
  let value: string
  let other: string

  // ref を value で作っておく
  beforeEach(async () => {
    const tree = commitTree()
    value = await makeProtectionTree(ctx, [{ name: 'baseline', tree }])
    other = await makeProtectionTree(ctx, [{ name: 'run-1', tree }])
    await createProtectionRef(ctx, ref, value)
  })

  it('違う値なら false を返して残る', async () => {
    expect(deleteProtectionRefSync(ctx, ref, other)).toBe(false)
    expect(await readProtectionRef(ctx, ref)).toBe(value)
  })

  it('正しい値なら true を返して消える', async () => {
    expect(deleteProtectionRefSync(ctx, ref, value)).toBe(true)
    expect(await readProtectionRef(ctx, ref)).toBeNull()
  })
})

describe('読み直し(L-002)', () => {
  it('無い ref は null', async () => {
    commitTree()
    expect(await readProtectionRef(ctx, protectionRefName(INSTANCE, 1))).toBeNull()
  })

  it('Git 管理外のフォルダでは reject する(空を「無い」と読まない)', async () => {
    const notRepo = tempDir('agent-protection-notrepo-')
    await expect(
      readProtectionRef(makeCtx(notRepo), protectionRefName(INSTANCE, 1))
    ).rejects.toThrow()
  })
})

describe('項目の存在', () => {
  it('filterExistingProtectionTrees は無い tree の項目を除く', async () => {
    const tree = commitTree()
    expect(
      await filterExistingProtectionTrees(ctx, [
        { name: 'baseline', tree },
        { name: 'run-9', tree: MISSING_TREE }
      ])
    ).toEqual([{ name: 'baseline', tree }])
  })

  it('mktree は無い tree で reject する', async () => {
    commitTree()
    await expect(makeProtectionTree(ctx, [{ name: 'run-9', tree: MISSING_TREE }])).rejects.toThrow()
  })
})

describe('SHA-256・worktree(確認の結果 8)', () => {
  it('SHA-256 のリポジトリで 64 桁の tree の ref を作れる', async () => {
    const repo = tempDir('agent-protection-sha256-')
    runGit(repo, 'init', '-q', '--object-format=sha256', '-b', 'main')
    runGit(repo, 'config', 'user.email', 'test@example.com')
    runGit(repo, 'config', 'user.name', 'test')
    runGit(repo, 'config', 'commit.gpgsign', 'false')
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
    const tree = runGit(repo, 'write-tree').trim()
    expect(tree).toHaveLength(64)
    const c = makeCtx(repo)
    const value = await makeProtectionTree(c, [{ name: 'baseline', tree }])
    const ref = protectionRefName(INSTANCE, 1)
    await createProtectionRef(c, ref, value)
    const read = await readProtectionRef(c, ref)
    expect(read).toHaveLength(64)
    expect(read).toBe(value)
  })

  it('worktree から作った ref は元のリポジトリに出る', async () => {
    const tree = commitTree()
    const wt = join(dirs.repo, '..', `wt-${Math.random().toString(16).slice(2)}`)
    runGit(dirs.repo, 'worktree', 'add', '-q', wt)
    extraDirs.push(wt)
    // worktree の .git はファイルのため、記録のインデックスは元のリポジトリのものを使う
    const c: ProtectionGitContext = { ...makeCtx(wt), indexPath: join(dirs.repo, '.git/index') }
    const value = await makeProtectionTree(c, [{ name: 'baseline', tree }])
    await createProtectionRef(c, protectionRefName(INSTANCE, 1), value)
    expect(refNames()).toBe(`${protectionRefName(INSTANCE, 1)}\n`)
  })
})

describe('push --mirror・clone(確認の結果 7)', () => {
  it('mirror の送り先には出て、clone の先には出ない', async () => {
    const tree = commitTree()
    const value = await makeProtectionTree(ctx, [{ name: 'baseline', tree }])
    await createProtectionRef(ctx, protectionRefName(INSTANCE, 1), value)
    const bare = tempDir('agent-protection-bare-')
    runGit(bare, 'init', '-q', '--bare')
    runGit(dirs.repo, 'push', '-q', '--mirror', bare)
    expect(refNames(bare)).toBe(`${protectionRefName(INSTANCE, 1)}\n`)
    const cloned = join(bare, '..', `clone-${Math.random().toString(16).slice(2)}`)
    extraDirs.push(cloned)
    runGit(bare, 'clone', '-q', bare, cloned)
    expect(refNames(cloned)).toBe('')
  })
})

describe('sweepStaleProtectionRefs', () => {
  it('不要で自分の形の ref だけを消し、形の違うものは残す', async () => {
    const tree = commitTree()
    const index = join(dirs.repo, '.git/index')
    const blob = runGit(dirs.repo, 'rev-parse', 'HEAD:a.txt').trim()
    const baselineValue = await makeProtectionTree(ctx, [{ name: 'baseline', tree }])
    const bothValue = await makeProtectionTree(ctx, [
      { name: 'baseline', tree },
      { name: 'run-1', tree }
    ])
    const runOnlyValue = await makeProtectionTree(ctx, [{ name: 'run-1', tree }])
    const emptyValue = await makeProtectionTree(ctx, [])
    const otherValue = (
      await runBaselineGitWithInput(
        repoLocation(dirs.repo, index),
        ['mktree', '-z'],
        `040000 tree ${tree}\tother\0`
      )
    ).trim()
    const blobChildValue = (
      await runBaselineGitWithInput(
        repoLocation(dirs.repo, index),
        ['mktree', '-z'],
        `100644 blob ${blob}\trun-1\0`
      )
    ).trim()
    const head = runGit(dirs.repo, 'rev-parse', 'HEAD').trim()

    const put = async (name: string, value: string): Promise<void> => {
      runGit(dirs.repo, 'update-ref', name, value)
    }
    const kept: string[] = [
      protectionRefName(INSTANCE, 1),
      protectionRefName('2-00000000', 1),
      protectionRefName('3-00000000', 2),
      protectionRefName('3-00000000', 3),
      protectionRefName('3-00000000', 4),
      protectionRefName('3-00000000', 5),
      'refs/prompt-ide/agent-changes/foo/1'
    ]
    await put(protectionRefName(INSTANCE, 1), baselineValue)
    await put(protectionRefName(INSTANCE, 2), bothValue)
    await put(protectionRefName('3-00000000', 1), runOnlyValue)
    await put(protectionRefName('2-00000000', 1), baselineValue)
    await put(protectionRefName('3-00000000', 2), head)
    await put(protectionRefName('3-00000000', 3), emptyValue)
    await put(protectionRefName('3-00000000', 4), otherValue)
    await put(protectionRefName('3-00000000', 5), blobChildValue)
    await put('refs/prompt-ide/agent-changes/foo/1', baselineValue)

    const keepSerials = vi.fn((): ReadonlySet<number> => new Set([1]))
    await sweepStaleProtectionRefs(ctx, {
      instanceId: INSTANCE,
      keepSerials,
      isProcessAlive: (pid) => pid === 2
    })

    expect(keepSerials).toHaveBeenCalledTimes(1)
    expect(refNames().trim().split('\n').sort()).toEqual([...kept].sort())
  })
})
