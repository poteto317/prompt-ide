import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import { getPromptListMode, setPromptListMode } from '../promptListModeStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getPromptListMode', () => {
  it.each([
    ['保存された edit', { promptListMode: 'edit' }, 'edit'],
    ['保存された view', { promptListMode: 'view' }, 'view'],
    ['値が無い', {}, 'edit'],
    ['不正な値', { promptListMode: 'hidden' }, 'edit'],
    ['文字列でない値', { promptListMode: 1 }, 'edit']
  ])('%s → %s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getPromptListMode()).resolves.toBe(expected)
  })

  it('設定ファイルを読めない失敗はそのまま返す(renderer が記録して既定で続ける)', async () => {
    const err = new Error('broken')
    mockReadSettingsFile.mockRejectedValueOnce(err)
    await expect(getPromptListMode()).rejects.toBe(err)
  })
})

describe('setPromptListMode', () => {
  it.each(['edit', 'view'])('%s を検証してマージで書き込む', async (mode) => {
    await setPromptListMode(mode)
    expect(mockWriteSettingsFile).toHaveBeenCalledExactlyOnceWith({ promptListMode: mode })
  })

  it.each(['hidden', '', 'Edit', null, 1, undefined])(
    '不正な値(%o)は書き込まずに投げ、値を文言に入れない(L-017)',
    async (mode) => {
      await expect(setPromptListMode(mode)).rejects.toThrow(
        new Error('プロンプト一覧のモードが不正です')
      )
      expect(mockWriteSettingsFile).not.toHaveBeenCalled()
    }
  )
})
