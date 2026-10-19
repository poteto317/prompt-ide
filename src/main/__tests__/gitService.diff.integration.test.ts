import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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
    rmSync(root, { recursive: true, force: true })
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
