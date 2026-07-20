import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStream = vi.hoisted(() => vi.fn())
const MockAPIUserAbortError = vi.hoisted(() => class MockAPIUserAbortError extends Error {})

vi.mock('@anthropic-ai/sdk', () => {
  const AnthropicMock = vi.fn(function () {
    return { messages: { stream: mockStream } }
  }) as unknown as { APIUserAbortError: typeof MockAPIUserAbortError }
  AnthropicMock.APIUserAbortError = MockAPIUserAbortError
  return { default: AnthropicMock }
})

import { runPromptStream } from '../claudeService'

const defaultOptions = { model: 'claude-haiku-4-5', maxTokens: 4096 }

interface MockStream {
  on: ReturnType<typeof vi.fn>
  finalMessage: ReturnType<typeof vi.fn>
}

// stream.on('text', cb) 登録時にチャンクを同期発火し、finalMessage() で最終レスポンスを返すモック
function makeStream(chunks: string[], finalMessage: unknown): MockStream {
  return {
    on: vi.fn((event: string, cb: (chunk: string) => void) => {
      if (event === 'text') chunks.forEach((chunk) => cb(chunk))
    }),
    finalMessage: vi.fn(async () => {
      if (finalMessage instanceof Error) throw finalMessage
      return finalMessage
    })
  }
}

const makeTextResponse = (text: string) => ({
  content: [{ type: 'text', text }]
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runPromptStream', () => {
  it('正常系: block.text を返す', async () => {
    mockStream.mockReturnValue(makeStream([], makeTextResponse('回答テキスト')))
    const result = await runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)
    expect(result).toBe('回答テキスト')
  })

  it('fileContent が null のとき promptContent のみ送信する', async () => {
    mockStream.mockReturnValue(makeStream([], makeTextResponse('result')))
    await runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'プロンプト' }]
      }),
      expect.any(Object)
    )
  })

  it('fileContent があるとき --- セパレーターで結合して送信する', async () => {
    mockStream.mockReturnValue(makeStream([], makeTextResponse('result')))
    await runPromptStream('sk-ant-key', 'プロンプト', 'ファイル内容', defaultOptions)
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'プロンプト\n\n---\n\nファイル内容' }]
      }),
      expect.any(Object)
    )
  })

  it('fileContent が空文字のときもセパレーターで結合して送信する（null との区別）', async () => {
    mockStream.mockReturnValue(makeStream([], makeTextResponse('result')))
    await runPromptStream('sk-ant-key', 'プロンプト', '', defaultOptions)
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'プロンプト\n\n---\n\n' }]
      }),
      expect.any(Object)
    )
  })

  it('options で指定したモデル・max_tokens を使用する', async () => {
    mockStream.mockReturnValue(makeStream([], makeTextResponse('result')))
    await runPromptStream('sk-ant-key', 'プロンプト', null, {
      model: 'claude-opus-4-8',
      maxTokens: 8000
    })
    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-8', max_tokens: 8000 }),
      expect.any(Object)
    )
  })

  it('signal を SDK の stream に渡す', async () => {
    mockStream.mockReturnValue(makeStream([], makeTextResponse('result')))
    const controller = new AbortController()
    await runPromptStream('sk-ant-key', 'プロンプト', null, {
      ...defaultOptions,
      signal: controller.signal
    })
    expect(mockStream).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal })
  })

  it('onChunk を渡すと text イベントのチャンクごとに呼ばれる', async () => {
    mockStream.mockReturnValue(makeStream(['チャンク1', 'チャンク2'], makeTextResponse('全文')))
    const onChunk = vi.fn()
    await runPromptStream('sk-ant-key', 'プロンプト', null, { ...defaultOptions, onChunk })
    expect(onChunk).toHaveBeenNthCalledWith(1, 'チャンク1')
    expect(onChunk).toHaveBeenNthCalledWith(2, 'チャンク2')
  })

  it('onChunk 未指定のとき text イベントを購読しない', async () => {
    const stream = makeStream([], makeTextResponse('result'))
    mockStream.mockReturnValue(stream)
    await runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)
    expect(stream.on).not.toHaveBeenCalled()
  })

  it('abort 時の APIUserAbortError を「キャンセルされました」に変換する', async () => {
    mockStream.mockReturnValue(makeStream([], new MockAPIUserAbortError('Request was aborted.')))
    await expect(runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)).rejects.toThrow(
      'キャンセルされました'
    )
  })

  it('SDK が throw したときエラーが伝播する', async () => {
    mockStream.mockReturnValue(makeStream([], new Error('network error')))
    await expect(runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)).rejects.toThrow(
      'network error'
    )
  })

  it('block.type が text でない場合 予期しないレスポンス形式です エラーを投げる（type 情報を含む）', async () => {
    mockStream.mockReturnValue(
      makeStream([], { content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }] })
    )
    await expect(runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)).rejects.toThrow(
      '予期しないレスポンス形式です（type: tool_use）'
    )
  })

  it('message.content が空配列のとき 予期しないレスポンス形式です（type: なし）エラーを投げる', async () => {
    mockStream.mockReturnValue(makeStream([], { content: [] }))
    await expect(runPromptStream('sk-ant-key', 'プロンプト', null, defaultOptions)).rejects.toThrow(
      '予期しないレスポンス形式です（type: なし）'
    )
  })
})
