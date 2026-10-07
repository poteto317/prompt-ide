import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import {
  AGENT_BASELINE_GIT_TIMEOUT_MS,
  REPO_LOCATION_ENV_KEYS,
  SIMPLE_GIT_BLOCKED_ENV_KEYS,
  buildBaselineGitEnv,
  createBaselineGit
} from '../agentBaselineGit'
import { commitAll, runGit, writeRepoFile } from './helpers/realGitRepo'
import { createAgentBaselineRepo, disposeAgentBaselineRepo } from './helpers/agentBaselineFixtures'

// simple-git 3.36.0(@simple-git/argv-parser)が env() で拒否する変数。実装の一覧(SIMPLE_GIT_BLOCKED_ENV_KEYS)とは
// 別にリテラルで持ち、実装から 1 個消えたら落ちるようにする。版を上げて一覧が変わったら、実際に拒否されるかのテストと一緒に見直す
const EXPECTED_BLOCKED_ENV_KEYS = [
  'EDITOR',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_EDITOR',
  'GIT_EXEC_PATH',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_PROXY_COMMAND',
  'GIT_SEQUENCE_EDITOR',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TEMPLATE_DIR',
  'PAGER',
  'PREFIX',
  'SSH_ASKPASS'
] as const

// 記録用の git から外す、利用者の別のリポジトリ・別の場所を指しうる変数(simple-git が拒否するものとは別)。
// 実装の一覧(REPO_LOCATION_ENV_KEYS)とは別にリテラルで持つ(最終レビュー A の M7)
const EXPECTED_REPO_LOCATION_ENV_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE'
] as const

describe('buildBaselineGitEnv', () => {
  it('simple-git が拒否する変数と位置の変数を外し、GIT_INDEX_FILE を記録のインデックスにする', () => {
    const env = buildBaselineGitEnv(
      {
        PATH: '/usr/bin',
        HOME: '/home/me',
        LANG: 'ja_JP.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        EDITOR: 'vim',
        GIT_ASKPASS: '/askpass',
        SSH_ASKPASS: '/askpass',
        PAGER: 'less',
        GIT_PAGER: 'less',
        GIT_SSH_COMMAND: 'ssh -i key',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.pager',
        GIT_CONFIG_VALUE_0: 'cat',
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/elsewhere',
        GIT_INDEX_FILE: '/elsewhere/.git/index',
        UNDEFINED_VALUE: undefined
      },
      '/tmp/baseline/index'
    )
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/me',
      LANG: 'ja_JP.UTF-8',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_INDEX_FILE: '/tmp/baseline/index'
    })
  })

  it('大文字小文字の違う変数名も外す(simple-git は小文字にして比べる)', () => {
    expect(buildBaselineGitEnv({ Editor: 'vim', git_askpass: '/a' }, '/i')).toEqual({
      GIT_INDEX_FILE: '/i'
    })
  })

  it('実装の一覧は simple-git が拒否する変数(テストのリテラル)と過不足なく一致する', () => {
    expect([...SIMPLE_GIT_BLOCKED_ENV_KEYS].sort()).toEqual(
      EXPECTED_BLOCKED_ENV_KEYS.map((key) => key.toLowerCase()).sort()
    )
  })

  it('実装の位置の変数の一覧は、テストのリテラルと過不足なく一致する', () => {
    expect([...REPO_LOCATION_ENV_KEYS].sort()).toEqual(
      EXPECTED_REPO_LOCATION_ENV_KEYS.map((key) => key.toLowerCase()).sort()
    )
  })

  it.each(EXPECTED_REPO_LOCATION_ENV_KEYS)(
    '位置の変数 %s を外す(GIT_INDEX_FILE は記録のインデックスで置き換える)',
    (key) => {
      expect(buildBaselineGitEnv({ PATH: '/usr/bin', [key]: '/elsewhere' }, '/i')).toEqual({
        PATH: '/usr/bin',
        GIT_INDEX_FILE: '/i'
      })
    }
  )

  it.each(EXPECTED_BLOCKED_ENV_KEYS)('%s を外す', (key) => {
    expect(buildBaselineGitEnv({ [key]: 'x' }, '/i')).toEqual({
      GIT_INDEX_FILE: '/i'
    })
  })
})

