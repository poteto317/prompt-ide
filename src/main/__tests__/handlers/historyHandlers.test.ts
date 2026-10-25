import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoryEntry } from '@shared/types'

const mockHandle = vi.hoisted(() => vi.fn())
const mockLoadHistory = vi.hoisted(() => vi.fn())
const mockSaveHistory = vi.hoisted(() => vi.fn())

vi.mock('../../historyStore', () => ({
  loadHistory: mockLoadHistory,
  saveHistory: mockSaveHistory
}))

import { registerHistoryHandlers } from '../../handlers/historyHandlers'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(): { sender: { id: number } } {
  return { sender: { id: 1 } }
}

const sampleEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'タイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 1000,
  agent: null
}

const agentEntry: HistoryEntry = {
  ...sampleEntry,
  id: 'h-agent',
  toolId: 'claude',
  status: 'sent',
  resultText: null,
  agent: {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    cliKind: 'claude',
    tabLabel: 'claude 2',
    folderPath: '/work'
  }
}
// agent の無い古い形式の値(保存済みの古い history.json の要素)
const withoutAgent = (entry: HistoryEntry): Record<string, unknown> => {
  const legacy: Record<string, unknown> = { ...entry }
  delete legacy.agent
  return legacy
}

beforeEach(() => {
  vi.clearAllMocks()
  registerHistoryHandlers(mockIpcMain)
})

describe('registerHistoryHandlers', () => {
  describe('history:load', () => {
    it('loadHistory に委譲して配列を返す', async () => {
      mockLoadHistory.mockResolvedValue([sampleEntry])
      const result = await getRegisteredHandler('history:load')(makeEvent())
      expect(mockLoadHistory).toHaveBeenCalledOnce()
      expect(result).toEqual([sampleEntry])
    })

    it('loadHistory が reject したときそのままエラーが伝播する', async () => {
      mockLoadHistory.mockRejectedValue(new Error('disk read failed'))
      await expect(getRegisteredHandler('history:load')(makeEvent())).rejects.toThrow(
        'disk read failed'
      )
    })
  })

  describe('history:save', () => {
    it('エージェントのエントリは agent を残したまま saveHistory に渡す(L-015)', async () => {
      await getRegisteredHandler('history:save')(makeEvent(), [agentEntry, sampleEntry])
      expect(mockSaveHistory).toHaveBeenCalledWith([agentEntry, sampleEntry])
    })

    it('agent の無い古い形式は agent: null にして saveHistory に渡す', async () => {
      await getRegisteredHandler('history:save')(makeEvent(), [withoutAgent(sampleEntry)])
      expect(mockSaveHistory).toHaveBeenCalledWith([sampleEntry])
    })

    it('履歴配列を saveHistory に渡す', async () => {
      mockSaveHistory.mockResolvedValue(undefined)
      await getRegisteredHandler('history:save')(makeEvent(), [sampleEntry])
      expect(mockSaveHistory).toHaveBeenCalledWith([sampleEntry])
    })

    it('空配列を saveHistory に渡せる', async () => {
      mockSaveHistory.mockResolvedValue(undefined)
      await getRegisteredHandler('history:save')(makeEvent(), [])
      expect(mockSaveHistory).toHaveBeenCalledWith([])
    })

    it('payload が配列でないとき "引数は配列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('history:save')(makeEvent(), { not: 'array' })
      ).rejects.toThrow('引数は配列である必要があります')
      expect(mockSaveHistory).not.toHaveBeenCalled()
    })

    it('不正な形式の要素があると saveHistory は呼ばれない', async () => {
      await expect(getRegisteredHandler('history:save')(makeEvent(), [{ id: 1 }])).rejects.toThrow()
      expect(mockSaveHistory).not.toHaveBeenCalled()
    })

    it('不正な形式の要素があると "履歴データの形式が不正です" というエラーを完全一致でスロー（二重メッセージ化しない）', async () => {
      await expect(getRegisteredHandler('history:save')(makeEvent(), [{ id: 1 }])).rejects.toThrow(
        /^履歴データの形式が不正です$/
      )
      expect(mockSaveHistory).not.toHaveBeenCalled()
    })

    it('有効な要素と不正な要素が混在すると全体が reject され saveHistory は呼ばれない', async () => {
      await expect(
        getRegisteredHandler('history:save')(makeEvent(), [sampleEntry, { id: 1 }])
      ).rejects.toThrow(/^履歴データの形式が不正です$/)
      expect(mockSaveHistory).not.toHaveBeenCalled()
    })

    it('saveHistory が reject したときそのままエラーが伝播する', async () => {
      mockSaveHistory.mockRejectedValue(new Error('disk write failed'))
      await expect(
        getRegisteredHandler('history:save')(makeEvent(), [sampleEntry])
      ).rejects.toThrow('disk write failed')
    })
  })
})
