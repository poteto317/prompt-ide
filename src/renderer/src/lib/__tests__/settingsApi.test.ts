import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelSettings } from '@shared/types'
import { getModelSettings, setModelSettings } from '../settingsApi'

const mockApi = {
  getModelSettings: vi.fn(),
  setModelSettings: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

const mockSettings: ModelSettings = {
  modelId: 'claude-sonnet-5',
  maxTokens: 4096
}

describe('getModelSettings', () => {
  it('window.api.getModelSettings を呼び出す', async () => {
    mockApi.getModelSettings.mockResolvedValue(mockSettings)
    const result = await getModelSettings()
    expect(mockApi.getModelSettings).toHaveBeenCalledOnce()
    expect(result).toEqual(mockSettings)
  })
})

describe('setModelSettings', () => {
  it('window.api.setModelSettings に引数をそのまま渡す', async () => {
    mockApi.setModelSettings.mockResolvedValue(undefined)
    await setModelSettings(mockSettings)
    expect(mockApi.setModelSettings).toHaveBeenCalledWith(mockSettings)
  })
})
