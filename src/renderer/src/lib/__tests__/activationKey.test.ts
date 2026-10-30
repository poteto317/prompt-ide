import { describe, it, expect } from 'vitest'
import { isActivationKey } from '../activationKey'

describe('isActivationKey', () => {
  it.each(['Enter', ' '])('%j は押す操作のキー', (key) => {
    expect(isActivationKey(key)).toBe(true)
  })

  it.each(['Escape', 'Tab', 'ArrowDown', 'a', 'Spacebar', 'enter', ''])(
    '%j は押す操作のキーではない',
    (key) => {
      expect(isActivationKey(key)).toBe(false)
    }
  )
})
