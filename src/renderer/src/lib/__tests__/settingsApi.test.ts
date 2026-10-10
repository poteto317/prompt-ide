import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelSettings } from '@shared/types'
import {
  getAgentNotificationsEnabled,
  getModelSettings,
  getPromptExecutionMode,
  setAgentNotificationsEnabled,
  setModelSettings,
  setPromptExecutionMode
} from '../settingsApi'

const mockApi = {
  getModelSettings: vi.fn(),
  setModelSettings: vi.fn(),
  getAgentNotificationsEnabled: vi.fn(),
  setAgentNotificationsEnabled: vi.fn()
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

describe('実行方式', () => {
  it('getPromptExecutionMode・setPromptExecutionMode は window.api に委譲する', async () => {
    const api = {
      getPromptExecutionMode: vi.fn().mockResolvedValue('legacy'),
      setPromptExecutionMode: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('api', api)
    await expect(getPromptExecutionMode()).resolves.toBe('legacy')
    await setPromptExecutionMode('agent-cli')
    expect(api.setPromptExecutionMode).toHaveBeenCalledWith('agent-cli')
  })
})

describe('getAgentNotificationsEnabled / setAgentNotificationsEnabled', () => {
  it('window.api の同名の関数へ委ねる', async () => {
    mockApi.getAgentNotificationsEnabled.mockResolvedValue(false)
    mockApi.setAgentNotificationsEnabled.mockResolvedValue(undefined)
    await expect(getAgentNotificationsEnabled()).resolves.toBe(false)
    await setAgentNotificationsEnabled(true)
    expect(mockApi.setAgentNotificationsEnabled).toHaveBeenCalledWith(true)
  })
})
