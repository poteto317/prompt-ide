import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function () {
    return { messages: { create: mockCreate } }
  }),
}))

import { runPrompt } from '../claudeService'

beforeEach(() => {
  vi.clearAllMocks()
})

const makeTextResponse = (text: string) => ({
  content: [{ type: 'text', text }],
})

describe('runPrompt', () => {
  it('正常系: block.text を返す', async () => {
    mockCreate.mockResolvedValue(makeTextResponse('回答テキスト'))
    const result = await runPrompt('sk-ant-key', 'プロンプト', null)
    expect(result).toBe('回答テキスト')
  })

  it('fileContent が null のとき promptContent のみ送信する', async () => {
    mockCreate.mockResolvedValue(makeTextResponse('result'))
    await runPrompt('sk-ant-key', 'プロンプト', null)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'プロンプト' }],
      })
    )
  })

  it('fileContent があるとき --- セパレーターで結合して送信する', async () => {
    mockCreate.mockResolvedValue(makeTextResponse('result'))
    await runPrompt('sk-ant-key', 'プロンプト', 'ファイル内容')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'プロンプト\n\n---\n\nファイル内容' }],
      })
    )
  })

  it('モデルとして claude-haiku-4-5-20251001 を使用する', async () => {
    mockCreate.mockResolvedValue(makeTextResponse('result'))
    await runPrompt('sk-ant-key', 'プロンプト', null)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001', max_tokens: 4096 })
    )
  })

  it('SDK が throw したときエラーが伝播する', async () => {
    mockCreate.mockRejectedValue(new Error('network error'))
    await expect(runPrompt('sk-ant-key', 'プロンプト', null)).rejects.toThrow('network error')
  })

  it('block.type が text でない場合 Unexpected response type エラーを投げる', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }] })
    await expect(runPrompt('sk-ant-key', 'プロンプト', null)).rejects.toThrow('Unexpected response type')
  })
})
