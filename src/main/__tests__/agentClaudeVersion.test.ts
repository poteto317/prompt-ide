import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecFileException, ExecFileOptions } from 'node:child_process'
import {
  AGENT_HOOKS_MIN_CLAUDE_VERSION,
  CLAUDE_VERSION_KILL_GRACE_MS,
  CLAUDE_VERSION_MAX_OUTPUT_BYTES,
  CLAUDE_VERSION_TIMEOUT_MS,
  claudeVersionCommand,
  createClaudeVersionReader,
  describeClaudeVersionCheck,
  parseClaudeVersion,
  supportsHttpHooks
} from '../agentClaudeVersion'
import type {
  ClaudeVersionCheck,
  ClaudeVersionReaderDeps,
  ExecFileChild,
  ExecFileLike
} from '../agentClaudeVersion'

interface FakeRun {
  file: string
  args: readonly string[]
  options: ExecFileOptions
  child: ExecFileChild & { kill: ReturnType<typeof vi.fn<(signal: NodeJS.Signals) => boolean>> }
  finish(error: Partial<ExecFileException> | null, stdout?: string): void
}

const ENV = { PATH: '/p' }

let runs: FakeRun[]
let execFile: ExecFileLike
let stat: ReturnType<typeof vi.fn<ClaudeVersionReaderDeps['stat']>>
let log: ReturnType<typeof vi.fn<(message: string) => void>>

