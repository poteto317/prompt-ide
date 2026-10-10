import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import {
  getAgentSendConfirmEnabled,
  setAgentSendConfirmEnabled
} from '../agentSendConfirmSettingStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getAgentSendConfirmEnabled', () => {
  it.each([
    ['保存された true', { agentSendConfirmEnabled: true }, true],
    ['保存された false', { agentSendConfirmEnabled: false }, false],
    ['値が無い', {}, true],
    ['文字列', { agentSendConfirmEnabled: 'false' }, true],
    ['数', { agentSendConfirmEnabled: 0 }, true]
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getAgentSendConfirmEnabled()).resolves.toBe(expected)
  })
})

describe('setAgentSendConfirmEnabled', () => {
  it('真偽値をマージで書き込む', async () => {
    await setAgentSendConfirmEnabled(false)
    expect(mockWriteSettingsFile).toHaveBeenCalledWith({ agentSendConfirmEnabled: false })
  })

  it.each(['true', 1, null, undefined])('真偽値でない値(%s)は書き込まずに投げる', async (value) => {
    await expect(setAgentSendConfirmEnabled(value)).rejects.toThrow('送信前の確認の設定が不正です')
    expect(mockWriteSettingsFile).not.toHaveBeenCalled()
  })
})
