import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PtyLike } from '../agentSession'

// agentRuntime は実物の依存(node-pty・ログインシェル・ps・シグナル・設定ファイル)を組み立てる。
// ここでは、組み立てた関数が依存へ正しい値を受け渡すことだけを確かめる(依存そのものの振る舞いはそれぞれのテストで確かめる)
const mockPtySpawn = vi.hoisted(() => vi.fn())
vi.mock('node-pty', () => ({ spawn: mockPtySpawn }))
const mockUserInfo = vi.hoisted(() => vi.fn())
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, userInfo: mockUserInfo }, userInfo: mockUserInfo }
})
const mockGetAgentCliKindSetting = vi.hoisted(() => vi.fn())
vi.mock('../agentCliKindStore', () => ({ getAgentCliKindSetting: mockGetAgentCliKindSetting }))
const mockResolveAgentLaunch = vi.hoisted(() => vi.fn())
vi.mock('../agentCommand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentCommand')>()),
  resolveAgentLaunch: mockResolveAgentLaunch
}))
const mockReadLoginShellPath = vi.hoisted(() => vi.fn())
vi.mock('../agentShellEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentShellEnv')>()),
  readLoginShellPath: mockReadLoginShellPath
}))
const mockStopProcessTree = vi.hoisted(() => vi.fn())
vi.mock('../agentProcessTree', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentProcessTree')>()),
  stopProcessTree: mockStopProcessTree
}))

import { isExecutableRegularFile } from '../agentCommand'
import { resolveAgentLaunchFromSystem, spawnAgentPty, stopAgentPtyTree } from '../agentRuntime'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAgentCliKindSetting.mockResolvedValue({ kind: 'claude', fallback: null })
  mockResolveAgentLaunch.mockResolvedValue({
    kind: 'not-found',
    cliKind: 'claude',
    shellPathUnavailable: false
  })
  mockReadLoginShellPath.mockResolvedValue('/usr/bin:/bin')
  mockStopProcessTree.mockResolvedValue(undefined)
})

interface ResolveDeps {
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  cliKind: string
  readLoginShellPath: () => Promise<string | null>
  isExecutable: unknown
}

/** resolveAgentLaunch へ渡された依存(最後の呼び出し) */
function lastResolveDeps(): ResolveDeps {
  const calls = mockResolveAgentLaunch.mock.calls
  return calls[calls.length - 1][0]
}

function makePty(pid: number): PtyLike & { kill: ReturnType<typeof vi.fn> } {
  return { pid, kill: vi.fn() } as unknown as PtyLike & { kill: ReturnType<typeof vi.fn> }
}

describe('resolveAgentLaunchFromSystem', () => {
  it('起動のたびに設定を読み、読んだ種類で解決する(保存した値は次の起動から使われる)', async () => {
    mockGetAgentCliKindSetting
      .mockResolvedValueOnce({ kind: 'copilot', fallback: null })
      .mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    await resolveAgentLaunchFromSystem()
    await resolveAgentLaunchFromSystem()
    expect(mockGetAgentCliKindSetting).toHaveBeenCalledTimes(2)
    expect(mockResolveAgentLaunch.mock.calls.map(([deps]) => deps.cliKind)).toEqual([
      'copilot',
      'claude'
    ])
  })

  it('main の環境変数・プラットフォームと、実物の実行可能の判定を渡す', async () => {
    await resolveAgentLaunchFromSystem()
    const deps = lastResolveDeps()
    expect(deps.env).toBe(process.env)
    expect(deps.platform).toBe(process.platform)
    expect(deps.isExecutable).toBe(isExecutableRegularFile)
  })

  it('解決の結果をそのまま返す', async () => {
    const resolution = { kind: 'not-found', cliKind: 'copilot', shellPathUnavailable: true }
    mockResolveAgentLaunch.mockResolvedValueOnce(resolution)
    await expect(resolveAgentLaunchFromSystem()).resolves.toBe(resolution)
  })

  it('設定の読み込みが失敗したら、解決を呼ばずに失敗を伝える', async () => {
    mockGetAgentCliKindSetting.mockRejectedValueOnce(new Error('read failed'))
    await expect(resolveAgentLaunchFromSystem()).rejects.toThrow('read failed')
    expect(mockResolveAgentLaunch).not.toHaveBeenCalled()
  })

  it('ログインシェルの PATH は、利用者のシェルを指定して読む', async () => {
    mockUserInfo.mockReturnValue({ shell: '/bin/zsh' })
    await resolveAgentLaunchFromSystem()
    await expect(lastResolveDeps().readLoginShellPath()).resolves.toBe('/usr/bin:/bin')
    expect(mockReadLoginShellPath).toHaveBeenCalledWith({ userShell: '/bin/zsh' })
  })

  it('利用者のシェルが分からない(userInfo の shell が null)ときは null を渡す', async () => {
    mockUserInfo.mockReturnValue({ shell: null })
    await resolveAgentLaunchFromSystem()
    await lastResolveDeps().readLoginShellPath()
    expect(mockReadLoginShellPath).toHaveBeenCalledWith({ userShell: null })
  })

  it('userInfo が例外を投げても(利用者の情報が引けない環境)、null を渡して PATH の取得を続ける', async () => {
    mockUserInfo.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    await resolveAgentLaunchFromSystem()
    await expect(lastResolveDeps().readLoginShellPath()).resolves.toBe('/usr/bin:/bin')
    expect(mockReadLoginShellPath).toHaveBeenCalledWith({ userShell: null })
  })

  it('ログインシェルは、解決が PATH を求めたときにだけ読む(解決の前には読まない)', async () => {
    await resolveAgentLaunchFromSystem()
    expect(mockUserInfo).not.toHaveBeenCalled()
    expect(mockReadLoginShellPath).not.toHaveBeenCalled()
  })
})

describe('spawnAgentPty', () => {
  it('引数をそのまま node-pty の spawn へ渡し、その戻り値を返す', () => {
    const pty = makePty(123)
    mockPtySpawn.mockReturnValue(pty)
    const options = { name: 'xterm-256color', cols: 80, rows: 24, cwd: '/work', env: { A: '1' } }
    const result = spawnAgentPty('/usr/local/bin/claude', ['--resume', 'abc'], options)
    expect(mockPtySpawn).toHaveBeenCalledWith('/usr/local/bin/claude', ['--resume', 'abc'], options)
    expect(result).toBe(pty)
  })
})

describe('stopAgentPtyTree', () => {
  it('pty の pid と終了の Promise を、子孫のプロセスの停止へ渡す', async () => {
    const exited = Promise.resolve()
    await stopAgentPtyTree(makePty(4321), exited)
    expect(mockStopProcessTree).toHaveBeenCalledTimes(1)
    const [options] = mockStopProcessTree.mock.calls[0]
    expect(options.pid).toBe(4321)
    expect(options.exited).toBe(exited)
  })

  it('停止の側が killPty を呼ぶと、その pty の kill が呼ばれる(呼ぶまでは kill しない)', async () => {
    const pty = makePty(1)
    await stopAgentPtyTree(pty, Promise.resolve())
    expect(pty.kill).not.toHaveBeenCalled()
    const [options] = mockStopProcessTree.mock.calls[0]
    options.killPty()
    expect(pty.kill).toHaveBeenCalledTimes(1)
  })

  it('停止の失敗をそのまま伝える', async () => {
    mockStopProcessTree.mockRejectedValueOnce(new Error('stop failed'))
    await expect(stopAgentPtyTree(makePty(1), Promise.resolve())).rejects.toThrow('stop failed')
  })
})
