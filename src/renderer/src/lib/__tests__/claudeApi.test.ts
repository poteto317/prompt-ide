import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasApiKey, setApiKey, runPromptStream } from '../claudeApi'

const mockApi = {
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
  runPromptStream: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('hasApiKey', () => {
  it('window.api.hasApiKey を呼び出し boolean を返す（キーあり）', async () => {
    mockApi.hasApiKey.mockResolvedValue(true)
    const result = await hasApiKey()
    expect(mockApi.hasApiKey).toHaveBeenCalledOnce()
    expect(result).toBe(true)
  })

  it('window.api.hasApiKey を呼び出し boolean を返す（キーなし）', async () => {
    mockApi.hasApiKey.mockResolvedValue(false)
    const result = await hasApiKey()
    expect(result).toBe(false)
  })
})

describe('setApiKey', () => {
  it('window.api.setApiKey に key を渡して呼び出す', async () => {
    mockApi.setApiKey.mockResolvedValue(undefined)
    await setApiKey('sk-ant-new')
    expect(mockApi.setApiKey).toHaveBeenCalledWith('sk-ant-new')
  })
})

describe('runPromptStream', () => {
  it('window.api.runPromptStream に requestId / promptContent / fileContent を渡して呼び出す', async () => {
    mockApi.runPromptStream.mockResolvedValue('回答テキスト')
    const result = await runPromptStream('req-1', 'プロンプト', 'ファイル内容')
    expect(mockApi.runPromptStream).toHaveBeenCalledWith('req-1', 'プロンプト', 'ファイル内容')
    expect(result).toBe('回答テキスト')
  })

  it('fileContent が null のとき null を渡す', async () => {
    mockApi.runPromptStream.mockResolvedValue('result')
    await runPromptStream('req-1', 'プロンプト', null)
    expect(mockApi.runPromptStream).toHaveBeenCalledWith('req-1', 'プロンプト', null)
  })
})
