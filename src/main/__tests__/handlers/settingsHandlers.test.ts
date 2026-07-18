import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { registerSettingsHandlers } from '../../handlers/settingsHandlers'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number) {
  return { sender: { id: senderId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  registerSettingsHandlers(mockIpcMain)
})

describe('registerSettingsHandlers', () => {
  describe('settings:hasApiKey', () => {
    it('getApiKey がキーを返すとき true を返す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-test')
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toBe(true)
    })

    it('getApiKey が空文字を返すとき false を返す', async () => {
      mockGetApiKey.mockResolvedValue('')
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toBe(false)
    })

    it('getApiKey が空白のみを返すとき false を返す（trim ベース）', async () => {
      mockGetApiKey.mockResolvedValue('   ')
      const result = await getRegisteredHandler('settings:hasApiKey')(makeEvent(1))
      expect(result).toBe(false)
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
})
