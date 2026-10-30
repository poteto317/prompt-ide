import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  AGENT_PS_TIMEOUT_MS,
  collectDescendants,
  isSignalablePid,
  listProcesses,
  parsePsPidPpid,
  safeKill,
  stopProcessTree
} from '../agentProcessTree'
import type { KillFn, ProcessEntry } from '../agentProcessTree'

// ps は偽物に差し替える(実プロセスへシグナルを送るテストは書かない。送信は偽の kill で列ごと固定する)
const mockExecFile = vi.hoisted(() => vi.fn())
// Windows の既定の taskkill の起動も偽物にする(実際には起動しない)
const mockSpawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: { ...actual, execFile: mockExecFile, spawn: mockSpawn },
    execFile: mockExecFile,
    spawn: mockSpawn
  }
})

type ExecFileCallback = (err: Error | null, stdout: string, stderr: string) => void

/** execFile の偽物を 1 回分だけ設定する。callback の引数を決めて呼ぶ */
function mockExecFileOnce(err: Error | null, stdout: string): void {
  mockExecFile.mockImplementationOnce((...args: unknown[]) => {
    const callback = args[args.length - 1] as ExecFileCallback
    callback(err, stdout, '')
    return undefined
  })
}

afterEach(() => {
  vi.useRealTimers()
  mockExecFile.mockReset()
  mockSpawn.mockReset()
})

describe('parsePsPidPpid', () => {
  it('前後の空白のある行を解析し、解析できない行は捨てる', () => {
    expect(parsePsPidPpid('    1     0\n  501     1\nPID PPID\n\n 9 8 7\n')).toEqual([
      { pid: 1, ppid: 0 },
      { pid: 501, ppid: 1 }
    ])
  })
})

describe('collectDescendants', () => {
  const table: ProcessEntry[] = [
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 10 },
    { pid: 13, ppid: 11 },
    { pid: 20, ppid: 1 }
  ]
  it('子・孫を集め、根と無関係なプロセスは含めない', () => {
    expect(collectDescendants(10, table).sort()).toEqual([11, 12, 13])
  })
  it('子が無ければ空', () => {
    expect(collectDescendants(20, table)).toEqual([])
  })
  it('親子の循環があっても止まる', () => {
    expect(
      collectDescendants(1, [
        { pid: 2, ppid: 1 },
        { pid: 1, ppid: 2 }
      ])
    ).toEqual([2])
  })
})

describe('safeKill', () => {
  it.each(['ESRCH', 'EPERM', 'EINVAL'])('%s を握る', (code) => {
    const kill = vi.fn<KillFn>(() => {
      throw Object.assign(new Error(code), { code })
    })
    expect(() => safeKill(kill, -1, 'SIGTERM')).not.toThrow()
  })
})

