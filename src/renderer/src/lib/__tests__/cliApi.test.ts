import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runCLIPrompt } from '../cliApi'

const mockRunCLIPrompt = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // window.api オブジェクト自体は維持しつつ runCLIPrompt のみ差し替える
  Object.assign(window.api, { runCLIPrompt: mockRunCLIPrompt })
})

afterEach(() => {
  // setup.ts の window.api スタブには runCLIPrompt が存在しないため
  // テスト後に削除して他テストへの副作用を防ぐ
  delete (window.api as Partial<Window['api']>).runCLIPrompt
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
