import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

const mockReadSettingsFile = vi.hoisted(() => vi.fn())
const mockWriteSettingsFile = vi.hoisted(() => vi.fn())
vi.mock('../settingsFileStore', () => ({
  readSettingsFile: mockReadSettingsFile,
  writeSettingsFile: mockWriteSettingsFile
}))

import {
  AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH,
  getAgentCliKindSetting,
  setAgentCliKind
} from '../agentCliKindStore'

const INVALID_LOG = '[agentCliKind] 保存されていた値を読めないため claude を使います: '
const READ_FAILED_LOG = '[agentCliKind] 設定ファイルを読めないため claude を使います'

let warnSpy: MockInstance<typeof console.warn> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteSettingsFile.mockResolvedValue(undefined)
})

afterEach(() => {
  warnSpy?.mockRestore()
  warnSpy = null
})

describe('getAgentCliKindSetting', () => {
  it.each(['claude', 'copilot'])('保存された %s を返し、ログを出さない', async (kind) => {
    mockReadSettingsFile.mockResolvedValueOnce({
      agentCliKind: kind,
      promptExecutionMode: 'agent-cli'
    })
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({ kind, fallback: null })
    expect(log).not.toHaveBeenCalled()
  })

  it('値が無ければ既定の claude で、既定に戻した理由は無い(ログも出さない)', async () => {
    mockReadSettingsFile.mockResolvedValueOnce({})
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({ kind: 'claude', fallback: null })
    expect(log).not.toHaveBeenCalled()
  })

  it.each([
    ['知らない文字列', 'codex', '"codex"'],
    ['大文字の違う文字列', 'Claude', '"Claude"'],
    ['数', 1, '1'],
    ['オブジェクト', {}, '{}'],
    ['null', null, 'null']
  ])(
    '%s は claude に戻して invalid-value とし、値をログに出す(L-044)',
    async (_label, value, shown) => {
      mockReadSettingsFile.mockResolvedValueOnce({ agentCliKind: value })
      const log = vi.fn()
      await expect(getAgentCliKindSetting(log)).resolves.toEqual({
        kind: 'claude',
        fallback: 'invalid-value'
      })
      expect(log).toHaveBeenCalledExactlyOnceWith(`${INVALID_LOG}${shown}`)
    }
  )

  it('ログに出す値は JSON の先頭 80 文字だけ(L-017)', async () => {
    const value = 'x'.repeat(200)
    mockReadSettingsFile.mockResolvedValueOnce({ agentCliKind: value })
    const log = vi.fn()
    await getAgentCliKindSetting(log)
    expect(AGENT_CLI_KIND_LOG_VALUE_MAX_LENGTH).toBe(80)
    expect(log).toHaveBeenCalledExactlyOnceWith(
      `${INVALID_LOG}${JSON.stringify(value).slice(0, 80)}`
    )
  })

  it('readSettingsFile が投げたら claude に戻して read-failed とし、例外の文言はログに出さない(L-017)', async () => {
    mockReadSettingsFile.mockRejectedValueOnce(
      new SyntaxError('Unexpected token in JSON: {"encryptedApiKey":"secret-cipher"')
    )
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({
      kind: 'claude',
      fallback: 'read-failed'
    })
    expect(log).toHaveBeenCalledExactlyOnceWith(READ_FAILED_LOG)
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-cipher')
  })

  // readSettingsFile は JSON.parse の結果を型の主張だけで返すため、オブジェクトでない JSON でも投げずに返ってくる
  it.each([
    ['null', null],
    ['配列', ['copilot']],
    ['数', 1],
    ['文字列', 'copilot']
  ])('読んだ JSON が %s なら投げずに claude に戻して read-failed', async (_label, data) => {
    mockReadSettingsFile.mockResolvedValueOnce(data)
    const log = vi.fn()
    await expect(getAgentCliKindSetting(log)).resolves.toEqual({
      kind: 'claude',
      fallback: 'read-failed'
    })
    expect(log).toHaveBeenCalledExactlyOnceWith(READ_FAILED_LOG)
  })

  it('log を省くと console.warn に出す', async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockReadSettingsFile.mockResolvedValueOnce({ agentCliKind: 'codex' })
    await getAgentCliKindSetting()
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(`${INVALID_LOG}"codex"`)
  })
})

describe('setAgentCliKind', () => {
  it.each(['claude', 'copilot'])('%s を検証してマージで書き込む', async (kind) => {
    await setAgentCliKind(kind)
    expect(mockWriteSettingsFile).toHaveBeenCalledExactlyOnceWith({ agentCliKind: kind })
  })

  it.each(['codex', '', 'Claude', null, 1, undefined])(
    '知らない値(%o)は書き込まずに投げ、値を文言に入れない(claude に倒さない。L-044)',
    async (kind) => {
      await expect(setAgentCliKind(kind)).rejects.toThrow(
        new Error('使うエージェント CLI が不正です')
      )
      expect(mockWriteSettingsFile).not.toHaveBeenCalled()
    }
  )
})
