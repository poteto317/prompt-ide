import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../cliService')

import * as cliService from '../../cliService'
import { registerCLIHandlers } from '../../handlers/cliHandlers'

const mockRunCLIPrompt = vi.mocked(cliService.runCLIPrompt)

function buildIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }),
    getHandler: (channel: string) => handlers.get(channel)!,
  }
}

const makeEvent = () => ({})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerCLIHandlers', () => {
  it('cli:runPrompt ハンドラーが登録される', () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)
    expect(ipcMain.handle).toHaveBeenCalledWith('cli:runPrompt', expect.any(Function))
  })

  it('正常系: runCLIPrompt の結果を返す', async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)
    mockRunCLIPrompt.mockResolvedValue('CLI出力')

    const handler = ipcMain.getHandler('cli:runPrompt')
    const result = await handler(makeEvent(), { toolId: 'claude', promptContent: 'テスト' })

    expect(mockRunCLIPrompt).toHaveBeenCalledWith('claude', 'テスト')
    expect(result).toBe('CLI出力')
  })

  it('payload が null のとき引数バリデーションエラーを投げる', async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)

    const handler = ipcMain.getHandler('cli:runPrompt')
    await expect(handler(makeEvent(), null)).rejects.toThrow('引数はオブジェクトである必要があります')
  })

  it('toolId が文字列でないとき toolId バリデーションエラーを投げる', async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)

    const handler = ipcMain.getHandler('cli:runPrompt')
    await expect(handler(makeEvent(), { toolId: 123, promptContent: 'テスト' })).rejects.toThrow(
      'toolId は文字列である必要があります'
    )
  })

  it("toolId が 'api' のとき allowlist エラーを投げる（CLI ハンドラーでは無効な値）", async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)

    const handler = ipcMain.getHandler('cli:runPrompt')
    await expect(
      handler(makeEvent(), { toolId: 'api', promptContent: 'テスト' })
    ).rejects.toThrow("toolId は 'claude' または 'copilot' である必要があります（受け取った値: api）")
  })

  it('promptContent が文字列でないとき promptContent バリデーションエラーを投げる', async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)

    const handler = ipcMain.getHandler('cli:runPrompt')
    await expect(
      handler(makeEvent(), { toolId: 'claude', promptContent: null })
    ).rejects.toThrow('promptContent は文字列である必要があります')
  })

  it('promptContent が空白のみのとき空文字バリデーションエラーを投げる', async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)

    const handler = ipcMain.getHandler('cli:runPrompt')
    await expect(
      handler(makeEvent(), { toolId: 'claude', promptContent: '   ' })
    ).rejects.toThrow('promptContent は空文字列にできません')
  })

  it('runCLIPrompt が throw したときエラーが伝播する', async () => {
    const ipcMain = buildIpcMain()
    registerCLIHandlers(ipcMain as never)
    mockRunCLIPrompt.mockRejectedValue(new Error('spawn error'))

    const handler = ipcMain.getHandler('cli:runPrompt')
    await expect(
      handler(makeEvent(), { toolId: 'claude', promptContent: 'テスト' })
    ).rejects.toThrow('spawn error')
  })
})
