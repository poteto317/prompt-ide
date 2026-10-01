import { describe, it, expect } from 'vitest'
import { getStashDisplayName } from '../stashDisplayName'

describe('getStashDisplayName', () => {
  it('メッセージがあればそのまま返す', () => {
    expect(getStashDisplayName('fix bug')).toBe('fix bug')
  })
  it('メッセージが空なら (メッセージなし)', () => {
    expect(getStashDisplayName('')).toBe('(メッセージなし)')
  })
})
