import { describe, it, expect } from 'vitest'
import { isExternalHttpUrl } from '../externalUrl'

describe('isExternalHttpUrl', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://localhost:3000', true],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['vscode://open', false],
    ['mailto:a@example.com', false],
    ['not a url', false]
  ])('%s → %s', (url, expected) => {
    expect(isExternalHttpUrl(url)).toBe(expected)
  })
})
