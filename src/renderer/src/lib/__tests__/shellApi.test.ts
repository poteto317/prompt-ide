import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openExternalLink } from '../shellApi'

const mockApi = {
  openExternalLink: vi.fn<(url: string) => Promise<boolean>>()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('openExternalLink', () => {
  it('window.api.openExternalLink に URL をそのまま渡し、結果を返す', async () => {
    mockApi.openExternalLink.mockResolvedValueOnce(true)
    await expect(openExternalLink('https://example.com')).resolves.toBe(true)
    expect(mockApi.openExternalLink).toHaveBeenCalledExactlyOnceWith('https://example.com')
  })
})
