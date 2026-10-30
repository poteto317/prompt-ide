import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetApiKey = vi.hoisted(() => vi.fn())
const mockSetApiKey = vi.hoisted(() => vi.fn())
const mockGetModelSettings = vi.hoisted(() => vi.fn())
const mockSetModelSettings = vi.hoisted(() => vi.fn())

vi.mock('../../apiKeyStore', () => ({
  getApiKey: mockGetApiKey,
  setApiKey: mockSetApiKey
}))
vi.mock('../../modelSettingsStore', () => ({
  getModelSettings: mockGetModelSettings,
  setModelSettings: mockSetModelSettings
}))
const mockGetPromptExecutionMode = vi.hoisted(() => vi.fn())
const mockSetPromptExecutionMode = vi.hoisted(() => vi.fn())
vi.mock('../../executionModeStore', () => ({
  getPromptExecutionMode: mockGetPromptExecutionMode,
  setPromptExecutionMode: mockSetPromptExecutionMode
}))

const mockGetPromptListMode = vi.hoisted(() => vi.fn())
const mockSetPromptListMode = vi.hoisted(() => vi.fn())
vi.mock('../../promptListModeStore', () => ({
  getPromptListMode: mockGetPromptListMode,
  setPromptListMode: mockSetPromptListMode
}))

const mockGetAgentNotificationsEnabled = vi.hoisted(() => vi.fn())
const mockSetAgentNotificationsEnabled = vi.hoisted(() => vi.fn())
vi.mock('../../agentNotificationSettingStore', () => ({
  getAgentNotificationsEnabled: mockGetAgentNotificationsEnabled,
  setAgentNotificationsEnabled: mockSetAgentNotificationsEnabled
}))

const mockGetAgentSendConfirmEnabled = vi.hoisted(() => vi.fn())
const mockSetAgentSendConfirmEnabled = vi.hoisted(() => vi.fn())
vi.mock('../../agentSendConfirmSettingStore', () => ({
  getAgentSendConfirmEnabled: mockGetAgentSendConfirmEnabled,
  setAgentSendConfirmEnabled: mockSetAgentSendConfirmEnabled
}))

const mockGetAgentCliKindSetting = vi.hoisted(() => vi.fn())
const mockSetAgentCliKind = vi.hoisted(() => vi.fn())
vi.mock('../../agentCliKindStore', () => ({
  getAgentCliKindSetting: mockGetAgentCliKindSetting,
  setAgentCliKind: mockSetAgentCliKind
}))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }))

import { registerSettingsHandlers } from '../../handlers/settingsHandlers'
import { ApiKeyDecryptError, KeystoreUnavailableError } from '../../apiKeyErrors'
import { SettingsFileError } from '../../settingsFileStore'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  registerSettingsHandlers(mockIpcMain)
})

