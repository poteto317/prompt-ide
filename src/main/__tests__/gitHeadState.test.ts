import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { getCurrentBranchRef } from '../gitHeadState'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  mockRaw.mockReset()
})

// マージ(gitService の isOnBranch)と初回 push(gitRemoteSetupService)が同じ判定を使う(パターン 55)
describe('getCurrentBranchRef', () => {
  it('ブランチ上なら refs/heads/<name> を返す', async () => {
    mockRaw.mockResolvedValue('refs/heads/feat/x\n')
    await expect(getCurrentBranchRef(git)).resolves.toBe('refs/heads/feat/x')
    expect(mockRaw).toHaveBeenCalledWith(['symbolic-ref', '-q', 'HEAD'])
  })

  // detached・リベース中・bisect 中は終了コード 1・stderr 空で、simple-git は空文字で resolve する(実機で確認)
  it('空の出力(ブランチ上にいない)なら null', async () => {
    mockRaw.mockResolvedValue('')
    await expect(getCurrentBranchRef(git)).resolves.toBeNull()
  })

  it('refs/heads/ 以外を指す HEAD は null', async () => {
    mockRaw.mockResolvedValue('refs/remotes/origin/main\n')
    await expect(getCurrentBranchRef(git)).resolves.toBeNull()
  })

  it('reject はそのまま投げる(握りつぶさない。パターン 74)', async () => {
    mockRaw.mockRejectedValue(new Error('fatal: not a git repository'))
    await expect(getCurrentBranchRef(git)).rejects.toThrow('fatal: not a git repository')
  })
})
