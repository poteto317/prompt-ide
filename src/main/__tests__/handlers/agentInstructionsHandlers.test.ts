import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { FolderAccessDeniedError } from '../../folderAccessManager'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockCreate = vi.hoisted(() => vi.fn())
vi.mock('../../agentInstructionFileCreator', () => ({ createAgentInstructionFile: mockCreate }))
const mockRealpath = vi.hoisted(() => vi.fn(async (path: string) => path))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const mocked = { ...actual, realpath: mockRealpath }
  return { ...mocked, default: mocked }
})

import {
  registerAgentInstructionsHandlers,
  toAgentInstructionCreateFailureReason
} from '../../handlers/agentInstructionsHandlers'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

const fsError = (code: string): NodeJS.ErrnoException => {
  const err = new Error(`${code}: /secret/path`) as NodeJS.ErrnoException
  err.code = code
  return err
}

const register = (folder: string | undefined): Handler => {
  const folderAccess = { get: vi.fn(() => folder) } as unknown as FolderAccessManager
  registerAgentInstructionsHandlers({ handle: mockHandle } as never, folderAccess)
  const call = mockHandle.mock.calls.find(([channel]) => channel === 'agentInstructions:create')
  if (call === undefined) throw new Error('not registered')
  return call[1] as Handler
}

const event = { sender: { id: 1 } } as unknown as IpcMainInvokeEvent

describe('agentInstructions:create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRealpath.mockImplementation(async (path: string) => path)
  })

  it('正しい引数 → 表の行で作成を呼び { ok: true }', async () => {
    mockCreate.mockResolvedValue(undefined)
    const handler = register('/allowed')
    await expect(handler(event, '/allowed', 'claude', 'claude-dot')).resolves.toEqual({ ok: true })
    expect(mockCreate).toHaveBeenCalledWith(
      '/allowed',
      expect.anything(),
      expect.objectContaining({ id: 'claude-dot', segments: ['.claude', 'CLAUDE.md'] })
    )
  })

  it.each([
    ['不正な cliKind', 'codex', 'claude-root'],
    ['null の cliKind', null, 'claude-root'],
    ['不正な fileId', 'claude', '../etc'],
    ['CLI に合わない fileId', 'claude', 'copilot-agents'],
    ['数の fileId', 'copilot', 1]
  ])('%s → 例外にし、作成を呼ばない', async (_label, cliKind, fileId) => {
    const handler = register('/allowed')
    await expect(handler(event, '/allowed', cliKind, fileId)).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('フォルダを開いていない → failed で、作成を呼ばない', async () => {
    const handler = register(undefined)
    await expect(handler(event, '/allowed', 'claude', 'claude-root')).resolves.toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['数', 1],
    ['空文字', '']
  ])('expectedRoot が不正(%s) → 例外にし、作成を呼ばない', async (_label, expectedRoot) => {
    const handler = register('/allowed')
    await expect(handler(event, expectedRoot, 'claude', 'claude-root')).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('許可フォルダが B で、送られた根が A → 作成を呼ばず folderChanged', async () => {
    const handler = register('/b')
    await expect(handler(event, '/a', 'claude', 'claude-root')).resolves.toEqual({
      ok: false,
      reason: 'folderChanged'
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('送られた根を realpath して許可フォルダと比べる(書き方が違っても同じフォルダなら作る)', async () => {
    mockCreate.mockResolvedValue(undefined)
    mockRealpath.mockImplementation(async (path: string) =>
      path === '/link/to/allowed' ? '/allowed' : path
    )
    const handler = register('/allowed')
    await expect(handler(event, '/link/to/allowed', 'claude', 'claude-root')).resolves.toEqual({
      ok: true
    })
    expect(mockRealpath).toHaveBeenCalledWith('/link/to/allowed')
    // 書くパスは許可フォルダから決める(送られた根は比べるためだけに使う。L-018)
    expect(mockCreate).toHaveBeenCalledWith('/allowed', expect.anything(), expect.anything())
  })

  it('送られた根の realpath が失敗 → 作成を呼ばず folderChanged', async () => {
    mockRealpath.mockRejectedValue(fsError('ENOENT'))
    const handler = register('/allowed')
    await expect(handler(event, '/gone', 'claude', 'claude-root')).resolves.toEqual({
      ok: false,
      reason: 'folderChanged'
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['EEXIST', fsError('EEXIST'), 'exists'],
    ['ENOTDIR', fsError('ENOTDIR'), 'exists'],
    ['範囲外', new FolderAccessDeniedError('Access denied: /secret'), 'outside'],
    ['ENOENT', fsError('ENOENT'), 'failed'],
    ['EACCES', fsError('EACCES'), 'failed'],
    ['文字列', 'boom', 'failed']
  ])('作成の失敗 %s → 理由 %s を返し、文言・パスを返さない', async (_label, err, reason) => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockCreate.mockRejectedValue(err)
      const handler = register('/allowed')
      const result = await handler(event, '/allowed', 'claude', 'claude-root')
      expect(result).toEqual({ ok: false, reason })
      expect(JSON.stringify(result)).not.toContain('/secret')
      expect(consoleErrorSpy).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('toAgentInstructionCreateFailureReason', () => {
  it('EEXIST → exists', () => {
    expect(toAgentInstructionCreateFailureReason(fsError('EEXIST'))).toBe('exists')
  })
})