describe('registerSettingsHandlers', () => {
  it('settings:getAgentNotificationsEnabled は保存された設定を返す', async () => {
    mockGetAgentNotificationsEnabled.mockResolvedValueOnce(false)
    await expect(
      getRegisteredHandler('settings:getAgentNotificationsEnabled')(makeEvent(1))
    ).resolves.toBe(false)
  })

  it('settings:setAgentNotificationsEnabled は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetAgentNotificationsEnabled.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setAgentNotificationsEnabled')(makeEvent(1), true)
    expect(mockSetAgentNotificationsEnabled).toHaveBeenCalledWith(true)
  })

  it('settings:setAgentNotificationsEnabled は store の拒否をそのまま返す', async () => {
    mockSetAgentNotificationsEnabled.mockRejectedValueOnce(new Error('通知の設定が不正です: x'))
    await expect(
      getRegisteredHandler('settings:setAgentNotificationsEnabled')(makeEvent(1), 'x')
    ).rejects.toThrow('通知の設定が不正です')
  })

  it('settings:getAgentSendConfirmEnabled は保存された設定を返す', async () => {
    mockGetAgentSendConfirmEnabled.mockResolvedValueOnce(false)
    await expect(
      getRegisteredHandler('settings:getAgentSendConfirmEnabled')(makeEvent(1))
    ).resolves.toBe(false)
  })

  it('settings:setAgentSendConfirmEnabled は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetAgentSendConfirmEnabled.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setAgentSendConfirmEnabled')(makeEvent(1), true)
    expect(mockSetAgentSendConfirmEnabled).toHaveBeenCalledWith(true)
  })

  it('settings:setAgentSendConfirmEnabled は store の拒否をそのまま返す', async () => {
    mockSetAgentSendConfirmEnabled.mockRejectedValueOnce(
      new Error('送信前の確認の設定が不正です: x')
    )
    await expect(
      getRegisteredHandler('settings:setAgentSendConfirmEnabled')(makeEvent(1), 'x')
    ).rejects.toThrow('送信前の確認の設定が不正です')
  })

  describe('settings:hasApiKey', () => {
    let consoleErrorSpy: MockInstance<typeof console.error> | null = null

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy?.mockRestore()
      consoleErrorSpy = null
    })

    it('getApiKey がキーを返すとき hasKey: true を返す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-test')
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: true, hasKey: true })
    })

    it('getApiKey が空文字を返すとき hasKey: false を返す', async () => {
      mockGetApiKey.mockResolvedValue('')
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: true, hasKey: false })
    })

    it('getApiKey が空白のみを返すとき hasKey: false を返す（trim ベース）', async () => {
      mockGetApiKey.mockResolvedValue('   ')
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: true, hasKey: false })
    })

    it('キーストアが使えないときは keystore-unavailable を返す(reject しない)', async () => {
      mockGetApiKey.mockRejectedValue(new KeystoreUnavailableError())
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: false, reason: 'keystore-unavailable' })
    })

    it('保存済みのキーを復号できないときは decrypt-failed を返す', async () => {
      mockGetApiKey.mockRejectedValue(new ApiKeyDecryptError())
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: false, reason: 'decrypt-failed' })
    })

    it('settings.json が壊れているときは settings-file-error を返し、文言は送らない', async () => {
      mockGetApiKey.mockRejectedValue(new SettingsFileError())
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: false, reason: 'settings-file-error' })
    })

    it('分類できない失敗は unknown を返し、例外の文言・パスを含めず、console.error に記録する(L-017)', async () => {
      const err = new Error(
        "EPERM: operation not permitted, rename '/Users/someone/Library/Application Support/prompt-ide/settings.json' SECRET-CIPHER"
      )
      mockGetApiKey.mockRejectedValue(err)
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toEqual({ ok: false, reason: 'unknown' })
      expect(JSON.stringify(result)).not.toContain('SECRET-CIPHER')
      expect(JSON.stringify(result)).not.toContain('settings.json')
      expect(consoleErrorSpy).toHaveBeenCalledOnce()
      expect(consoleErrorSpy?.mock.calls[0]).toContain(err)
    })

    it('getApiKey を呼び出す', async () => {
      mockGetApiKey.mockResolvedValue('')
      await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(mockGetApiKey).toHaveBeenCalledOnce()
    })
  })

  describe('settings:setApiKey', () => {
    it('trim した値を setApiKey に渡す', async () => {
      mockSetApiKey.mockResolvedValue(undefined)
      await getRegisteredHandler('settings:setApiKey')(makeEvent(1), 'sk-ant-new')
      expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    })

    it('前後スペースを trim して setApiKey に渡す', async () => {
      mockSetApiKey.mockResolvedValue(undefined)
      await getRegisteredHandler('settings:setApiKey')(makeEvent(1), '  sk-ant-new  ')
      expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    })

    it('空文字のとき "API キーが空です" エラーをスロー', async () => {
      await expect(getRegisteredHandler('settings:setApiKey')(makeEvent(1), '')).rejects.toThrow(
        'API キーが空です'
      )
      expect(mockSetApiKey).not.toHaveBeenCalled()
    })

    it('空白のみのとき "API キーが空です" エラーをスロー', async () => {
      await expect(getRegisteredHandler('settings:setApiKey')(makeEvent(1), '   ')).rejects.toThrow(
        'API キーが空です'
      )
      expect(mockSetApiKey).not.toHaveBeenCalled()
    })
  })

  describe('settings:getModelSettings', () => {
    it('getModelSettings の結果を返す', async () => {
      const settings = { modelId: 'claude-opus-4-8', maxTokens: 8000 }
      mockGetModelSettings.mockResolvedValue(settings)
      const result = await getRegisteredHandler('settings:getModelSettings')(makeEvent(1))
      expect(result).toEqual(settings)
    })
  })

  describe('settings:setModelSettings', () => {
    it('妥当な payload を setModelSettings に渡す', async () => {
      mockSetModelSettings.mockResolvedValue(undefined)
      await getRegisteredHandler('settings:setModelSettings')(makeEvent(1), {
        modelId: 'claude-sonnet-5',
        maxTokens: 8192
      })
      expect(mockSetModelSettings).toHaveBeenCalledWith({
        modelId: 'claude-sonnet-5',
        maxTokens: 8192
      })
    })

    it('不正な payload のとき例外をスローし setModelSettings を呼ばない', async () => {
      await expect(
        getRegisteredHandler('settings:setModelSettings')(makeEvent(1), {
          modelId: 'unknown',
          maxTokens: 100
        })
      ).rejects.toThrow('modelId は')
      expect(mockSetModelSettings).not.toHaveBeenCalled()
    })
  })

  it('settings:getAgentCliKind は保存された設定(種類と既定に戻した理由)を返す', async () => {
    mockGetAgentCliKindSetting.mockResolvedValueOnce({ kind: 'copilot', fallback: null })
    await expect(getRegisteredHandler('settings:getAgentCliKind')(makeEvent(1))).resolves.toEqual({
      kind: 'copilot',
      fallback: null
    })
    expect(mockGetAgentCliKindSetting).toHaveBeenCalledOnce()
  })

  it('settings:setAgentCliKind は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetAgentCliKind.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setAgentCliKind')(makeEvent(1), 'copilot')
    expect(mockSetAgentCliKind).toHaveBeenCalledExactlyOnceWith('copilot')
  })

  it('settings:setAgentCliKind は store の拒否をそのまま返す', async () => {
    mockSetAgentCliKind.mockRejectedValueOnce(new Error('使うエージェント CLI が不正です'))
    await expect(
      getRegisteredHandler('settings:setAgentCliKind')(makeEvent(1), 'codex')
    ).rejects.toThrow('使うエージェント CLI が不正です')
  })
})

