import { describe, it, expect } from 'vitest'
import { getBranchTriggerLabel } from '../branchTriggerLabel'

describe('getBranchTriggerLabel', () => {
  it('通常時は現在ブランチ名と「ブランチを切り替え」', () => {
    expect(
      getBranchTriggerLabel({
        pendingBranchOperation: null,
        isBlocked: false,
        currentBranch: 'main'
      })
    ).toEqual({ text: 'main', ariaLabel: 'ブランチを切り替え' })
  })

  it('現在ブランチが無い(detached 等)ときは "(no branch)"', () => {
    expect(
      getBranchTriggerLabel({ pendingBranchOperation: null, isBlocked: false, currentBranch: null })
    ).toEqual({ text: '(no branch)', ariaLabel: 'ブランチを切り替え' })
  })

  // 他操作の完了待ちは「実行中」ではないため、表示テキストは変えずに aria-label だけ変える
  it('他操作中は表示テキストを変えず、aria-label だけを完了待ちの文言にする', () => {
    expect(
      getBranchTriggerLabel({
        pendingBranchOperation: null,
        isBlocked: true,
        currentBranch: 'main'
      })
    ).toEqual({ text: 'main', ariaLabel: '他の操作が完了するまでブランチを切り替えられません' })
  })

  it.each([
    ['checkout', '切り替え中...', 'ブランチ切り替え中'],
    ['create', '作成中...', 'ブランチ作成中'],
    ['delete', '削除中...', 'ブランチ削除中'],
    ['merge', 'マージ中...', 'ブランチのマージ中']
  ] as const)('%s 実行中は表示テキストと aria-label を同期させる', (kind, text, ariaLabel) => {
    expect(
      getBranchTriggerLabel({
        pendingBranchOperation: kind,
        isBlocked: false,
        currentBranch: 'main'
      })
    ).toEqual({ text, ariaLabel })
  })

  // 自身の操作の実行中は、他操作によるブロック表示より「何をしているか」を優先して伝える
  it('実行中かつ他操作中のときは実行中の文言を優先する', () => {
    expect(
      getBranchTriggerLabel({
        pendingBranchOperation: 'create',
        isBlocked: true,
        currentBranch: 'main'
      })
    ).toEqual({ text: '作成中...', ariaLabel: 'ブランチ作成中' })
  })
})
