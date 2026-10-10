import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import {
  getAgentNotificationsEnabled,
  setAgentNotificationsEnabled
} from '../agentNotificationSettingStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getAgentNotificationsEnabled', () => {
  it.each([
    ['保存された true', { agentNotificationsEnabled: true }, true],
    ['保存された false', { agentNotificationsEnabled: false }, false],
    ['値が無い', {}, true],
    ['文字列', { agentNotificationsEnabled: 'false' }, true],
    ['数', { agentNotificationsEnabled: 0 }, true]
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getAgentNotificationsEnabled()).resolves.toBe(expected)
  })
})

describe('setAgentNotificationsEnabled', () => {
  it('真偽値をマージで書き込む', async () => {
    await setAgentNotificationsEnabled(false)
    expect(mockWriteSettingsFile).toHaveBeenCalledWith({ agentNotificationsEnabled: false })
  })
  it.each(['true', 1, null, undefined])('真偽値でない値(%s)は書き込まずに投げる', async (value) => {
    await expect(setAgentNotificationsEnabled(value)).rejects.toThrow('通知の設定が不正です')
    expect(mockWriteSettingsFile).not.toHaveBeenCalled()
  })
})
