import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../claudeApi')
vi.mock('../cliApi')

import * as claudeApi from '../claudeApi'
import * as cliApi from '../cliApi'
import { invokePrompt } from '../promptInvoker'

const mockRunPromptStream = vi.mocked(claudeApi.runPromptStream)
const mockRunCLIPromptStream = vi.mocked(cliApi.runCLIPromptStream)

const REQUEST_ID = 'req-uuid-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('invokePrompt', () => {
  describe('API モード（toolId = api）', () => {
    it('claudeApi.runPromptStream を呼ぶ', async () => {
      mockRunPromptStream.mockResolvedValue('API出力')
      const result = await invokePrompt('api', 'プロンプト', null, REQUEST_ID)
      expect(mockRunPromptStream).toHaveBeenCalledWith(REQUEST_ID, 'プロンプト', null)
      expect(mockRunCLIPromptStream).not.toHaveBeenCalled()
      expect(result).toBe('API出力')
    })

    it('fileContent が null のとき null を runPromptStream に渡す', async () => {
      mockRunPromptStream.mockResolvedValue('result')
      await invokePrompt('api', 'プロンプト', null, REQUEST_ID)
      expect(mockRunPromptStream).toHaveBeenCalledWith(REQUEST_ID, 'プロンプト', null)
    })

    it('fileContent がある場合そのまま runPromptStream に渡す', async () => {
      mockRunPromptStream.mockResolvedValue('result')
      await invokePrompt('api', 'プロンプト', 'ファイル内容', REQUEST_ID)
      expect(mockRunPromptStream).toHaveBeenCalledWith(REQUEST_ID, 'プロンプト', 'ファイル内容')
    })
  })

  describe('CLIモード（toolId = claude）', () => {
    it('cliApi.runCLIPromptStream を claude で呼ぶ', async () => {
      mockRunCLIPromptStream.mockResolvedValue('CLI出力')
      const result = await invokePrompt('claude', 'プロンプト', null, REQUEST_ID)
      expect(mockRunCLIPromptStream).toHaveBeenCalledWith(REQUEST_ID, 'claude', 'プロンプト')
      expect(mockRunPromptStream).not.toHaveBeenCalled()
      expect(result).toBe('CLI出力')
    })

    it('fileContent が null のとき promptContent のみ渡す', async () => {
      mockRunCLIPromptStream.mockResolvedValue('result')
      await invokePrompt('claude', 'プロンプト', null, REQUEST_ID)
      expect(mockRunCLIPromptStream).toHaveBeenCalledWith(REQUEST_ID, 'claude', 'プロンプト')
    })

    it('fileContent がある場合 --- セパレーターで結合して渡す', async () => {
      mockRunCLIPromptStream.mockResolvedValue('result')
      await invokePrompt('claude', 'プロンプト', 'ファイル内容', REQUEST_ID)
      expect(mockRunCLIPromptStream).toHaveBeenCalledWith(
        REQUEST_ID,
        'claude',
        'プロンプト\n\n---\n\nファイル内容'
      )
    })
  })

  describe('CLIモード（toolId = copilot）', () => {
    it('cliApi.runCLIPromptStream を copilot で呼ぶ', async () => {
      mockRunCLIPromptStream.mockResolvedValue('Copilot出力')
      const result = await invokePrompt('copilot', 'プロンプト', null, REQUEST_ID)
      expect(mockRunCLIPromptStream).toHaveBeenCalledWith(REQUEST_ID, 'copilot', 'プロンプト')
      expect(result).toBe('Copilot出力')
    })

    it('fileContent がある場合 --- セパレーターで結合して渡す', async () => {
      mockRunCLIPromptStream.mockResolvedValue('result')
      await invokePrompt('copilot', 'プロンプト', 'ファイル内容', REQUEST_ID)
      expect(mockRunCLIPromptStream).toHaveBeenCalledWith(
        REQUEST_ID,
        'copilot',
        'プロンプト\n\n---\n\nファイル内容'
      )
    })
  })

  describe('エラー伝播', () => {
    it('claudeApi.runPromptStream が throw したとき invokePrompt がエラーを伝播する', async () => {
      mockRunPromptStream.mockRejectedValue(new Error('API エラー'))
      await expect(invokePrompt('api', 'プロンプト', null, REQUEST_ID)).rejects.toThrow(
        'API エラー'
      )
    })

    it('cliApi.runCLIPromptStream が throw したとき invokePrompt がエラーを伝播する', async () => {
      mockRunCLIPromptStream.mockRejectedValue(new Error('CLI エラー'))
      await expect(invokePrompt('claude', 'プロンプト', null, REQUEST_ID)).rejects.toThrow(
        'CLI エラー'
      )
    })
  })
})
