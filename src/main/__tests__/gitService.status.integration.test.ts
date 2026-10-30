import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync } from 'fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'os'
import { join } from 'path'
import { getBranches, getGitStatus } from '../gitService'
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

// simple-git の branchLocal() がブランチ上にいないときに返す疑似項目は、状態によって名前も detached の値も違う
// (実 git で確認)。形の推測で固定しないよう、実 git で検証する
describe('getBranches の isDetachedHead(実 git)', () => {
  let root: string
  let repo: string

  const detachedHeadNames = async (): Promise<string[]> =>
    (await getBranches(repo)).filter((branch) => branch.isDetachedHead).map((branch) => branch.name)

  beforeEach(() => {
    stubIsolatedGitEnv()
    root = mkdtempSync(join(tmpdir(), 'branches-detached-'))
    repo = join(root, 'repo')
    mkdirSync(repo)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', '1\n')
    commitAll(repo, 'first')
    writeRepoFile(repo, 'a.txt', '2\n')
    commitAll(repo, 'second')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    removeTempPathSync(root)
  })

  it('ブランチ上では、どの項目にも欄を付けない', async () => {
    runGit(repo, 'branch', 'dev')
    await expect(getBranches(repo)).resolves.toStrictEqual([
      { name: 'dev', current: false },
      { name: 'main', current: true }
    ])
  })

  it('コミットの無いリポジトリでは空を返す', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    initRepo(empty)
    await expect(getBranches(empty)).resolves.toStrictEqual([])
  })

  it('コミットを指して detached にすると、短い SHA の疑似項目に印が付く', async () => {
    const sha = runGit(repo, 'rev-parse', '--short', 'HEAD').trim()
    runGit(repo, 'checkout', '-q', sha)
    await expect(getBranches(repo)).resolves.toStrictEqual([
      { name: sha, current: true, isDetachedHead: true },
      { name: 'main', current: false }
    ])
  })

  it('ブランチ名を指して detached にすると、refs/heads/main の疑似項目に印が付く', async () => {
    runGit(repo, 'checkout', '-q', '--detach', 'main')
    await expect(getBranches(repo)).resolves.toStrictEqual([
      { name: 'refs/heads/main', current: true, isDetachedHead: true },
      { name: 'main', current: false }
    ])
  })

  it('リベースで止めている間も、疑似項目に印が付き、実在のブランチには付かない', async () => {
    // --exec false で 1 つ目のコミットの後に止める(エディタを使わずに「リベース中」を作る)
    try {
      runGit(repo, 'rebase', '--exec', 'false', 'HEAD~1')
    } catch {
      // 意図した停止(終了コード 1)
    }
    await expect(detachedHeadNames()).resolves.toEqual(['(no'])
    await expect(getBranches(repo)).resolves.toContainEqual({ name: 'main', current: false })
  })

  it('bisect の間も、疑似項目に印が付き、実在のブランチには付かない', async () => {
    writeRepoFile(repo, 'a.txt', '3\n')
    commitAll(repo, 'third')
    runGit(repo, 'bisect', 'start')
    runGit(repo, 'bisect', 'bad', 'HEAD')
    runGit(repo, 'bisect', 'good', 'HEAD~2')
    await expect(detachedHeadNames()).resolves.toEqual(['(no'])
    await expect(getBranches(repo)).resolves.toContainEqual({ name: 'main', current: false })
  })
})
