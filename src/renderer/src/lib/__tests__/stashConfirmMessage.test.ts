import { describe, it, expect } from 'vitest'
import { buildStashDropConfirmMessage } from '../stashConfirmMessage'

describe('buildStashDropConfirmMessage', () => {
  it('メッセージを含め、元に戻せないことを伝える', () => {
    expect(buildStashDropConfirmMessage('fix bug')).toBe(
      'fix bug を捨てますか？この操作は元に戻せません。'
    )
  })
  it('メッセージが空のときは「この退避」と言う', () => {
    expect(buildStashDropConfirmMessage('')).toBe(
      'この退避を捨てますか？この操作は元に戻せません。'
    )
  })
})
