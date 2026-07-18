import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCLIPromptStream } from '../cliApi'

const mockRunCLIPromptStream = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // window.api オブジェクト自体は維持しつつ runCLIPromptStream のみ差し替える
  Object.assign(window.api, { runCLIPromptStream: mockRunCLIPromptStream })
})

describe('cliApi', () => {
  it('runCLIPromptStream が window.api.runCLIPromptStream に委譲する', async () => {
    mockRunCLIPromptStream.mockResolvedValue('CLI結果')
    const result = await runCLIPromptStream('req-1', 'claude', 'テストプロンプト')
    expect(mockRunCLIPromptStream).toHaveBeenCalledWith('req-1', 'claude', 'テストプロンプト')
    expect(result).toBe('CLI結果')
  })

  it('window.api.runCLIPromptStream が throw したとき伝播する', async () => {
    mockRunCLIPromptStream.mockRejectedValue(new Error('api error'))
    await expect(runCLIPromptStream('req-1', 'claude', 'テスト')).rejects.toThrow('api error')
  })
})
