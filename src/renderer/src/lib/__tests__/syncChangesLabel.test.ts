import { describe, it, expect } from 'vitest'
import { formatSyncCounts, getSyncChangesAriaLabel } from '../syncChangesLabel'

describe('formatSyncCounts', () => {
  it('両方あれば ↓ を先に並べる', () => {
    expect(formatSyncCounts(1, 2)).toBe('↓2 ↑1')
  })

  it('0 の側は出さない', () => {
    expect(formatSyncCounts(3, 0)).toBe('↑3')
    expect(formatSyncCounts(0, 4)).toBe('↓4')
  })

  it('両方 0 なら空文字', () => {
    expect(formatSyncCounts(0, 0)).toBe('')
  })
})

describe('getSyncChangesAriaLabel', () => {
  it('0 の側も件数を読み上げる', () => {
    expect(getSyncChangesAriaLabel(1, 0)).toBe('変更を同期(プル 0 件、プッシュ 1 件)')
    expect(getSyncChangesAriaLabel(3, 2)).toBe('変更を同期(プル 2 件、プッシュ 3 件)')
  })
})
