import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getApiKey, setApiKey, runPrompt } from '../claudeApi'

const mockApi = {
  getApiKey: vi.fn(),
  setApiKey: vi.fn(),
  runPrompt: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('getApiKey', () => {
  it('window.api.getApiKey を呼び出し結果を返す', async () => {
    mockApi.getApiKey.mockResolvedValue('sk-ant-test')
    const result = await getApiKey()
    expect(mockApi.getApiKey).toHaveBeenCalledOnce()
    expect(result).toBe('sk-ant-test')
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
