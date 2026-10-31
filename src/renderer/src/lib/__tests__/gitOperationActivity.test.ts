import { describe, it, expect } from 'vitest'
import { isAnyGitOperationRunning } from '../gitOperationActivity'
import type { GitOperationActivity } from '../gitOperationActivity'

const idle: GitOperationActivity = {
  isAnyLocked: false,
  isPushing: false,
  isFetching: false,
  isSettingUpstream: false,
  pendingBranchOperation: null,
  stashPendingOperation: null,
  isCreatingTag: false,
  isInitializing: false,
  isAddingOrigin: false
}

describe('isAnyGitOperationRunning', () => {
  it('どの操作も実行中でなければ false', () => {
    expect(isAnyGitOperationRunning(idle)).toBe(false)
  })

  // 項目を 1 つずつ実行中にする。どの項目を合成から外しても、その項目の行が落ちる
  it.each<[string, Partial<GitOperationActivity>]>([
    ['ロック(isAnyLocked)', { isAnyLocked: true }],
    ['push(isPushing)', { isPushing: true }],
    ['fetch(isFetching)', { isFetching: true }],
    ['初回 push(isSettingUpstream)', { isSettingUpstream: true }],
    ['ブランチの操作(pendingBranchOperation)', { pendingBranchOperation: 'delete' }],
    [
      'stash の操作(stashPendingOperation)',
      { stashPendingOperation: { kind: 'drop', sha: 'abc' } }
    ],
    ['タグの作成(isCreatingTag)', { isCreatingTag: true }],
    ['初期化(isInitializing)', { isInitializing: true }],
    ['origin の追加(isAddingOrigin)', { isAddingOrigin: true }]
  ])('%s だけが実行中なら true', (_label, running) => {
    expect(isAnyGitOperationRunning({ ...idle, ...running })).toBe(true)
  })

  // 実行中の操作は「null か否か」で見る(種類は問わない)
  it.each(['checkout', 'create', 'delete', 'merge'] as const)(
    'pendingBranchOperation が %s なら true',
    (kind) => {
      expect(isAnyGitOperationRunning({ ...idle, pendingBranchOperation: kind })).toBe(true)
    }
  )

  it.each([
    { kind: 'push', sha: null },
    { kind: 'pop', sha: 'abc' },
    { kind: 'drop', sha: 'def' }
  ] as const)('stashPendingOperation が $kind なら true', (operation) => {
    expect(isAnyGitOperationRunning({ ...idle, stashPendingOperation: operation })).toBe(true)
  })
})
