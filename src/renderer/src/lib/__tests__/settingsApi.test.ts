import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelSettings } from '@shared/types'
import {
  getAgentCliKind,
  getAgentNotificationsEnabled,
  getAgentSendConfirmEnabled,
  getModelSettings,
  getPromptExecutionMode,
  getPromptListMode,
  setAgentCliKind,
  setAgentNotificationsEnabled,
  setAgentSendConfirmEnabled,
  setModelSettings,
  setPromptExecutionMode,
  setPromptListMode
} from '../settingsApi'

const mockApi = {
  getModelSettings: vi.fn(),
  setModelSettings: vi.fn(),
  getAgentNotificationsEnabled: vi.fn(),
  setAgentNotificationsEnabled: vi.fn(),
  getAgentSendConfirmEnabled: vi.fn(),
  setAgentSendConfirmEnabled: vi.fn()
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

describe('プロンプト一覧のモード', () => {
  it('getPromptListMode・setPromptListMode は window.api に委譲する', async () => {
    const api = {
      getPromptListMode: vi.fn().mockResolvedValue('view'),
      setPromptListMode: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('api', api)
    await expect(getPromptListMode()).resolves.toBe('view')
    await setPromptListMode('edit')
    expect(api.setPromptListMode).toHaveBeenCalledExactlyOnceWith('edit')
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

describe('getAgentSendConfirmEnabled / setAgentSendConfirmEnabled', () => {
  it('window.api の同名の関数へ委ねる', async () => {
    mockApi.getAgentSendConfirmEnabled.mockResolvedValue(false)
    mockApi.setAgentSendConfirmEnabled.mockResolvedValue(undefined)
    await expect(getAgentSendConfirmEnabled()).resolves.toBe(false)
    await setAgentSendConfirmEnabled(true)
    expect(mockApi.setAgentSendConfirmEnabled).toHaveBeenCalledWith(true)
  })
})

describe('使うエージェント CLI', () => {
  it('getAgentCliKind・setAgentCliKind は window.api に委譲する', async () => {
    const api = {
      getAgentCliKind: vi.fn().mockResolvedValue({ kind: 'copilot', fallback: null }),
      setAgentCliKind: vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('api', api)
    await expect(getAgentCliKind()).resolves.toEqual({ kind: 'copilot', fallback: null })
    await setAgentCliKind('claude')
    expect(api.setAgentCliKind).toHaveBeenCalledExactlyOnceWith('claude')
  })
})
