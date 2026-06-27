import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCLIPrompt } from '../cliApi'

const mockRunCLIPrompt = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { api: { runCLIPrompt: mockRunCLIPrompt } })
})

describe('cliApi', () => {
  it('runCLIPrompt が window.api.runCLIPrompt に委譲する', async () => {
    mockRunCLIPrompt.mockResolvedValue('CLI結果')
    const result = await runCLIPrompt('claude', 'テストプロンプト')
    expect(mockRunCLIPrompt).toHaveBeenCalledWith('claude', 'テストプロンプト')
    expect(result).toBe('CLI結果')
  })

  it('window.api.runCLIPrompt が throw したとき伝播する', async () => {
    mockRunCLIPrompt.mockRejectedValue(new Error('api error'))
    await expect(runCLIPrompt('claude', 'テスト')).rejects.toThrow('api error')
  })
})
