import { describe, it, expect } from 'vitest'
import { buildMergeConfirmMessage } from '../branchMerge'

describe('buildMergeConfirmMessage', () => {
  it('マージ元・マージ先のブランチ名と、コンフリクト時はマージ中の状態で止まる旨を含める', () => {
    expect(buildMergeConfirmMessage('feature/x', 'main')).toBe(
      'feature/x を main にマージしますか？\n\nコンフリクトした場合はマージ中の状態で止まります。解決するか、マージを中止できます。'
    )
  })

  it('古い「自動で中止して元に戻す」という案内を含まない', () => {
    expect(buildMergeConfirmMessage('feature/x', 'main')).not.toContain('自動で中止')
  })
})
