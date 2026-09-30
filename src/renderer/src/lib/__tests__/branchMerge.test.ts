import { describe, it, expect } from 'vitest'
import { buildMergeConfirmMessage } from '../branchMerge'

describe('buildMergeConfirmMessage', () => {
  it('マージ元・マージ先のブランチ名と、コンフリクト時に自動で中止する旨を含める', () => {
    expect(buildMergeConfirmMessage('feature/x', 'main')).toBe(
      'feature/x を main にマージしますか？\n\nコンフリクトした場合は自動で中止して元に戻します。'
    )
  })
})
