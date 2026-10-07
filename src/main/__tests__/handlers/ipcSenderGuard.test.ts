import { describe, it, expect } from 'vitest'
import { isMainFrameSender } from '../../handlers/ipcSenderGuard'

describe('isMainFrameSender', () => {
  it('親の無いフレーム(メインフレーム)だけを通す', () => {
    expect(isMainFrameSender({ senderFrame: { parent: null } })).toBe(true)
  })

  it('親のあるフレーム(iframe などのサブフレーム)は通さない', () => {
    expect(isMainFrameSender({ senderFrame: { parent: {} } })).toBe(false)
  })

  it('送信元のフレームが null(破棄済み・ナビゲーション済み)なら通さない', () => {
    expect(isMainFrameSender({ senderFrame: null })).toBe(false)
  })

  it('parent が undefined のフレームは通さない(null と厳密に一致するときだけ通す)', () => {
    expect(isMainFrameSender({ senderFrame: { parent: undefined } })).toBe(false)
  })
})
