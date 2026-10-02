import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { assertValidNewBranchName, invalidBranchNameError } from '../gitBranchNameGuard'

const mockRaw = vi.fn()
const git = { raw: mockRaw } as unknown as SimpleGit

beforeEach(() => {
  mockRaw.mockReset()
})

// ブランチの作成(gitService の createBranch)とリポジトリの初期化(gitRemoteSetupService の initRepository)が
// 同じ検証を使う(パターン 55・88)。重複・階層の衝突の判定は作成側に残す(初期化にはブランチが無い)
describe('assertValidNewBranchName', () => {
  // '-' 始まりは check-ref-format 自体にもオプションとして解釈されるため、git に渡す前に弾く(パターン 21)
  it("'-' で始まる名前は git を呼ばずに専用の文言で拒否する", async () => {
    await expect(assertValidNewBranchName(git, '-x')).rejects.toThrow(
      '`-` で始まるブランチ名は使用できません: -x'
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  it.each(['', '@'])('%j は git を呼ばずに「使用できない名前」で拒否する', async (name) => {
    await expect(assertValidNewBranchName(git, name)).rejects.toThrow(
      `ブランチ名として使用できない名前です: ${name}`
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  it('check-ref-format --branch の出力(trim)が入力と一致すれば通す', async () => {
    mockRaw.mockResolvedValue('feat/x\n')
    await expect(assertValidNewBranchName(git, 'feat/x')).resolves.toBeUndefined()
    expect(mockRaw).toHaveBeenCalledWith(['check-ref-format', '--branch', 'feat/x'])
  })

  // --branch は @{-1} を直前のブランチ名へ展開して成功扱いにする(パターン 25)
  it('出力が入力と違えば拒否する', async () => {
    mockRaw.mockResolvedValue('main\n')
    await expect(assertValidNewBranchName(git, '@{-1}')).rejects.toThrow(
      'ブランチ名として使用できない名前です: @{-1}'
    )
  })

  // HEAD・a..b・main.lock などは check-ref-format が GitError で reject する(実機で確認)
  it('check-ref-format の reject も同じ文言で拒否する', async () => {
    mockRaw.mockRejectedValue(new Error("fatal: 'a..b' is not a valid branch name"))
    await expect(assertValidNewBranchName(git, 'a..b')).rejects.toThrow(
      'ブランチ名として使用できない名前です: a..b'
    )
  })

  it('invalidBranchNameError は共通の文言を作る', () => {
    expect(invalidBranchNameError('x').message).toBe('ブランチ名として使用できない名前です: x')
  })
})
