import { describe, it, expect, vi } from 'vitest'
import { GitError, GitPluginError } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { isInsideGitDirectory } from '../gitRepoDetection'

// Git のデータのフォルダ(bare リポジトリ・.git の中)の判定を偽の git で確かめる。
// 実 git での組み合わせは gitRemoteSetupService.integration.test.ts・agentBaselineSnapshot.integration.test.ts

function fakeGit(raw: () => Promise<string>): Pick<SimpleGit, 'raw'> {
  return { raw: vi.fn(raw) as unknown as SimpleGit['raw'] }
}

describe('isInsideGitDirectory', () => {
  it('rev-parse --git-dir が成功すれば true(出力の中身は見ない)', async () => {
    const git = fakeGit(async () => '.\n')
    await expect(isInsideGitDirectory(git)).resolves.toBe(true)
    expect(git.raw).toHaveBeenCalledWith(['rev-parse', '--git-dir'])
  })

  it('出力が空でも成功なら true', async () => {
    await expect(isInsideGitDirectory(fakeGit(async () => ''))).resolves.toBe(true)
  })

  it('git の失敗(not a git repository)はリポジトリの外として false', async () => {
    const git = fakeGit(async () => {
      throw new GitError(undefined, 'fatal: not a git repository')
    })
    await expect(isInsideGitDirectory(git)).resolves.toBe(false)
  })

  it('Error 以外の値で reject しても false(文言では分岐しない)', async () => {
    const git = fakeGit(() => Promise.reject('unexpected'))
    await expect(isInsideGitDirectory(git)).resolves.toBe(false)
  })

  it('打ち切り(timeout プラグインの GitPluginError)は false に読み替えず、そのまま投げる', async () => {
    const timeout = new GitPluginError(undefined, 'timeout', 'block timeout reached')
    const git = fakeGit(async () => {
      throw timeout
    })
    await expect(isInsideGitDirectory(git)).rejects.toBe(timeout)
  })

  it('timeout 以外のプラグインの失敗は打ち切りではないので false', async () => {
    const git = fakeGit(async () => {
      throw new GitPluginError(undefined, 'spawnOptions', 'invalid spawn options')
    })
    await expect(isInsideGitDirectory(git)).resolves.toBe(false)
  })
})
