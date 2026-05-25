import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetApiKey = vi.hoisted(() => vi.fn())
const mockSetApiKey = vi.hoisted(() => vi.fn())

vi.mock('../../settingsStore', () => ({
  getApiKey: mockGetApiKey,
  setApiKey: mockSetApiKey,
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
      await expect(
        getRegisteredHandler('settings:setApiKey')(makeEvent(1), '')
      ).rejects.toThrow('API キーが空です')
      expect(mockSetApiKey).not.toHaveBeenCalled()
    })

    it('空白のみのとき "API キーが空です" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('settings:setApiKey')(makeEvent(1), '   ')
      ).rejects.toThrow('API キーが空です')
      expect(mockSetApiKey).not.toHaveBeenCalled()
    })
  })
})