// 生きているプロセスの集合を持つ偽の kill。シグナル 0 は生死の確認、それ以外は記録して止める
function makeKill(
  alive: Set<number>,
  options: { ignoreTerm?: number[] } = {}
): KillFn & {
  calls: Array<[number, NodeJS.Signals | 0]>
} {
  const calls: Array<[number, NodeJS.Signals | 0]> = []
  const kill = ((pid: number, signal: NodeJS.Signals | 0) => {
    calls.push([pid, signal])
    if (signal === 0) {
      if (!alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
      return
    }
    if (pid < 0) {
      if (signal === 'SIGTERM' && options.ignoreTerm?.includes(-pid)) return
      alive.delete(-pid)
      return
    }
    alive.delete(pid)
  }) as KillFn & { calls: Array<[number, NodeJS.Signals | 0]> }
  kill.calls = calls
  return kill
}

describe('stopProcessTree(POSIX)', () => {
  const table: ProcessEntry[] = [
    { pid: 100, ppid: 1 },
    { pid: 101, ppid: 100 },
    { pid: 102, ppid: 101 }
  ]

  it('グループへ SIGTERM を送り、終了したら猶予を待たずに、生き残った子孫へ SIGKILL を送る', async () => {
    vi.useFakeTimers()
    const alive = new Set([100, 101, 102])
    const kill = makeKill(alive)
    let markExited: () => void = () => undefined
    const exited = new Promise<void>((resolve) => (markExited = resolve))
    const done = stopProcessTree({
      pid: 100,
      exited,
      platform: 'darwin',
      listProcesses: async () => table,
      kill
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(kill.calls).toContainEqual([-100, 'SIGTERM'])
    // claude は終わったが、別のセッションの孫(102)は残っている
    alive.delete(100)
    alive.delete(101)
    markExited()
    await done
    // 送信列を丸ごと固定する(余計な送信 — kill(0) や無関係な pid — を検知する)
    expect(kill.calls).toEqual([
      [-100, 'SIGTERM'],
      [101, 0],
      [102, 0],
      [102, 'SIGKILL']
    ])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('猶予の間に終わらなければグループと子孫へ SIGKILL を送り、終了を待って解決する', async () => {
    vi.useFakeTimers()
    const alive = new Set([100, 101, 102])
    const kill = makeKill(alive, { ignoreTerm: [100] })
    let markExited: () => void = () => undefined
    const exited = new Promise<void>((resolve) => (markExited = resolve))
    let resolved = false
    const done = stopProcessTree({
      pid: 100,
      exited,
      graceMs: 3000,
      platform: 'darwin',
      listProcesses: async () => table,
      kill
    }).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(kill.calls).not.toContainEqual([-100, 'SIGKILL'])
    await vi.advanceTimersByTimeAsync(1)
    expect(kill.calls).toContainEqual([-100, 'SIGKILL'])
    expect(resolved).toBe(false)
    markExited()
    await done
    expect(resolved).toBe(true)
    expect(kill.calls).toEqual([
      [-100, 'SIGTERM'],
      [-100, 'SIGKILL'],
      [101, 0],
      [101, 'SIGKILL'],
      [102, 0],
      [102, 'SIGKILL']
    ])
  })

  it('SIGKILL の後に終了が来なくても settleMs で解決する', async () => {
    vi.useFakeTimers()
    const kill = makeKill(new Set([100]), { ignoreTerm: [100] })
    const done = stopProcessTree({
      pid: 100,
      exited: new Promise<void>(() => undefined),
      graceMs: 3000,
      settleMs: 1000,
      platform: 'darwin',
      listProcesses: async () => [],
      kill
    })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(done).resolves.toBeUndefined()
    expect(kill.calls).toEqual([
      [-100, 'SIGTERM'],
      [-100, 'SIGKILL']
    ])
  })

  it('シグナルが例外を投げても(EPERM)reject しない', async () => {
    const kill = vi.fn<KillFn>(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    await expect(
      stopProcessTree({
        pid: 100,
        exited: Promise.resolve(),
        platform: 'darwin',
        listProcesses: async () => table,
        kill
      })
    ).resolves.toBeUndefined()
    expect(kill.mock.calls).toEqual([
      [-100, 'SIGTERM'],
      [101, 0],
      [102, 0]
    ])
  })

  it('ps に失敗しても(空の一覧)グループの停止は行う', async () => {
    const kill = makeKill(new Set([100]))
    await stopProcessTree({
      pid: 100,
      exited: Promise.resolve(),
      platform: 'linux',
      listProcesses: async () => [],
      kill
    })
    expect(kill.calls).toEqual([[-100, 'SIGTERM']])
  })

  it('ps が打ち切り・失敗しても(既定の listProcesses)、グループへの SIGTERM → SIGKILL の段階は進む', async () => {
    vi.useFakeTimers()
    mockExecFileOnce(
      Object.assign(new Error('ps timed out'), { killed: true, signal: 'SIGTERM' }),
      ''
    )
    const kill = makeKill(new Set([100]), { ignoreTerm: [100] })
    const done = stopProcessTree({
      pid: 100,
      exited: new Promise<void>(() => undefined),
      graceMs: 3000,
      settleMs: 1000,
      platform: 'darwin',
      kill
    })
    await vi.advanceTimersByTimeAsync(4000)
    await expect(done).resolves.toBeUndefined()
    expect(kill.calls).toEqual([
      [-100, 'SIGTERM'],
      [-100, 'SIGKILL']
    ])
  })

  it('exited が reject しても停止は壊れず、終了とみなして解決する', async () => {
    vi.useFakeTimers()
    const kill = makeKill(new Set([100, 101]), { ignoreTerm: [100] })
    let rejectExited: (err: Error) => void = () => undefined
    const exited = new Promise<void>((_, reject) => (rejectExited = reject))
    let resolved = false
    const done = stopProcessTree({
      pid: 100,
      exited,
      graceMs: 3000,
      platform: 'darwin',
      listProcesses: async () => [],
      kill
    }).then(() => {
      resolved = true
    })
    await vi.advanceTimersByTimeAsync(0)
    rejectExited(new Error('pty の終了の取得に失敗'))
    await vi.advanceTimersByTimeAsync(0)
    expect(resolved).toBe(true)
    await done
    expect(kill.calls).toEqual([[-100, 'SIGTERM']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ps が 1・0・自分の pid・自分の ppid・安全でない整数を子孫として返しても、それらへは送らない', async () => {
    const unsafe = 2 ** 60
    const alive = new Set([100, 101, 1, 0, process.pid, process.ppid, unsafe])
    const kill = makeKill(alive)
    await stopProcessTree({
      pid: 100,
      exited: Promise.resolve(),
      platform: 'darwin',
      listProcesses: async () => [
        { pid: 100, ppid: 1 },
        { pid: 101, ppid: 100 },
        { pid: 1, ppid: 101 },
        { pid: 0, ppid: 101 },
        { pid: process.pid, ppid: 101 },
        { pid: process.ppid, ppid: 101 },
        { pid: unsafe, ppid: 101 }
      ],
      kill
    })
    expect(kill.calls).toEqual([
      [-100, 'SIGTERM'],
      [101, 0],
      [101, 'SIGKILL']
    ])
  })
})

describe('stopProcessTree(不正な pid)', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['負数', -5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['小数', 1.5],
    ['自分の pid', process.pid],
    ['自分の ppid', process.ppid]
  ])('pid が %s なら何も送らず、ps も pty の kill も taskkill も呼ばない', async (_label, pid) => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const kill = makeKill(new Set([pid]))
      const list = vi.fn(async (): Promise<ProcessEntry[]> => [{ pid: 101, ppid: pid }])
      const killPty = vi.fn()
      const spawnTaskkill = vi.fn()
      await stopProcessTree({
        pid,
        exited: Promise.resolve(),
        platform,
        listProcesses: list,
        kill,
        killPty,
        spawnTaskkill
      })
      expect(kill.calls).toEqual([])
      expect(list).not.toHaveBeenCalled()
      expect(killPty).not.toHaveBeenCalled()
      expect(spawnTaskkill).not.toHaveBeenCalled()
    }
  })
})

describe('isSignalablePid', () => {
  it('2 以上の安全な整数で、自分・親でないものだけを許す', () => {
    expect(isSignalablePid(2)).toBe(true)
    expect(isSignalablePid(100)).toBe(true)
    for (const pid of [
      0,
      1,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      2 ** 60,
      process.pid,
      process.ppid
    ]) {
      expect(isSignalablePid(pid)).toBe(false)
    }
  })
})

describe('listProcesses', () => {
  it('/bin/ps を打ち切りの時間つきで起動し、出力を解析する', async () => {
    mockExecFileOnce(null, '  100     1\n  101   100\n')
    await expect(listProcesses()).resolves.toEqual([
      { pid: 100, ppid: 1 },
      { pid: 101, ppid: 100 }
    ])
    expect(AGENT_PS_TIMEOUT_MS).toBe(2000)
    expect(mockExecFile).toHaveBeenCalledOnce()
    expect(mockExecFile.mock.calls[0].slice(0, 3)).toEqual([
      '/bin/ps',
      ['-A', '-o', 'pid=,ppid='],
      expect.objectContaining({ timeout: AGENT_PS_TIMEOUT_MS })
    ])
  })

  it('ps が失敗・打ち切られたら空', async () => {
    mockExecFileOnce(Object.assign(new Error('ps timed out'), { killed: true }), '  100 1\n')
    await expect(listProcesses()).resolves.toEqual([])
  })
})

describe('stopProcessTree(Windows)', () => {
  it('pty の kill() と taskkill を呼び、グループへのシグナルは送らない', async () => {
    const killPty = vi.fn()
    const spawnTaskkill = vi.fn()
    const kill = vi.fn<KillFn>()
    await stopProcessTree({
      pid: 55,
      exited: Promise.resolve(),
      platform: 'win32',
      killPty,
      spawnTaskkill,
      kill
    })
    expect(killPty).toHaveBeenCalledOnce()
    expect(spawnTaskkill).toHaveBeenCalledWith(55)
    expect(kill).not.toHaveBeenCalled()
  })

  it('pty の kill() が例外を投げても、taskkill は必ず起動し、例外を投げずに解決する', async () => {
    const killPty = vi.fn(() => {
      throw new Error('kill failed')
    })
    const spawnTaskkill = vi.fn()
    await expect(
      stopProcessTree({
        pid: 55,
        exited: Promise.resolve(),
        platform: 'win32',
        killPty,
        spawnTaskkill
      })
    ).resolves.toBeUndefined()
    expect(killPty).toHaveBeenCalledOnce()
    expect(spawnTaskkill).toHaveBeenCalledExactlyOnceWith(55)
  })

  it('spawnTaskkill・killPty を渡さなければ、taskkill /pid <pid> /T /F を窓を出さずに起動し、起動の失敗(error)は握りつぶす', async () => {
    const killer = new EventEmitter()
    mockSpawn.mockReturnValueOnce(killer)
    await expect(
      stopProcessTree({ pid: 77, exited: Promise.resolve(), platform: 'win32' })
    ).resolves.toBeUndefined()
    expect(mockSpawn).toHaveBeenCalledExactlyOnceWith('taskkill', ['/pid', '77', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
    // taskkill が無い環境などの起動の失敗は、error を聞いていないと未処理の例外になる
    expect(killer.listenerCount('error')).toBe(1)
    expect(() => killer.emit('error', new Error('spawn taskkill ENOENT'))).not.toThrow()
  })

  it('Windows でも、送ってよくない pid(0・1)なら taskkill を起動しない', async () => {
    for (const pid of [0, 1]) {
      await stopProcessTree({ pid, exited: Promise.resolve(), platform: 'win32' })
    }
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})
