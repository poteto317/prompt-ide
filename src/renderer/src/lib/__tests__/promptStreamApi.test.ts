import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cancelPrompt, onPromptStreamChunk } from '../promptStreamApi'

const mockCancelPrompt = vi.fn()
const mockOnPromptStreamChunk = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window.api, {
    cancelPrompt: mockCancelPrompt,
    onPromptStreamChunk: mockOnPromptStreamChunk
  })
})

describe('promptStreamApi', () => {
  it('cancelPrompt が window.api.cancelPrompt に委譲する', async () => {
    mockCancelPrompt.mockResolvedValue(true)
    const result = await cancelPrompt('req-1')
    expect(mockCancelPrompt).toHaveBeenCalledWith('req-1')
    expect(result).toBe(true)
  })

  it('onPromptStreamChunk がリスナーを登録し解除関数を返す', () => {
    const unsubscribe = vi.fn()
    mockOnPromptStreamChunk.mockReturnValue(unsubscribe)
    const listener = vi.fn()
    const returned = onPromptStreamChunk(listener)
    expect(mockOnPromptStreamChunk).toHaveBeenCalledWith(listener)
    expect(returned).toBe(unsubscribe)
  })
})
