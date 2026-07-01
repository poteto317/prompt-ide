import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}))

import { runCLIPrompt } from '../cliService'

function makeChild() {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() }
  const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, kill: vi.fn() })
  return child
}

let savedPath: string | undefined

beforeEach(() => {
  savedPath = process.env.PATH
  vi.clearAllMocks()
})

afterEach(() => {
  // platform スパイと process.env.PATH をテスト失敗時も確実に復元する
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (savedPath !== undefined) {
    process.env.PATH = savedPath
  } else {
    delete process.env.PATH
  }
})

describe('runCLIPrompt', () => {
  it('不明な toolId のとき即座に reject する（型バイパス時の防御）', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(runCLIPrompt('unknown' as any, 'test')).rejects.toThrow('不明な CLI ツール: unknown')
  })

  it('claude: stdout を収集して resolve する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テストプロンプト')
    child.stdout.emit('data', Buffer.from('出力の1行目'))
    child.stdout.emit('data', Buffer.from('\n出力の2行目'))
    child.emit('close', 0, null)

    await expect(promise).resolves.toBe('出力の1行目\n出力の2行目')
  })

  it('claude: stdin にプロンプト内容を書き込む', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テストプロンプト')
    child.emit('close', 0, null)
    await promise

    expect(child.stdin.write).toHaveBeenCalledWith('テストプロンプト', 'utf-8')
    expect(child.stdin.end).toHaveBeenCalledOnce()
  })

  it('claude: spawn を claude --print で呼ぶ', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', 0, null)
    await promise

    expect(mockSpawn).toHaveBeenCalledWith('claude', ['--print'], expect.any(Object))
  })

  it('copilot: spawn を gh models run copilot で呼ぶ', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('copilot', 'テスト')
    child.emit('close', 0, null)
    await promise

    expect(mockSpawn).toHaveBeenCalledWith('gh', ['models', 'run', 'copilot'], expect.any(Object))
  })

  it('非ゼロ終了コードのとき stderr を含むエラーで reject する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.stderr.emit('data', Buffer.from('command not found'))
    child.emit('close', 1, null)

    await expect(promise).rejects.toThrow('command not found')
  })

  it('非ゼロ終了コードで stderr が空のとき汎用エラーメッセージで reject する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', 127, null)

    await expect(promise).rejects.toThrow('プロセスが終了コード 127 で終了しました')
  })

  it('シグナルで kill されたとき signal 名を含むエラーで reject する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', null, 'SIGTERM')

    await expect(promise).rejects.toThrow('CLI ツールがシグナル SIGTERM で終了しました')
  })

  it('spawn が error イベントを emit したとき reject する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('error', new Error('ENOENT'))

    await expect(promise).rejects.toThrow('CLI ツールの起動に失敗しました: ENOENT')
  })

  it('error → close の順で両イベントが発生しても reject は一度だけ呼ばれる', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('error', new Error('ENOENT'))
    child.emit('close', null, 'SIGSEGV')

    await expect(promise).rejects.toThrow('CLI ツールの起動に失敗しました: ENOENT')
  })

  it('タイムアウト時間を超えると子プロセスを kill して reject する', async () => {
    vi.useFakeTimers()
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    vi.advanceTimersByTime(30_000)

    await expect(promise).rejects.toThrow('CLI ツールがタイムアウトしました（30秒）')
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('close(null, null) のとき終了コード null を含む汎用エラーで reject する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', null, null)

    await expect(promise).rejects.toThrow('プロセスが終了コード null で終了しました')
  })

  it('close が先に resolve した場合、タイムアウト経過後も kill は呼ばれない', async () => {
    vi.useFakeTimers()
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.stdout.emit('data', Buffer.from('正常出力'))
    child.emit('close', 0, null)  // タイムアウト前に正常終了
    vi.advanceTimersByTime(30_000)  // タイムアウト時間を経過させる

    await expect(promise).resolves.toBe('正常出力')
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('タイムアウト後に OS が close イベントを発行しても二重 reject にならない', async () => {
    vi.useFakeTimers()
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    vi.advanceTimersByTime(30_000)
    // タイムアウト後にプロセスが SIGTERM で終了するシナリオ
    child.emit('close', null, 'SIGTERM')

    await expect(promise).rejects.toThrow('CLI ツールがタイムアウトしました（30秒）')
  })

  it('stdin error イベントが発火すると settle 経由で即時 reject する', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    const stdinError = new Error('EPIPE: broken pipe')
    child.stdin.on.mock.calls
      .filter(([event]: [string]) => event === 'error')
      .forEach(([, handler]: [string, (err: Error) => void]) => handler(stdinError))

    await expect(promise).rejects.toThrow('stdin への書き込みに失敗しました: EPIPE: broken pipe')
  })

  it('stdin error で reject 後に close(0) が来ても二重 resolve にならない', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    const stdinError = new Error('EPIPE: broken pipe')
    child.stdin.on.mock.calls
      .filter(([event]: [string]) => event === 'error')
      .forEach(([, handler]: [string, (err: Error) => void]) => handler(stdinError))
    child.stdout.emit('data', Buffer.from('出力'))
    child.emit('close', 0, null)

    await expect(promise).rejects.toThrow('stdin への書き込みに失敗しました')
  })

  it('close/error リスナーが stdin.write より先に登録されるため起動直後の早期終了も捕捉できる', async () => {
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    // stdin.write が呼ばれる前に close が発火するシナリオ（コマンドが即座に失敗する場合など）
    // runCLIPrompt 内で close リスナーを stdin 操作より先に登録しているため捕捉できる
    child.stdin.write = vi.fn().mockImplementation(() => {
      child.stderr.emit('data', Buffer.from('claude: command not found'))
      child.emit('close', 127, null)
    })

    const promise = runCLIPrompt('claude', 'テスト')
    await expect(promise).rejects.toThrow('claude: command not found')
  })

  it('Unix 環境では /usr/local/bin と /opt/homebrew/bin を PATH に追加して spawn を呼ぶ', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', 0, null)
    await promise

    const spawnEnv = mockSpawn.mock.calls[0][2].env as NodeJS.ProcessEnv
    expect(spawnEnv.PATH).toContain('/usr/local/bin')
    expect(spawnEnv.PATH).toContain('/opt/homebrew/bin')
  })

  it('Unix 環境では Linux 向けパス（/snap/bin, ~/.cargo/bin）も PATH に追加して spawn を呼ぶ', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const savedHome = process.env.HOME
    process.env.HOME = '/home/testuser'
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', 0, null)
    await promise

    const spawnEnv = mockSpawn.mock.calls[0][2].env as NodeJS.ProcessEnv
    expect(spawnEnv.PATH).toContain('/snap/bin')
    expect(spawnEnv.PATH).toContain('/home/testuser/.cargo/bin')

    process.env.HOME = savedHome
  })

  it('Windows 環境では Unix 固有パスを追加せず process.env をそのまま渡す', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    process.env.PATH = 'C:\\Windows\\System32'

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', 0, null)
    await promise

    const spawnEnv = mockSpawn.mock.calls[0][2].env as NodeJS.ProcessEnv
    expect(spawnEnv.PATH).toBe('C:\\Windows\\System32')
    expect(spawnEnv.PATH).not.toContain('/usr/local/bin')
    expect(spawnEnv.PATH).not.toContain('/opt/homebrew/bin')
  })

  it('Unix 環境かつ process.env.PATH が undefined のとき PATH が先頭コロンなしで設定される', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    delete process.env.PATH

    const child = makeChild()
    mockSpawn.mockReturnValue(child)

    const promise = runCLIPrompt('claude', 'テスト')
    child.emit('close', 0, null)
    await promise

    const spawnEnv = mockSpawn.mock.calls[0][2].env as NodeJS.ProcessEnv
    expect(spawnEnv.PATH).not.toMatch(/^:/)
    expect(spawnEnv.PATH).toContain('/usr/local/bin')
  })
})
