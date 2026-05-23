import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasApiKey, setApiKey, runPrompt } from '../claudeApi'

const mockApi = {
  hasApiKey: vi.fn(),
  setApiKey: vi.fn(),
  runPrompt: vi.fn(),
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

describe('runPrompt', () => {
  it('window.api.runPrompt に promptContent と fileContent を渡して呼び出す', async () => {
    mockApi.runPrompt.mockResolvedValue('回答テキスト')
    const result = await runPrompt('プロンプト', 'ファイル内容')
    expect(mockApi.runPrompt).toHaveBeenCalledWith('プロンプト', 'ファイル内容')
    expect(result).toBe('回答テキスト')
  })

  it('fileContent が null のとき null を渡す', async () => {
    mockApi.runPrompt.mockResolvedValue('result')
    await runPrompt('プロンプト', null)
    expect(mockApi.runPrompt).toHaveBeenCalledWith('プロンプト', null)
  })
})