beforeEach(() => {
  runs = []
  execFile = (file, args, options, callback) => {
    const child: FakeRun['child'] = {
      exitCode: null,
      signalCode: null,
      kill: vi.fn<(signal: NodeJS.Signals) => boolean>(() => true)
    }
    runs.push({
      file,
      args,
      options,
      child,
      finish: (error, stdout = '') => {
        child.exitCode = error === null ? 0 : 1
        callback(
          error === null ? null : (Object.assign(new Error('x'), error) as ExecFileException),
          stdout,
          ''
        )
      }
    })
    return child
  }
  stat = vi.fn<ClaudeVersionReaderDeps['stat']>(async () => ({ mtimeMs: 1, size: 100 }))
  log = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

const reader = (
  platform: NodeJS.Platform = 'darwin'
): ReturnType<typeof createClaudeVersionReader> =>
  createClaudeVersionReader({ execFile, stat, platform, log })

/** 1 回読む。実行が呼ばれたら error・stdout で終える */
async function readOnce(
  versionReader: ReturnType<typeof createClaudeVersionReader>,
  error: Partial<ExecFileException> | null,
  stdout = '',
  file = '/bin/claude'
): Promise<ClaudeVersionCheck> {
  const before = runs.length
  const pending = versionReader.readClaudeVersion({ file, env: ENV })
  await vi.waitFor(() => expect(runs.length).toBeGreaterThan(before))
  runs[runs.length - 1].finish(error, stdout)
  return pending
}

describe('parseClaudeVersion・supportsHttpHooks', () => {
  it('定数は設計書の値', () => {
    expect(AGENT_HOOKS_MIN_CLAUDE_VERSION).toEqual([2, 1, 101])
    expect(CLAUDE_VERSION_TIMEOUT_MS).toBe(5_000)
    expect(CLAUDE_VERSION_KILL_GRACE_MS).toBe(1_000)
    expect(CLAUDE_VERSION_MAX_OUTPUT_BYTES).toBe(4_096)
  })

  it.each<[string, readonly [number, number, number] | null]>([
    ['2.1.291 (Claude Code)\n', [2, 1, 291]],
    ['  2.1.101\n', [2, 1, 101]],
    ['Claude Code 2.1.291', null],
    ['v2.1.0', null],
    ['2.1', null],
    ['', null]
  ])('%j → %j', (output, expected) => {
    expect(parseClaudeVersion(output)).toEqual(expected)
  })

  it.each<[readonly [number, number, number], boolean]>([
    [[2, 1, 101], true],
    [[2, 1, 100], false],
    [[2, 10, 0], true],
    [[3, 0, 0], true],
    [[1, 99, 999], false]
  ])('%j の対応は %s(文字列でなく数で比べる)', (version, expected) => {
    expect(supportsHttpHooks(version)).toBe(expected)
  })
})

describe('createClaudeVersionReader(判定)', () => {
  it.each<[string, Partial<ExecFileException> | null, string, ClaudeVersionCheck['kind'], string]>([
    ['対応する版', null, '2.1.291 (Claude Code)\n', 'supported', ''],
    ['古い版', null, '2.1.100 (Claude Code)\n', 'unsupported', ''],
    ['形の違う出力', null, 'hello\n', 'unknown', 'malformed-output'],
    ['空の出力', null, '', 'unknown', 'malformed-output'],
    [
      '4 KiB を超えた出力',
      { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
      '',
      'unknown',
      'malformed-output'
    ],
    ['0 でない終了', { code: 1 }, '', 'unknown', 'exit-nonzero'],
    ['起動の失敗', { code: 'ENOENT' }, '', 'unknown', 'spawn-failed'],
    ['打ち切り', { killed: true, signal: 'SIGTERM', code: null }, '', 'unknown', 'timeout']
  ])('%s', async (_label, error, stdout, kind, reason) => {
    const result = await readOnce(reader(), error, stdout)
    expect(result.kind).toBe(kind)
    if (result.kind === 'unknown') expect(result.reason).toBe(reason)
    expect(log).toHaveBeenCalledOnce()
  })

  it('形の違う出力のログは先頭 80 文字まで', async () => {
    await readOnce(reader(), null, 'x'.repeat(200))
    const [message] = log.mock.calls[0]
    expect(message).toContain('x'.repeat(80))
    expect(message).not.toContain('x'.repeat(81))
  })
})

describe('createClaudeVersionReader(実行のしかた)', () => {
  it('.cmd 以外はシェルを通さず、引数は --version だけ、環境は起動と同じで、打ち切り・出力の上限を付ける', async () => {
    await readOnce(reader('darwin'), null, '2.1.291')
    expect(runs[0].file).toBe('/bin/claude')
    expect(runs[0].args).toEqual(['--version'])
    expect(runs[0].options).toStrictEqual({
      env: ENV,
      timeout: 5000,
      killSignal: 'SIGTERM',
      maxBuffer: 4096,
      windowsHide: true
    })
  })

  it.each(['claude.cmd', 'CLAUDE.BAT'])(
    'Windows の %s は cmd.exe の /d /s /c で、パスを引用して実行する',
    async (name) => {
      const file = `C:\\Program Files\\nodejs\\${name}`
      await readOnce(reader('win32'), null, '2.1.291', file)
      expect(runs[0].file).toBe('cmd.exe')
      expect(runs[0].args).toEqual(['/d', '/s', '/c', `""${file}" --version"`])
      expect(runs[0].options).toStrictEqual({
        windowsVerbatimArguments: true,
        windowsHide: true,
        env: ENV,
        timeout: 5000,
        killSignal: 'SIGTERM',
        maxBuffer: 4096
      })
    }
  )

  it('空白を含むパスの例: 4 つ目の引数は ""C:\\Program Files\\nodejs\\claude.cmd" --version"', async () => {
    await readOnce(reader('win32'), null, '2.1.291', 'C:\\Program Files\\nodejs\\claude.cmd')
    expect(runs[0].args[3]).toBe('""C:\\Program Files\\nodejs\\claude.cmd" --version"')
  })

  it('Windows でも .exe は直接実行する', async () => {
    await readOnce(reader('win32'), null, '2.1.291', 'C:\\tools\\claude.exe')
    expect(runs[0].file).toBe('C:\\tools\\claude.exe')
  })

  it('打ち切りの後 1 秒で終わっていなければ SIGKILL を送り、timeout として返す', async () => {
    vi.useFakeTimers()
    const pending = reader().readClaudeVersion({ file: '/bin/claude', env: ENV })
    await vi.waitFor(() => expect(runs.length).toBe(1))
    vi.advanceTimersByTime(CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
    expect(runs[0].child.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL')
    runs[0].finish({ killed: true, signal: 'SIGKILL', code: null })
    await expect(pending).resolves.toMatchObject({ kind: 'unknown', reason: 'timeout' })
  })

  it('打ち切りの前に終われば、後で時間が過ぎても SIGKILL を送らない', async () => {
    vi.useFakeTimers()
    const pending = reader().readClaudeVersion({ file: '/bin/claude', env: ENV })
    await vi.waitFor(() => expect(runs.length).toBe(1))
    runs[0].finish(null, '2.1.291')
    await pending
    vi.advanceTimersByTime(CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
    expect(runs[0].child.kill).not.toHaveBeenCalled()
  })

  it('プロセスが終わっていれば(出力の読み終わりを待つ間も)SIGKILL を送らない', async () => {
    vi.useFakeTimers()
    const pending = reader().readClaudeVersion({ file: '/bin/claude', env: ENV })
    await vi.waitFor(() => expect(runs.length).toBe(1))
    runs[0].child.exitCode = 0
    vi.advanceTimersByTime(CLAUDE_VERSION_TIMEOUT_MS + CLAUDE_VERSION_KILL_GRACE_MS)
    expect(runs[0].child.kill).not.toHaveBeenCalled()
    runs[0].finish(null, '2.1.291')
    await expect(pending).resolves.toMatchObject({ kind: 'supported' })
  })
})

describe('createClaudeVersionReader(控え)', () => {
  it.each<[string, string]>([
    ['対応', '2.1.291'],
    ['非対応', '2.1.100'],
    ['形の違う出力', 'hello']
  ])(
    '版を読めた結果(%s)は同じパス・mtime・大きさでは実行し直さず、mtime が変われば実行し直す',
    async (_label, stdout) => {
      const versionReader = reader()
      const first = await readOnce(versionReader, null, stdout)
      await expect(
        versionReader.readClaudeVersion({ file: '/bin/claude', env: ENV })
      ).resolves.toEqual(first)
      expect(runs).toHaveLength(1)
      stat.mockResolvedValue({ mtimeMs: 2, size: 100 })
      await readOnce(versionReader, null, stdout)
      expect(runs).toHaveLength(2)
    }
  )

  it.each<[string, Partial<ExecFileException>]>([
    ['打ち切り', { killed: true, signal: 'SIGTERM', code: null }],
    ['起動の失敗', { code: 'ENOENT' }],
    ['0 でない終了', { code: 1 }]
  ])('一時的な失敗(%s)は控えず、次の確認で実行し直す(L-427)', async (_label, error) => {
    const versionReader = reader()
    await readOnce(versionReader, error)
    await readOnce(versionReader, null, '2.1.291')
    expect(runs).toHaveLength(2)
  })

  it('stat に失敗したら控えずに毎回実行する', async () => {
    stat.mockRejectedValue(new Error('ENOENT'))
    const versionReader = reader()
    await readOnce(versionReader, null, '2.1.291')
    await readOnce(versionReader, null, '2.1.291')
    expect(runs).toHaveLength(2)
  })
})

describe('claudeVersionCommand(実行の形)', () => {
  it('Windows 以外は .cmd でもそのまま --version で実行する', () => {
    expect(claudeVersionCommand('/opt/claude.cmd', 'linux')).toEqual({
      file: '/opt/claude.cmd',
      args: ['--version'],
      options: { windowsHide: true }
    })
  })

  it('Windows の .exe はシェルを通さない', () => {
    expect(claudeVersionCommand('C:\\bin\\claude.exe', 'win32')).toEqual({
      file: 'C:\\bin\\claude.exe',
      args: ['--version'],
      options: { windowsHide: true }
    })
  })

  it('Windows の .bat は cmd.exe の形に固定する', () => {
    expect(claudeVersionCommand('C:\\a b\\claude.bat', 'win32')).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\a b\\claude.bat" --version"'],
      options: { windowsVerbatimArguments: true, windowsHide: true }
    })
  })
})

describe('describeClaudeVersionCheck(ログの 1 行)', () => {
  it.each<[ClaudeVersionCheck, string]>([
    [{ kind: 'supported', version: '2.1.101' }, '[agent-hooks] claude の版: 2.1.101(hooks を渡す)'],
    [
      { kind: 'unsupported', version: '2.1.100' },
      '[agent-hooks] claude の版: 2.1.100(hooks を渡さない)'
    ],
    [
      { kind: 'unknown', reason: 'timeout', detail: 'シグナル SIGTERM' },
      '[agent-hooks] claude の版を確かめられませんでした(timeout): シグナル SIGTERM'
    ]
  ])('%o', (check, expected) => {
    expect(describeClaudeVersionCheck(check)).toBe(expected)
  })
})