describe('実行方式', () => {
  it('settings:getPromptExecutionMode は保存された方式を返す', async () => {
    mockGetPromptExecutionMode.mockResolvedValueOnce('legacy')
    await expect(
      getRegisteredHandler('settings:getPromptExecutionMode')(makeEvent(1))
    ).resolves.toBe('legacy')
  })

  it('settings:setPromptExecutionMode は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetPromptExecutionMode.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setPromptExecutionMode')(makeEvent(1), 'agent-cli')
    expect(mockSetPromptExecutionMode).toHaveBeenCalledWith('agent-cli')
  })

  it('不正な値の拒否(store の例外)を renderer へ返す', async () => {
    mockSetPromptExecutionMode.mockRejectedValueOnce(new Error('実行方式が不正です: shell'))
    await expect(
      getRegisteredHandler('settings:setPromptExecutionMode')(makeEvent(1), 'shell')
    ).rejects.toThrow('実行方式が不正です: shell')
  })
})

describe('プロンプト一覧のモード', () => {
  it('settings:getPromptListMode は保存されたモードを返す', async () => {
    mockGetPromptListMode.mockResolvedValueOnce('view')
    await expect(getRegisteredHandler('settings:getPromptListMode')(makeEvent(1))).resolves.toBe(
      'view'
    )
    expect(mockGetPromptListMode).toHaveBeenCalledOnce()
  })

  it('settings:setPromptListMode は受け取った値をそのまま store へ渡す(検証は store が行う)', async () => {
    mockSetPromptListMode.mockResolvedValueOnce(undefined)
    await getRegisteredHandler('settings:setPromptListMode')(makeEvent(1), 'hidden')
    expect(mockSetPromptListMode).toHaveBeenCalledExactlyOnceWith('hidden')
  })

  it('settings:setPromptListMode は store の拒否をそのまま返す', async () => {
    mockSetPromptListMode.mockRejectedValueOnce(new Error('プロンプト一覧のモードが不正です'))
    await expect(
      getRegisteredHandler('settings:setPromptListMode')(makeEvent(1), 'hidden')
    ).rejects.toThrow('プロンプト一覧のモードが不正です')
  })
})
