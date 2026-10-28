import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync } from 'fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'os'
import { join } from 'path'
import { getGitStatus } from '../gitService'
import {
  commitAll,
  initRepo,
  runGit,
  stubGitCeiling,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// gitService.test.ts は simple-git をモックするため、status.tracking / status.detached が実際の git の状態で
// どうなるか(gone・ローカルの upstream・リベース中)は検証できない。ここで実 git で固定する
describe('getGitStatus の hasOrigin・hasRemote・upstream・detached(実 git)', () => {
  let root: string
  let repo: string
  let bare: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'status-remote-'))
    repo = join(root, 'repo')
    bare = join(root, 'remote.git')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', '1\n')
    commitAll(repo, 'first')
    runGit(root, 'init', '-q', '--bare', bare)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it('origin が無ければ hasOrigin: false・upstream: null・detached: false', async () => {
    const status = await getGitStatus(repo)
    expect(status).toMatchObject({ hasOrigin: false, upstream: null, detached: false })
  })

  it('origin を追加すると hasOrigin: true(upstream はまだ null)', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    const status = await getGitStatus(repo)
    expect(status).toMatchObject({ hasOrigin: true, upstream: null, detached: false })
  })

  // remote.origin.url が無くても git remote は origin を出し、git remote add は already exists になる(実機で確認)
  it('remote.origin.fetch だけでも hasOrigin: true', async () => {
    runGit(repo, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
    expect((await getGitStatus(repo)).hasOrigin).toBe(true)
  })

  it('push -u の後は upstream: origin/main', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    runGit(repo, 'push', '-q', '-u', 'origin', 'main')
    expect((await getGitStatus(repo)).upstream).toBe('origin/main')
  })

  it('リモートの ref が消えた(gone)後も upstream は origin/main(設定済みとして扱う)', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    runGit(repo, 'push', '-q', '-u', 'origin', 'main')
    runGit(bare, 'update-ref', '-d', 'refs/heads/main')
    runGit(repo, 'fetch', '-q', '--prune', 'origin')
    expect((await getGitStatus(repo)).upstream).toBe('origin/main')
  })

  it('ローカルのブランチを upstream にすると、upstream はその名前', async () => {
    runGit(repo, 'branch', '--track', 'sub', 'main')
    runGit(repo, 'checkout', '-q', 'sub')
    expect((await getGitStatus(repo)).upstream).toBe('main')
  })

  it('detached HEAD では detached: true・upstream: null', async () => {
    runGit(repo, 'remote', 'add', 'origin', bare)
    runGit(repo, 'push', '-q', '-u', 'origin', 'main')
    runGit(repo, 'checkout', '-q', '--detach')
    const status = await getGitStatus(repo)
    expect(status).toMatchObject({ detached: true, upstream: null, hasOrigin: true })
  })

  it('リベースで止めている間も detached: true', async () => {
    writeRepoFile(repo, 'a.txt', '2\n')
    commitAll(repo, 'second')
    // --exec false で 1 つ目のコミットの後に止める(エディタを使わずに「リベース中」を作る)
    try {
      runGit(repo, 'rebase', '--exec', 'false', 'HEAD~1')
    } catch {
      // 意図した停止(終了コード 1)
    }
    expect((await getGitStatus(repo)).detached).toBe(true)
  })

  it('コミットの無いリポジトリでも branch は main・detached: false・upstream: null', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    initRepo(empty)
    const status = await getGitStatus(empty)
    expect(status).toMatchObject({ branch: 'main', detached: false, upstream: null })
  })

  it('リポジトリでなければ false / null / false', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)
    // tmpdir がリポジトリの中にある環境でも、親のリポジトリを拾わない
    stubGitCeiling(root)
    const status = await getGitStatus(plain)
    expect(status).toEqual({
      isRepo: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: [],
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false
    })
  })

  // バナー『リモートが未設定です』はリモートが 1 つも無いときだけ出す。origin 以外の名前のリモートだけを
  // 持つリポジトリ(git clone -o github など)では、既存の push / pull が通信できる(レビュー 8 周目)
  describe('hasRemote(リモートが 1 つでもあるか)', () => {
    it('リモートが 1 つも無いと hasOrigin・hasRemote とも false', async () => {
      expect(await getGitStatus(repo)).toMatchObject({ hasOrigin: false, hasRemote: false })
    })

    it('origin だけなら両方 true', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      expect(await getGitStatus(repo)).toMatchObject({ hasOrigin: true, hasRemote: true })
    })

    it('origin と別名の 2 つなら両方 true', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'remote', 'add', 'github', bare)
      expect(await getGitStatus(repo)).toMatchObject({ hasOrigin: true, hasRemote: true })
    })

    it('git clone -o github したリポジトリでは hasRemote: true・hasOrigin: false・upstream: github/main', async () => {
      runGit(repo, 'push', '-q', bare, 'main')
      const clone = join(root, 'clone')
      runGit(root, 'clone', '-q', '-o', 'github', '-b', 'main', bare, clone)
      expect(await getGitStatus(clone)).toMatchObject({
        hasOrigin: false,
        hasRemote: true,
        upstream: 'github/main'
      })
      // 新しいブランチ(upstream が無い)でも hasRemote は true のまま
      runGit(clone, 'switch', '-q', '-c', 'feat')
      expect(await getGitStatus(clone)).toMatchObject({
        hasOrigin: false,
        hasRemote: true,
        upstream: null
      })
    })
  })
})
