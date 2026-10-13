import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { join } from 'node:path'

const mockToolActivity = vi.hoisted(() => ({
  addSession: vi.fn(),
  removeSession: vi.fn(),
  deliver: vi.fn(),
  reportWorking: vi.fn(),
  activityOf: vi.fn(),
  toolStartSeqOf: vi.fn(),
  close: vi.fn()
}))
const mockCreateAgentToolActivity = vi.hoisted(() => vi.fn(() => mockToolActivity))
vi.mock('../agentToolActivity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentToolActivity')>()),
  createAgentToolActivity: mockCreateAgentToolActivity
}))
const mockHookReceiver = vi.hoisted(() => ({
  ensureListening: vi.fn(),
  addToken: vi.fn(),
  removeToken: vi.fn(),
  close: vi.fn()
}))
const mockCreateAgentHookReceiver = vi.hoisted(() => vi.fn(() => mockHookReceiver))
vi.mock('../agentHookReceiver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentHookReceiver')>()),
  createAgentHookReceiver: mockCreateAgentHookReceiver
}))
const mockHookSettingsDir = vi.hoisted(() => ({ ensure: vi.fn(), removeSync: vi.fn() }))
const mockCreateAgentHookSettingsDir = vi.hoisted(() => vi.fn(() => mockHookSettingsDir))
vi.mock('../agentHookSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentHookSettings')>()),
  createAgentHookSettingsDir: mockCreateAgentHookSettingsDir
}))
const mockVersionReader = vi.hoisted(() => ({ readClaudeVersion: vi.fn() }))
const mockCreateClaudeVersionReader = vi.hoisted(() => vi.fn(() => mockVersionReader))
vi.mock('../agentClaudeVersion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentClaudeVersion')>()),
  createClaudeVersionReader: mockCreateClaudeVersionReader
}))
const mockHookSessions = vi.hoisted(() => ({
  prepare: vi.fn(),
  activate: vi.fn(),
  release: vi.fn()
}))
const mockCreateAgentHookSessions = vi.hoisted(() => vi.fn(() => mockHookSessions))
vi.mock('../agentHookSessions', () => ({ createAgentHookSessions: mockCreateAgentHookSessions }))

import { createAgentHooksRuntime, nodeExecFile } from '../agentHooksRuntime'
import type { AgentHooksRuntimeOptions } from '../agentHooksRuntime'
import { removeAgentHookSettingsFile, writeAgentHookSettingsFile } from '../agentHookSettings'

const firstArg = (mock: MockInstance | ReturnType<typeof vi.fn>): Record<string, unknown> =>
  (mock.mock.calls[0] as unknown[])[0] as Record<string, unknown>

function createOptions(): AgentHooksRuntimeOptions {
  return {
    onPhaseChange: vi.fn(),
    onToolStart: vi.fn(async () => undefined),
    onToolStartTimedOut: vi.fn(),
    devLog: vi.fn()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createAgentHooksRuntime', () => {
  it('追跡に段階の通知・開発版のログと常に出すログを渡す', () => {
    const options = createOptions()
    createAgentHooksRuntime(options)
    expect(mockCreateAgentToolActivity).toHaveBeenCalledOnce()
    const deps = firstArg(mockCreateAgentToolActivity)
    expect(deps.onPhaseChange).toBe(options.onPhaseChange)
    expect(deps.devLog).toBe(options.devLog)
    expect(typeof deps.warn).toBe('function')
  })

  it('受け口は知らせを追跡の deliver に渡し、ツールの開始の待ち・打ち切りは渡されたものを使う', () => {
    const options = createOptions()
    createAgentHooksRuntime(options)
    const deps = firstArg(mockCreateAgentHookReceiver) as {
      deliver: (ownerId: number, sessionId: string, event: unknown) => void
      onToolStart: unknown
      onToolStartTimedOut: unknown
      log: unknown
    }
    const event = { kind: 'turn-end', hookEventName: 'Stop', toolName: null }
    deps.deliver(3, 'sid-1', event)
    expect(mockToolActivity.deliver).toHaveBeenCalledExactlyOnceWith(3, 'sid-1', event)
    expect(deps.onToolStart).toBe(options.onToolStart)
    expect(deps.onToolStartTimedOut).toBe(options.onToolStartTimedOut)
    expect(typeof deps.log).toBe('function')
  })

  it('版の確認は実物の execFile・stat と process.platform で行う', () => {
    createAgentHooksRuntime(createOptions())
    const deps = firstArg(mockCreateClaudeVersionReader)
    expect(deps.execFile).toBe(nodeExecFile)
    expect(typeof deps.stat).toBe('function')
    expect(deps.platform).toBe(process.platform)
  })

  it('版の確認の cmd.exe は ComSpec の絶対パス(無ければ SystemRoot の System32)を渡す', () => {
    const saved = { ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot }
    try {
      process.env.ComSpec = 'D:\\custom\\cmd.exe'
      createAgentHooksRuntime(createOptions())
      expect(firstArg(mockCreateClaudeVersionReader).comspec).toBe('D:\\custom\\cmd.exe')
      mockCreateClaudeVersionReader.mockClear()
      delete process.env.ComSpec
      process.env.SystemRoot = 'E:\\WinRoot'
      createAgentHooksRuntime(createOptions())
      expect(firstArg(mockCreateClaudeVersionReader).comspec).toBe(
        join('E:\\WinRoot', 'System32', 'cmd.exe')
      )
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })

  it('hooks の準備は同じ受け口・設定のディレクトリ・追跡・版の確認と、実物のファイルの書き込み・削除を使う', () => {
    const runtime = createAgentHooksRuntime(createOptions())
    expect(mockCreateAgentHookSessions).toHaveBeenCalledOnce()
    const deps = firstArg(mockCreateAgentHookSessions)
    expect(deps.receiver).toBe(mockHookReceiver)
    expect(deps.settingsDir).toBe(mockHookSettingsDir)
    expect(deps.tracker).toBe(mockToolActivity)
    expect(deps.versions).toBe(mockVersionReader)
    expect(deps.writeSettingsFile).toBe(writeAgentHookSettingsFile)
    expect(deps.removeSettingsFile).toBe(removeAgentHookSettingsFile)
    expect(runtime.sessions).toBe(mockHookSessions)
  })

  it('追跡と、will-quit で片付ける同じ受け口・設定のディレクトリ・追跡を返す', () => {
    const runtime = createAgentHooksRuntime(createOptions())
    expect(runtime.tracker).toBe(mockToolActivity)
    expect(runtime.lifecycleParts).toEqual({
      receiver: mockHookReceiver,
      settingsDir: mockHookSettingsDir,
      tracker: mockToolActivity
    })
    expect(runtime.lifecycleParts.receiver).toBe(mockHookReceiver)
    expect(runtime.lifecycleParts.settingsDir).toBe(mockHookSettingsDir)
    expect(runtime.lifecycleParts.tracker).toBe(mockToolActivity)
  })
})

describe('nodeExecFile', () => {
  it('実物の execFile で実行し、出力を utf8 の文字列で返す(引数の配列は写して渡す)', async () => {
    const args: readonly string[] = ['-e', 'process.stdout.write("2.1.101 (Claude Code)")']
    const stdout = await new Promise<string>((resolve, reject) => {
      nodeExecFile(process.execPath, args, { windowsHide: true }, (error, out) => {
        if (error !== null) reject(error)
        else resolve(out)
      })
    })
    expect(stdout).toBe('2.1.101 (Claude Code)')
    expect(typeof stdout).toBe('string')
  })
})