// 実 git で、記録のインデックスで問い合わせられること・利用者の index に触れないことを確かめる
describe('createBaselineGit(実 git)', () => {
  let repo: string
  let home: string
  let indexDir: string

  beforeEach(() => {
    // indexDir は記録のインデックスを置く一時ディレクトリ(tempRoot と同じ役割)
    ;({ repo, home, tempRoot: indexDir } = createAgentBaselineRepo('baseline-git-'))
    writeRepoFile(repo, 'a.txt', 'a\n')
    commitAll(repo, 'init')
  })

  afterEach(() => disposeAgentBaselineRepo({ repo, home, tempRoot: indexDir }))

  it('EDITOR・GIT_ASKPASS・GIT_DIR がある環境でも例外にならず、記録のインデックスで問い合わせる', async () => {
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    writeRepoFile(repo, 'new.txt', 'n\n')
    const headBefore = runGit(repo, 'rev-parse', 'HEAD')
    const refsBefore = runGit(repo, 'for-each-ref')
    const stashBefore = runGit(repo, 'stash', 'list')
    const statusBefore = runGit(repo, 'status', '--porcelain')
    // git status は index の stat 情報を書き直しうるため、index のバイト列は git の状態を取った後に取る
    const userIndexBefore = readFileSync(join(repo, '.git/index'))
    const mtimeBefore = statSync(join(repo, '.git/index')).mtimeMs
    const git = createBaselineGit(repo, index, {
      env: {
        ...process.env,
        EDITOR: 'vim',
        GIT_ASKPASS: '/nonexistent/askpass',
        GIT_DIR: join(home, 'not-a-repo')
      }
    })
    await git.raw(['add', '-A'])
    const listed = await git.raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt', 'new.txt'])
    // 利用者の index には new.txt が無く、書き換わってもいない
    expect(readFileSync(join(repo, '.git/index'))).toEqual(userIndexBefore)
    expect(statSync(join(repo, '.git/index')).mtimeMs).toBe(mtimeBefore)
    // 利用者の HEAD・ref・stash・状態も変わらない
    expect(runGit(repo, 'rev-parse', 'HEAD')).toBe(headBefore)
    expect(runGit(repo, 'for-each-ref')).toBe(refsBefore)
    expect(runGit(repo, 'stash', 'list')).toBe(stashBefore)
    expect(runGit(repo, 'status', '--porcelain')).toBe(statusBefore)
  })

  // 前提の固定: simple-git の env() に GIT_ASKPASS を含めると拒否される(除かないと使えない理由)
  it('前提: 変数を除かずに env() へ渡すと simple-git が拒否する', async () => {
    const git = simpleGit(repo).env({ PATH: process.env.PATH, GIT_ASKPASS: '/nonexistent/askpass' })
    await expect(git.raw(['ls-files'])).rejects.toThrow(
      'Use of "GIT_ASKPASS" is not permitted without enabling allowUnsafeAskPass'
    )
  })

  // 前提の固定: 一覧の各変数は、除かずに env() へ渡すと simple-git が実際に拒否する
  it.each(EXPECTED_BLOCKED_ENV_KEYS)(
    '前提: %s を env() へ渡すと simple-git が拒否する',
    async (key) => {
      const git = simpleGit(repo).env({ PATH: process.env.PATH, [key]: '/nonexistent/value' })
      await expect(git.raw(['ls-files'])).rejects.toThrow(`Use of "${key}" is not permitted`)
    }
  )

  // 各変数が process.env にあっても、createBaselineGit は外して問い合わせられる(GIT_CONFIG_GLOBAL・GIT_CONFIG_SYSTEM が
  // 子へ渡らないという既知の制約もここで固定する)
  it.each(EXPECTED_BLOCKED_ENV_KEYS)('%s が process.env にあっても例外にならない', async (key) => {
    vi.stubEnv(key, '/nonexistent/value')
    const index = join(indexDir, 'index')
    copyFileSync(join(repo, '.git/index'), index)
    const listed = await createBaselineGit(repo, index).raw(['ls-files', '-z'])
    expect(listed.split('\0').filter((p) => p !== '')).toEqual(['a.txt'])
  })

  // 既知の制約の固定: GIT_CONFIG_GLOBAL は渡らず、HOME の .gitconfig を読む(テストは stubGitHome で隔離する)
  it('GIT_CONFIG_GLOBAL は子へ渡らず、HOME の設定(core.excludesFile)を読む', async () => {
    const excludes = join(home, 'excludes')
    writeFileSync(excludes, 'ignored-by-home.txt\n')
    writeFileSync(join(home, '.gitconfig'), `[core]\n\texcludesFile = ${excludes}\n`)
    writeRepoFile(repo, 'ignored-by-home.txt', 'x\n')
    const index = join(indexDir, 'index')
    const git = createBaselineGit(repo, index)
    const others = await git.raw(['ls-files', '-z', '--others', '--exclude-standard'])
    expect(others.split('\0')).not.toContain('ignored-by-home.txt')
  })
})

describe('AGENT_BASELINE_GIT_TIMEOUT_MS', () => {
  it('git の 1 回の打ち切りは 10 秒', () => {
    expect(AGENT_BASELINE_GIT_TIMEOUT_MS).toBe(10_000)
  })
})
