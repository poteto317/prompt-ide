import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDiff } from '../gitService'
import {
  commitAll,
  initRepo,
  runGit,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// 利用者の gitconfig の diff.suppressBlankEmpty=true は、空の文脈行を先頭の空白なしの空行で出させる。ハンクの破棄の
// パッチの検査(gitHunkPatch)が食い違いとして拒否するため、getDiff はこの設定を打ち消す
// (gitService.test.ts は simple-git をモックするので、実 git の出力をここで固定する)
describe('getDiff と利用者の diff.suppressBlankEmpty(実 git)', () => {
  let root: string
  let repo: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'git-diff-blank-'))
    repo = join(root, 'repo')
    const globalConfig = join(root, 'gitconfig')
    writeFileSync(globalConfig, '[diff]\n\tsuppressBlankEmpty = true\n')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', 'a1\n\na3\n')
    commitAll(repo, 'first')
    // 初期化とコミットの後に、対象の関数が起動する git だけが読む大域の設定にする
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it.each([
    ['未ステージ', false],
    ['ステージ済み', true]
  ])('%sの diff でも、空の文脈行に先頭の空白を付ける', async (_label, staged) => {
    writeRepoFile(repo, 'a.txt', 'a1\n\nA3\n')
    if (staged) runGit(repo, 'add', 'a.txt')
    const diff = await getDiff(repo, 'a.txt', staged, false)
    expect(diff).toContain('\n \n')
    expect(diff.split('\n').slice(0, -1)).not.toContain('')
  })
})

// 内容が同じで更新時刻だけ変わったファイルがあると、ふつうの git diff は .git/index.lock を取って .git/index を書き直す
// (GIT_OPTIONAL_LOCKS=0 では止まらない)。監視が外の書き直しを契機に diff を取り直すので、その間に外の git add・commit が
// index.lock の取り合いで失敗しうる。getDiff は diff.autoRefreshIndex=false で書かせない(設計書 2026-11-08 の 1 章の 10)
describe('getDiff は .git/index を書かない(実 git)', () => {
  let root: string
  let repo: string
  let indexPath: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'git-diff-no-refresh-'))
    repo = join(root, 'repo')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', '1\n')
    writeRepoFile(repo, 'b.txt', 'b1\n')
    commitAll(repo, 'first')
    indexPath = join(repo, '.git', 'index')
    // 同じ内容のまま更新時刻だけ変える(stat の情報だけが index と食い違う)
    const future = new Date('2099-01-01T00:00:00Z')
    utimesSync(join(repo, 'a.txt'), future, future)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it('stat だけ変わったファイルの未ステージの diff は空で、.git/index の mtime と中身が変わらない', async () => {
    const mtimeBefore = statSync(indexPath).mtimeMs
    const contentBefore = readFileSync(indexPath)
    await expect(getDiff(repo, 'a.txt', false, false)).resolves.toBe('')
    expect(statSync(indexPath).mtimeMs).toBe(mtimeBefore)
    expect(readFileSync(indexPath).equals(contentBefore)).toBe(true)
  })

  it('内容が変わったファイルの未ステージの diff は今どおり出て、.git/index は変わらない', async () => {
    writeRepoFile(repo, 'b.txt', 'b2\n')
    const contentBefore = readFileSync(indexPath)
    const diff = await getDiff(repo, 'b.txt', false, false)
    expect(diff).toContain('diff --git a/b.txt b/b.txt')
    expect(diff).toContain('-b1\n+b2\n')
    expect(readFileSync(indexPath).equals(contentBefore)).toBe(true)
  })
})

// 未ステージの diff の pathspec がサブモジュール(gitlink)だと、git diff は dirty かを調べるためサブモジュールの中で
// git status を起動する。その子は GIT_OPTIONAL_LOCKS が無いと .git/modules/<sub>/index.lock を取り、stat が古ければ
// index も書き直す(diff.autoRefreshIndex=false は親の書き直ししか止めない)。その間にサブモジュールの中の git add が
// index.lock の取り合いで失敗しうるため、getDiff は GIT_OPTIONAL_LOCKS=0 で子にもロックを取らせない(設計書 2026-11-08 の 1 章の 10)
describe('getDiff はサブモジュールの index を書かない(実 git)', () => {
  let root: string
  let repo: string
  let subIndexPath: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'git-diff-submodule-'))
    const subSource = join(root, 'sub-source')
    repo = join(root, 'repo')
    mkdirSync(subSource)
    initRepo(subSource)
    writeRepoFile(subSource, 's.txt', 's1\n')
    commitAll(subSource, 'sub first')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', '1\n')
    commitAll(repo, 'first')
    runGit(repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSource, 'sub')
    runGit(repo, 'commit', '-qm', 'add sub')
    subIndexPath = join(repo, '.git', 'modules', 'sub', 'index')
    // サブモジュールの中のファイルの内容を変えて dirty にし、更新時刻も未来にして stat の情報を index と食い違わせる
    writeRepoFile(join(repo, 'sub'), 's.txt', 's2\n')
    const future = new Date('2099-01-01T00:00:00Z')
    utimesSync(join(repo, 'sub', 's.txt'), future, future)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it('サブモジュールの未ステージの diff は -dirty を出し、.git/modules/sub/index の mtime と中身が変わらない', async () => {
    const mtimeBefore = statSync(subIndexPath).mtimeMs
    const contentBefore = readFileSync(subIndexPath)
    const diff = await getDiff(repo, 'sub', false, false)
    expect(diff).toMatch(/^\+Subproject commit [0-9a-f]{40}-dirty$/m)
    expect(statSync(subIndexPath).mtimeMs).toBe(mtimeBefore)
    expect(readFileSync(subIndexPath).equals(contentBefore)).toBe(true)
  })
})
