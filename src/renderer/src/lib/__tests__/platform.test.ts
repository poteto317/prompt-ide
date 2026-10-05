import { describe, it, expect } from 'vitest'
import { isMacPlatform } from '../platform'

describe('isMacPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/39', true],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39', false],
    ['Mozilla/5.0 (X11; Linux x86_64) Electron/39', false]
  ])('%s → %s', (userAgent, expected) => {
    expect(isMacPlatform(userAgent)).toBe(expected)
  })
})
