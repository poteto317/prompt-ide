import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { pull } from '../gitService'
import {
  commitAll,
  initRepo,
  readRepoFile,
  runGit,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// gitService.test.ts は simple-git をモックするため、コンフリクトのときに git.pull() が例外を投げるかは検証できない。
// 実測では、例外になるかは stderr の有無で変わる(取得済みのマージと autostash の復元は例外にならず、プルの中で
// 取得するマージと rebase は例外になる)。どの形でも同期がプッシュへ進まないよう、実 git で結果を固定する
describe('pull(実 git)', () => {
  let root: string
  let local: string
  let other: string

  const commitOnOther = (content: string): void => {
    writeRepoFile(other, 'a.txt', content)
    commitAll(other, 'リモートの変更')
    runGit(other, 'push', '-q', 'origin', 'main')
  }
  const commitOnLocal = (content: string): void => {
    writeRepoFile(local, 'a.txt', content)
    commitAll(local, 'ローカルの変更')
  }

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = realpathSync(mkdtempSync(join(tmpdir(), 'git-pull-')))
    local = join(root, 'local')
    other = join(root, 'other')
    const origin = join(root, 'origin.git')
    runGit(root, 'init', '-q', '--bare', '-b', 'main', origin)
    runGit(root, 'clone', '-q', origin, other)
    initRepo(other)
    writeRepoFile(other, 'a.txt', 'base')
    commitAll(other, 'base')
    runGit(other, 'push', '-q', '-u', 'origin', 'main')
    runGit(root, 'clone', '-q', origin, local)
    initRepo(local)
    runGit(local, 'config', 'pull.rebase', 'false')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it('コンフリクトが無ければ conflicted: false を返し、リモートの変更が反映される', async () => {
    commitOnOther('remote')
    await expect(pull(local)).resolves.toEqual({ conflicted: false })
    expect(readRepoFile(local, 'a.txt')).toBe('remote')
  })

  it.each([
    ['マージ', 'false'],
    ['rebase', 'true']
  ])('%s: プルの中で取得してコンフリクトすると conflicted: true を返す', async (_, rebase) => {
    runGit(local, 'config', 'pull.rebase', rebase)
    commitOnOther('remote')
    commitOnLocal('local')
    await expect(pull(local)).resolves.toMatchObject({ conflicted: true })
    expect(runGit(local, 'status', '--porcelain')).toContain('UU a.txt')
  })

  it.each([
    ['マージ', 'false'],
    ['rebase', 'true']
  ])('%s: 取得済みの変更でコンフリクトすると conflicted: true を返す', async (_, rebase) => {
    runGit(local, 'config', 'pull.rebase', rebase)
    commitOnOther('remote')
    commitOnLocal('local')
    runGit(local, 'fetch', '-q')
    await expect(pull(local)).resolves.toMatchObject({ conflicted: true })
    expect(runGit(local, 'status', '--porcelain')).toContain('UU a.txt')
  })

  it('autostash の復元でコンフリクトしても conflicted: true を返す', async () => {
    runGit(local, 'config', 'pull.rebase', 'true')
    runGit(local, 'config', 'rebase.autoStash', 'true')
    commitOnOther('remote')
    writeRepoFile(local, 'a.txt', 'dirty')
    await expect(pull(local)).resolves.toMatchObject({ conflicted: true })
    expect(runGit(local, 'status', '--porcelain')).toContain('UU a.txt')
  })

  // 例外になる形のコンフリクトは、公開の pull の表示を変えないよう git の出力を結果で返す
  it('例外になった形のコンフリクトは errorMessage に git の出力を返す', async () => {
    commitOnOther('remote')
    commitOnLocal('local')
    const result = await pull(local)
    expect(result.errorMessage).toContain('CONFLICT')
  })

  it('コンフリクトでない失敗(未コミットの変更と衝突)は例外のまま伝える', async () => {
    commitOnOther('remote')
    writeRepoFile(local, 'a.txt', 'dirty')
    await expect(pull(local)).rejects.toThrow('would be overwritten')
    expect(readRepoFile(local, 'a.txt')).toBe('dirty')
  })
})
