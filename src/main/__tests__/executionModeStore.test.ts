import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import { getPromptExecutionMode, setPromptExecutionMode } from '../executionModeStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getPromptExecutionMode', () => {
  it.each([
    ['保存された agent-cli', { promptExecutionMode: 'agent-cli' }, 'agent-cli'],
    ['保存された legacy', { promptExecutionMode: 'legacy' }, 'legacy'],
    ['値が無い', {}, 'agent-cli'],
    ['不正な値', { promptExecutionMode: 'shell' }, 'agent-cli'],
    ['文字列でない値', { promptExecutionMode: 1 }, 'agent-cli']
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getPromptExecutionMode()).resolves.toBe(expected)
  })
})

describe('setPromptExecutionMode', () => {
  it('検証を通った値をマージで書き込む', async () => {
    await setPromptExecutionMode('legacy')
    expect(mockWriteSettingsFile).toHaveBeenCalledWith({ promptExecutionMode: 'legacy' })
  })
  it.each(['shell', '', null, 1])('不正な値(%s)は書き込まずに投げる', async (mode) => {
    await expect(setPromptExecutionMode(mode)).rejects.toThrow('実行方式が不正です')
    expect(mockWriteSettingsFile).not.toHaveBeenCalled()
  })
})
