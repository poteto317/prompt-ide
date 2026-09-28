import { describe, it, expect } from 'vitest'
import { parseWorktreeBranches } from '../gitWorktreeParser'

// 出力形式は git worktree list --porcelain(実機 git 2.50.1 で確認)。
// worktree ごとに空行で区切られ、チェックアウト中のブランチがあれば
// `branch refs/heads/<name>` 行、detached なら `detached` 行が出る
describe('parseWorktreeBranches', () => {
  it('各 worktree の branch 行からブランチ名を集める', () => {
    const output =
      'worktree /project\nHEAD abc\nbranch refs/heads/main\n\n' +
      'worktree /other\nHEAD def\nbranch refs/heads/feature/x\n'
    expect(parseWorktreeBranches(output)).toEqual(new Set(['main', 'feature/x']))
  })

  it('detached の worktree はブランチ名に含めない', () => {
    const output =
      'worktree /project\nHEAD abc\nbranch refs/heads/main\n\n' +
      'worktree /other\nHEAD def\ndetached\n'
    expect(parseWorktreeBranches(output)).toEqual(new Set(['main']))
  })

  it('空の出力は空集合', () => {
    expect(parseWorktreeBranches('')).toEqual(new Set())
  })

  // Windows の git は CRLF で出力することがあるため、行末の \r を名前に含めない
  it('CRLF の改行でも行末の \\r をブランチ名に含めない', () => {
    const output = 'worktree C:/project\r\nHEAD abc\r\nbranch refs/heads/main\r\n'
    expect(parseWorktreeBranches(output)).toEqual(new Set(['main']))
  })

  // refs/heads 以外(将来の形式変更や bare の worktree 等)は拾わない
  it('refs/heads/ 以外を指す branch 行は無視する', () => {
    const output = 'worktree /project\nbare\nbranch refs/remotes/origin/main\n'
    expect(parseWorktreeBranches(output)).toEqual(new Set())
  })
})
