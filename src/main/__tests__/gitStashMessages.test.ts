import { describe, it, expect } from 'vitest'
import { buildStashRestoreFailureMessage } from '../gitStashMessages'

describe('buildStashRestoreFailureMessage', () => {
  it('コンフリクトがあればファイル名を添える', () => {
    expect(buildStashRestoreFailureMessage(['a.txt', 'b.txt'])).toBe(
      'stash の変更を作業ツリーへ戻せなかったため、戻す前の状態にしました。stash は残っています（コンフリクト: a.txt, b.txt）'
    )
  })

  // formatConflictFiles(gitMergeMessages.ts)と同じ 5 件まで・ほか N 件の書式
  it('ファイルは 5 件まで表示し、超えた分は「ほか N 件」にする', () => {
    expect(
      buildStashRestoreFailureMessage(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `${n}.txt`))
    ).toBe(
      'stash の変更を作業ツリーへ戻せなかったため、戻す前の状態にしました。stash は残っています（コンフリクト: a.txt, b.txt, c.txt, d.txt, e.txt ほか 2 件）'
    )
  })

  it('コンフリクトが無い失敗(同名のファイルがある等)は、その旨の定型文にする', () => {
    expect(buildStashRestoreFailureMessage([])).toBe(
      'stash の変更を作業ツリーへ戻せなかったため、戻す前の状態にしました。stash は残っています（同名のファイルがあるなど、git が復元を完了できませんでした）'
    )
  })
})
