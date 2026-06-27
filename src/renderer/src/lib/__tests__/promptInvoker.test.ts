import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../claudeApi')
vi.mock('../cliApi')

import * as claudeApi from '../claudeApi'
import * as cliApi from '../cliApi'
import { invokePrompt } from '../promptInvoker'

const mockRunPrompt = vi.mocked(claudeApi.runPrompt)
const mockRunCLIPrompt = vi.mocked(cliApi.runCLIPrompt)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('invokePrompt', () => {
  describe('API モード（toolId = api）', () => {
    it('claudeApi.runPrompt を呼ぶ', async () => {
      mockRunPrompt.mockResolvedValue('API出力')
      const result = await invokePrompt('api', 'プロンプト', null)
      expect(mockRunPrompt).toHaveBeenCalledWith('プロンプト', null)
      expect(mockRunCLIPrompt).not.toHaveBeenCalled()
      expect(result).toBe('API出力')
    })

    it('fileContent が null のとき null を runPrompt に渡す', async () => {
      mockRunPrompt.mockResolvedValue('result')
      await invokePrompt('api', 'プロンプト', null)
      expect(mockRunPrompt).toHaveBeenCalledWith('プロンプト', null)
    })

    it('fileContent がある場合そのまま runPrompt に渡す', async () => {
      mockRunPrompt.mockResolvedValue('result')
      await invokePrompt('api', 'プロンプト', 'ファイル内容')
      expect(mockRunPrompt).toHaveBeenCalledWith('プロンプト', 'ファイル内容')
    })
  })

  describe('CLIモード（toolId = claude）', () => {
    it('cliApi.runCLIPrompt を claude で呼ぶ', async () => {
      mockRunCLIPrompt.mockResolvedValue('CLI出力')
      const result = await invokePrompt('claude', 'プロンプト', null)
      expect(mockRunCLIPrompt).toHaveBeenCalledWith('claude', 'プロンプト')
      expect(mockRunPrompt).not.toHaveBeenCalled()
      expect(result).toBe('CLI出力')
    })

    it('fileContent が null のとき promptContent のみ渡す', async () => {
      mockRunCLIPrompt.mockResolvedValue('result')
      await invokePrompt('claude', 'プロンプト', null)
      expect(mockRunCLIPrompt).toHaveBeenCalledWith('claude', 'プロンプト')
    })

    it('fileContent がある場合 --- セパレーターで結合して渡す', async () => {
      mockRunCLIPrompt.mockResolvedValue('result')
      await invokePrompt('claude', 'プロンプト', 'ファイル内容')
      expect(mockRunCLIPrompt).toHaveBeenCalledWith('claude', 'プロンプト\n\n---\n\nファイル内容')
    })
  })

  describe('CLIモード（toolId = copilot）', () => {
    it('cliApi.runCLIPrompt を copilot で呼ぶ', async () => {
      mockRunCLIPrompt.mockResolvedValue('Copilot出力')
      const result = await invokePrompt('copilot', 'プロンプト', null)
      expect(mockRunCLIPrompt).toHaveBeenCalledWith('copilot', 'プロンプト')
      expect(result).toBe('Copilot出力')
    })

    it('fileContent がある場合 --- セパレーターで結合して渡す', async () => {
      mockRunCLIPrompt.mockResolvedValue('result')
      await invokePrompt('copilot', 'プロンプト', 'ファイル内容')
      expect(mockRunCLIPrompt).toHaveBeenCalledWith('copilot', 'プロンプト\n\n---\n\nファイル内容')
    })
  })

  describe('エラー伝播', () => {
    it('claudeApi.runPrompt が throw したとき invokePrompt がエラーを伝播する', async () => {
      mockRunPrompt.mockRejectedValue(new Error('API エラー'))
      await expect(invokePrompt('api', 'プロンプト', null)).rejects.toThrow('API エラー')
    })

    it('cliApi.runCLIPrompt が throw したとき invokePrompt がエラーを伝播する', async () => {
      mockRunCLIPrompt.mockRejectedValue(new Error('CLI エラー'))
      await expect(invokePrompt('claude', 'プロンプト', null)).rejects.toThrow('CLI エラー')
    })
  })
})
