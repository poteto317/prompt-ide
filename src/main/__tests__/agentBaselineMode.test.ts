import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitPluginError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { resolveBaselineMode } from '../agentBaselineMode'
import { AGENT_BASELINE_RECORD_MISSING_MESSAGE } from '../agentBaselineCoverage'

// 方式の決め方(resolveBaselineMode)を偽の git で確かめる。実 git での組み合わせは agentBaselineSnapshot.integration.test.ts

describe('resolveBaselineMode', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir !== null) removeTempPathSync(dir)
    dir = null
  })
  const makeDir = (): string => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'baseline-mode-')))
    return dir
  }

  // checkIsRepo の結果と、raw の引数ごとの応答(関数なら呼ぶ)を持つ偽の git。spy は呼ばれたかの確かめに使う
  const fakeGit = (
    isRepo: boolean,
    answers: Record<string, string | (() => Promise<string>)> = {}
  ): SimpleGit & { checkIsRepo: Mock; raw: Mock } => {
    const checkIsRepo = vi.fn(async () => isRepo)
    const raw = vi.fn(async (args: string[]) => {
      const answer = answers[args.join(' ')]
      if (answer === undefined) throw new Error(`想定外の git: ${args.join(' ')}`)
      return typeof answer === 'function' ? answer() : answer
    })
    return { checkIsRepo, raw } as unknown as SimpleGit & { checkIsRepo: Mock; raw: Mock }
  }
  const notGitDir = async (): Promise<string> => {
    throw new Error('fatal: not a git repository')
  }

  it('最上位のフォルダのリポジトリは repository', async () => {
    const folder = makeDir()
    const git = fakeGit(true, { 'rev-parse --show-toplevel': `${folder}\n` })
    expect(await resolveBaselineMode(folder, git, undefined, () => undefined)).toEqual({
      kind: 'repository'
    })
  })

  it('最上位の表記がリンク越しでも、realpath が同じなら repository', async () => {
    const folder = makeDir()
    const link = join(folder, 'link')
    const real = join(folder, 'real')
    mkdirSync(real)
    symlinkSync(real, link)
    const git = fakeGit(true, { 'rev-parse --show-toplevel': `${real}\n` })
    expect(await resolveBaselineMode(link, git, undefined, () => undefined)).toEqual({
      kind: 'repository'
    })
  })

  it('リポジトリのサブフォルダは not-toplevel', async () => {
    const folder = makeDir()
    const sub = join(folder, 'sub')
    mkdirSync(sub)
    const git = fakeGit(true, { 'rev-parse --show-toplevel': `${folder}\n` })
    expect(await resolveBaselineMode(sub, git, undefined, () => undefined)).toEqual({
      kind: 'unavailable',
      reason: 'not-toplevel'
    })
  })

  it('リポジトリの方式の区切りでは、リポジトリでなければ not-repository で、.git の中かを調べない(隠れた git に切り替えない)', async () => {
    const folder = makeDir()
    const git = fakeGit(false)
    expect(await resolveBaselineMode(folder, git, { gitDir: null }, () => undefined)).toEqual({
      kind: 'unavailable',
      reason: 'not-repository'
    })
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('累積の始点で Git 管理外なら hidden-new', async () => {
    const folder = makeDir()
    const git = fakeGit(false, { 'rev-parse --git-dir': notGitDir })
    expect(await resolveBaselineMode(folder, git, undefined, () => undefined)).toEqual({
      kind: 'hidden-new'
    })
  })

  it('累積の始点で .git の中・bare リポジトリなら inside-git-dir', async () => {
    const folder = makeDir()
    const git = fakeGit(false, { 'rev-parse --git-dir': '.\n' })
    expect(await resolveBaselineMode(folder, git, undefined, () => undefined)).toEqual({
      kind: 'unavailable',
      reason: 'inside-git-dir'
    })
  })

  it('.git の中かの確かめが打ち切られたら投げる(Git 管理外の根拠にしない)', async () => {
    const folder = makeDir()
    const timeout = new GitPluginError(undefined, 'timeout', 'block timeout reached')
    const git = fakeGit(false, {
      'rev-parse --git-dir': async () => {
        throw timeout
      }
    })
    await expect(resolveBaselineMode(folder, git, undefined, () => undefined)).rejects.toBe(timeout)
  })

  it('隠れた git の区切りは、フォルダを調べ直さずに base の gitDir を使う(L-041)', async () => {
    const folder = makeDir()
    const gitDir = join(folder, 'git')
    mkdirSync(gitDir)
    const git = fakeGit(true)
    expect(await resolveBaselineMode(folder, git, { gitDir }, () => undefined)).toEqual({
      kind: 'hidden',
      gitDir
    })
    expect(git.checkIsRepo).not.toHaveBeenCalled()
    expect(git.raw).not.toHaveBeenCalled()
  })

  it.each([
    ['無い', (gitDir: string): void => void gitDir],
    ['ファイル', (gitDir: string): void => writeFileSync(gitDir, '')],
    [
      'シンボリックリンク',
      (gitDir: string): void => {
        mkdirSync(`${gitDir}-real`)
        symlinkSync(`${gitDir}-real`, gitDir)
      }
    ]
  ])('隠れた git の区切りで、共有の隠れた git が%sなら例外(新しく作らない)', async (_, prepare) => {
    const folder = makeDir()
    const gitDir = join(folder, 'git')
    prepare(gitDir)
    const git = fakeGit(false)
    await expect(resolveBaselineMode(folder, git, { gitDir }, () => undefined)).rejects.toThrow(
      AGENT_BASELINE_RECORD_MISSING_MESSAGE
    )
    expect(git.checkIsRepo).not.toHaveBeenCalled()
  })

  it('await のたびに checkpoint を呼び、投げたらそこで止める', async () => {
    const folder = makeDir()
    const git = fakeGit(true, { 'rev-parse --show-toplevel': `${folder}\n` })
    const canceled = new Error('取り消し')
    const checkpoint = vi.fn(() => {
      throw canceled
    })
    await expect(resolveBaselineMode(folder, git, undefined, checkpoint)).rejects.toBe(canceled)
    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(git.raw).not.toHaveBeenCalled()
  })
})
