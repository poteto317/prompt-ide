import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import { getPanelLayout, setPanelLayout } from '../panelLayoutStore'

const DEFAULT = { sidebarWidth: 240, terminalHeightPercent: 45 }

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

describe('getPanelLayout', () => {
  it.each([
    [
      '保存された値',
      { panelLayout: { sidebarWidth: 300, terminalHeightPercent: 60 } },
      { sidebarWidth: 300, terminalHeightPercent: 60 }
    ],
    ['保存が無い', {}, DEFAULT],
    ['範囲外の値', { panelLayout: { sidebarWidth: 9999, terminalHeightPercent: 60 } }, DEFAULT],
    ['オブジェクトでない値', { panelLayout: 'wide' }, DEFAULT]
  ])('%s', async (_label, data, expected) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    await expect(getPanelLayout()).resolves.toEqual(expected)
  })

  it('余分なキーは戻り値に残さない', async () => {
    mockReadSettingsFile.mockResolvedValueOnce({
      panelLayout: { sidebarWidth: 300, terminalHeightPercent: 60, extra: 1 }
    })
    const result = await getPanelLayout()
    expect(Object.keys(result).sort()).toEqual(['sidebarWidth', 'terminalHeightPercent'])
  })

  it('設定ファイルを読めない失敗はそのまま返す', async () => {
    const err = new Error('broken')
    mockReadSettingsFile.mockRejectedValueOnce(err)
    await expect(getPanelLayout()).rejects.toBe(err)
  })
})

describe('setPanelLayout', () => {
  it('検証してマージで書き込む', async () => {
    await setPanelLayout({ sidebarWidth: 300, terminalHeightPercent: 60 })
    expect(mockWriteSettingsFile).toHaveBeenCalledExactlyOnceWith({
      panelLayout: { sidebarWidth: 300, terminalHeightPercent: 60 }
    })
  })

  it('余分なキーは保存しない', async () => {
    await setPanelLayout({ sidebarWidth: 300, terminalHeightPercent: 60, extra: 1 })
    expect(mockWriteSettingsFile).toHaveBeenCalledExactlyOnceWith({
      panelLayout: { sidebarWidth: 300, terminalHeightPercent: 60 }
    })
  })

  it.each([null, 1, { sidebarWidth: 10, terminalHeightPercent: 45 }, undefined])(
    '不正な値(%o)は書き込まずに投げ、値を文言に入れない',
    async (value) => {
      await expect(setPanelLayout(value)).rejects.toThrow(new Error('パネルの大きさが不正です'))
      expect(mockWriteSettingsFile).not.toHaveBeenCalled()
    }
  )
})
