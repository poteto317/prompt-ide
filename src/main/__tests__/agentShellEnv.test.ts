import { describe, it, expect, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import {
  PATH_MARKER_END,
  PATH_MARKER_START,
  extractMarkedPath,
  readLoginShellPath,
  resolveLoginShell
} from '../agentShellEnv'
import type { ShellSpawn } from '../agentShellEnv'

// 偽の子プロセス(標準出力と close・error を手で起こす)
function makeFakeChild(pid = 4321): ChildProcess & { stdout: PassThrough } {
  const child = new EventEmitter() as ChildProcess & { stdout: PassThrough }
  Object.assign(child, { pid, stdout: new PassThrough() })
  return child
}

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveLoginShell', () => {
  it('SHELL を優先する', () => {
    expect(resolveLoginShell({ SHELL: '/bin/zsh' }, '/bin/bash')).toBe('/bin/zsh')
  })
  it('SHELL が無ければ利用者の既定のシェル', () => {
    expect(resolveLoginShell({}, '/bin/bash')).toBe('/bin/bash')
  })
  it('どちらも無ければ /bin/sh', () => {
    expect(resolveLoginShell({}, null)).toBe('/bin/sh')
    expect(resolveLoginShell({ SHELL: '' }, '')).toBe('/bin/sh')
  })
})

describe('extractMarkedPath', () => {
  it('印の間を取り出す(前後のシェルの初期化の出力は捨てる)', () => {
    expect(extractMarkedPath(`motd\n${PATH_MARKER_START}/a:/b${PATH_MARKER_END}\nbye`)).toBe(
      '/a:/b'
    )
  })
  it.each([
    ['印が無い', '/a:/b'],
    ['終わりの印が無い', `${PATH_MARKER_START}/a`],
    ['中身が空白だけ', `${PATH_MARKER_START}  ${PATH_MARKER_END}`]
  ])('%s なら null', (_label, output) => {
    expect(extractMarkedPath(output)).toBeNull()
  })
})

describe('readLoginShellPath', () => {
  it('ログインシェルを -l -i -c で、標準入力なし・新しいプロセスグループで起動し、印の間を返す', async () => {
    const child = makeFakeChild()
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const env = { SHELL: '/bin/zsh', HOME: '/home/x', PATH: '/usr/bin' }
    const kill = vi.fn()
    const promise = readLoginShellPath({ spawn, env, platform: 'darwin', kill })
    child.stdout.write(`noise${PATH_MARKER_START}/x/bin:/usr/bin${PATH_MARKER_END}`)
    child.emit('close', 0)
    await expect(promise).resolves.toBe('/x/bin:/usr/bin')
    const [command, args, options] = spawn.mock.calls[0]
    expect(command).toBe('/bin/zsh')
    expect(args.slice(0, 3)).toEqual(['-l', '-i', '-c'])
    expect(args[3]).toContain('"$PATH"')
    expect(options).toMatchObject({ stdio: ['ignore', 'pipe', 'ignore'], detached: true, env })
    // 呼び出し元の環境(process.env)ではなく、渡された環境を使う
    expect(options.env).not.toBe(process.env)
  })

  it('終了の印が出た時点で close を待たずに確定し、プロセスグループを止める(rc が常駐プロセスを残す場合)', async () => {
    const child = makeFakeChild(555)
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const kill = vi.fn()
    const promise = readLoginShellPath({
      spawn,
      env: {},
      platform: 'darwin',
      timeoutMs: 60_000,
      kill
    })
    // close は来ない
    child.stdout.write(`${PATH_MARKER_START}/y/bin${PATH_MARKER_END}`)
    await expect(promise).resolves.toBe('/y/bin')
    expect(kill).toHaveBeenCalledWith(-555, 'SIGKILL')
  })

  it('印が複数のチャンクに分かれても、終わりの印が揃った時点で確定する', async () => {
    const child = makeFakeChild(556)
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const promise = readLoginShellPath({
      spawn,
      env: {},
      platform: 'darwin',
      timeoutMs: 60_000,
      kill: vi.fn()
    })
    child.stdout.write(`${PATH_MARKER_START}/z`)
    child.stdout.write(`/bin${PATH_MARKER_END}`)
    await expect(promise).resolves.toBe('/z/bin')
  })

  it('起動に失敗したら(error)null', async () => {
    const child = makeFakeChild()
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const promise = readLoginShellPath({ spawn, env: {}, platform: 'darwin' })
    child.emit('error', new Error('ENOENT'))
    await expect(promise).resolves.toBeNull()
  })

  it('spawn が例外を投げたら null', async () => {
    const spawn = vi.fn<ShellSpawn>().mockImplementationOnce(() => {
      throw new Error('EAGAIN')
    })
    await expect(readLoginShellPath({ spawn, env: {}, platform: 'darwin' })).resolves.toBeNull()
  })

  it('打ち切りの時間を過ぎたらプロセスグループに SIGKILL を送って null', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild(777)
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const kill = vi.fn()
    const promise = readLoginShellPath({
      spawn,
      env: {},
      platform: 'darwin',
      timeoutMs: 5000,
      kill
    })
    await vi.advanceTimersByTimeAsync(4999)
    expect(kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toBeNull()
    expect(kill).toHaveBeenCalledWith(-777, 'SIGKILL')
  })

  it('打ち切りのシグナルが例外を投げても null で解決する(EPERM を握る)', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild(778)
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const kill = vi.fn(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    const promise = readLoginShellPath({ spawn, env: {}, platform: 'darwin', timeoutMs: 10, kill })
    await vi.advanceTimersByTimeAsync(10)
    await expect(promise).resolves.toBeNull()
  })

  it('close の後に打ち切りのタイマーを残さない', async () => {
    vi.useFakeTimers()
    const child = makeFakeChild()
    const spawn = vi.fn<ShellSpawn>().mockReturnValueOnce(child)
    const promise = readLoginShellPath({ spawn, env: {}, platform: 'darwin', kill: vi.fn() })
    child.emit('close', 0)
    await promise
    expect(vi.getTimerCount()).toBe(0)
  })

  it('Windows では起動せず null', async () => {
    const spawn = vi.fn<ShellSpawn>()
    await expect(readLoginShellPath({ spawn, platform: 'win32' })).resolves.toBeNull()
    expect(spawn).not.toHaveBeenCalled()
  })
})
