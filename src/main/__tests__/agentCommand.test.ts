import { afterEach, describe, it, expect, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_COMMAND_NAME,
  buildAgentEnv,
  buildAgentLaunchArgs,
  findExecutableInPath,
  isExecutableRegularFile,
  resolveAgentLaunch
} from '../agentCommand'
import type { ExecutableProbe } from '../agentCommand'
import type { AgentLaunchRequest } from '@shared/types'

const probeOf = (executables: string[]): ExecutableProbe =>
  vi.fn<ExecutableProbe>(async (path) => executables.includes(path))

describe('findExecutableInPath', () => {
  it('PATH の先頭から探し、最初に見つかったものを返す', async () => {
    const isExecutable = probeOf(['/b/claude', '/c/claude'])
    await expect(
      findExecutableInPath('claude', '/a:/b:/c', { platform: 'darwin', isExecutable })
    ).resolves.toBe('/b/claude')
  })

  it('実行可能でないものは飛ばす', async () => {
    const isExecutable = probeOf(['/c/claude'])
    await expect(
      findExecutableInPath('claude', '/a:/b:/c', { platform: 'darwin', isExecutable })
    ).resolves.toBe('/c/claude')
    expect(isExecutable).toHaveBeenCalledWith('/a/claude')
    expect(isExecutable).toHaveBeenCalledWith('/b/claude')
  })

  it('空の要素(作業ディレクトリを意味する)は探さない', async () => {
    const isExecutable = probeOf(['claude'])
    await expect(
      findExecutableInPath('claude', ':/a::', { platform: 'darwin', isExecutable })
    ).resolves.toBeNull()
    expect(isExecutable).toHaveBeenCalledTimes(1)
    expect(isExecutable).toHaveBeenCalledWith('/a/claude')
  })

  it('見つからなければ null', async () => {
    await expect(
      findExecutableInPath('claude', '/a', { platform: 'linux', isExecutable: probeOf([]) })
    ).resolves.toBeNull()
  })

  it('Windows は ; で区切り、PATHEXT の拡張子を順に試す', async () => {
    const isExecutable = probeOf(['C:\\tools\\claude.CMD'])
    await expect(
      findExecutableInPath('claude', 'C:\\bin;C:\\tools', {
        platform: 'win32',
        pathExt: '.EXE;.CMD',
        isExecutable
      })
    ).resolves.toBe('C:\\tools\\claude.CMD')
    expect(isExecutable).toHaveBeenNthCalledWith(1, 'C:\\bin\\claude.EXE')
  })
})

describe('findExecutableInPath(相対ディレクトリ・PATHEXT)', () => {
  it('PATH の相対ディレクトリ(. や node_modules/.bin)は、実行ファイルがあっても採用しない', async () => {
    const isExecutable = probeOf(['./claude', 'claude', 'node_modules/.bin/claude', 'bin/claude'])
    await expect(
      findExecutableInPath('claude', 'bin:.:node_modules/.bin', {
        platform: 'darwin',
        isExecutable
      })
    ).resolves.toBeNull()
    expect(isExecutable).not.toHaveBeenCalled()
  })

  it('相対ディレクトリを飛ばして、後ろの絶対ディレクトリを採用する', async () => {
    const isExecutable = probeOf(['/a/claude'])
    await expect(
      findExecutableInPath('claude', '.:/a', { platform: 'linux', isExecutable })
    ).resolves.toBe('/a/claude')
  })

  it('Windows の相対ディレクトリ(.\\bin)は採用せず、ドライブ付きの絶対ディレクトリは採用する', async () => {
    const isExecutable = probeOf(['.\\bin\\claude.EXE', 'C:\\bin\\claude.EXE'])
    await expect(
      findExecutableInPath('claude', '.\\bin;C:\\bin', {
        platform: 'win32',
        pathExt: '.EXE',
        isExecutable
      })
    ).resolves.toBe('C:\\bin\\claude.EXE')
    expect(isExecutable).toHaveBeenCalledTimes(1)
  })

  it('pathExt が空文字なら既定の拡張子で探す', async () => {
    const isExecutable = probeOf(['C:\\bin\\claude.EXE'])
    await expect(
      findExecutableInPath('claude', 'C:\\bin', { platform: 'win32', pathExt: '', isExecutable })
    ).resolves.toBe('C:\\bin\\claude.EXE')
  })
})

describe('buildAgentEnv', () => {
  const base = {
    HOME: '/home/u',
    PATH: '/usr/bin',
    SHELL: '/bin/zsh',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    VSCODE_GIT_IPC_HANDLE: '/tmp/x',
    TERM_PROGRAM: 'vscode',
    TERM_PROGRAM_VERSION: '1.0',
    CLAUDECODE: '1',
    CLAUDE_PID: '9',
    CLAUDE_CODE_SESSION_ID: 's',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CODE_SESSION_ATTENDED: '1',
    CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/sock',
    CLAUDE_CODE_MESSAGING_TOKEN: 'tok',
    CLAUDE_CODE_SSE_PORT: '1234',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_EXECPATH: '/x',
    CLAUDE_CODE_USE_BEDROCK: '1',
    GIT_ASKPASS: '/askpass',
    UNDEFINED_VALUE: undefined
  }

  it('親の Claude Code・Electron・VS Code の変数を取り除く', () => {
    const env = buildAgentEnv(base, '/p')
    for (const key of [
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_RENDERER_URL',
      'VSCODE_GIT_IPC_HANDLE',
      'TERM_PROGRAM',
      'TERM_PROGRAM_VERSION',
      'CLAUDECODE',
      'CLAUDE_PID',
      'CLAUDE_CODE_SESSION_ID',
      'CLAUDE_CODE_CHILD_SESSION',
      'CLAUDE_CODE_SESSION_ATTENDED',
      'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN',
      'CLAUDE_CODE_SSE_PORT',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_EXECPATH'
    ]) {
      expect(env).not.toHaveProperty(key)
    }
  })

  it('利用者の設定の変数(CLAUDE_CODE_USE_BEDROCK・GIT_ASKPASS)は残す', () => {
    const env = buildAgentEnv(base, '/p')
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.GIT_ASKPASS).toBe('/askpass')
    expect(env.HOME).toBe('/home/u')
  })

  it('PATH・TERM・COLORTERM を設定し、undefined の値は写さない', () => {
    const env = buildAgentEnv(base, '/p:/q')
    expect(env.PATH).toBe('/p:/q')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env).not.toHaveProperty('UNDEFINED_VALUE')
  })

  it('LANG・LC_ALL・LC_CTYPE がどれも無ければ LANG=en_US.UTF-8 を足す', () => {
    expect(buildAgentEnv({}, '/p').LANG).toBe('en_US.UTF-8')
  })

  it.each([
    ['LANG', { LANG: 'ja_JP.UTF-8' }, 'ja_JP.UTF-8'],
    ['LC_ALL', { LC_ALL: 'C' }, undefined],
    ['LC_CTYPE', { LC_CTYPE: 'UTF-8' }, undefined]
  ])('%s があれば LANG を足さない', (_label, given, expectedLang) => {
    expect(buildAgentEnv(given, '/p').LANG).toBe(expectedLang)
  })

  it('win32 は大文字小文字を無視して Path を PATH に置き換え、除去キーも大文字小文字を無視する', () => {
    const env = buildAgentEnv(
      { Path: 'C:\\old', claudecode: '1', Electron_Foo: 'x', SystemRoot: 'C:\\Windows' },
      'C:\\new',
      'win32'
    )
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH'])
    expect(env.PATH).toBe('C:\\new')
    expect(env).not.toHaveProperty('claudecode')
    expect(env).not.toHaveProperty('Electron_Foo')
    expect(env.SystemRoot).toBe('C:\\Windows')
  })

  it('POSIX は Path と PATH を別の変数として扱う(大文字小文字を区別する)', () => {
    const env = buildAgentEnv({ Path: 'x', claudecode: '1' }, '/p', 'linux')
    expect(env.Path).toBe('x')
    expect(env.PATH).toBe('/p')
    expect(env.claudecode).toBe('1')
  })

  it('元の env を変えない', () => {
    const given = { ELECTRON_RUN_AS_NODE: '1', PATH: '/x' }
    buildAgentEnv(given, '/p')
    expect(given).toEqual({ ELECTRON_RUN_AS_NODE: '1', PATH: '/x' })
  })
})

describe('resolveAgentLaunch', () => {
  it('ログインシェルの PATH の後ろに既定の探索先を足して探し、引数は空で返す(セッションの指定は starter が足す)', async () => {
    const isExecutable = probeOf(['/home/u/.local/bin/claude'])
    const result = await resolveAgentLaunch({
      env: { HOME: '/home/u', PATH: '/usr/bin' },
      platform: 'darwin',
      readLoginShellPath: async () => '/nvm/bin:/usr/bin',
      isExecutable
    })
    expect(result).toEqual({
      kind: 'ok',
      plan: {
        file: '/home/u/.local/bin/claude',
        args: [],
        env: expect.objectContaining({
          PATH: '/nvm/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:/snap/bin:/home/u/.local/bin:/home/u/.cargo/bin'
        })
      }
    })
    expect(isExecutable).toHaveBeenNthCalledWith(1, `/nvm/bin/${AGENT_COMMAND_NAME}`)
  })

  it('ログインシェルの PATH が取れなければ main の PATH に倒し、見つからなければその旨を返す', async () => {
    const isExecutable = probeOf([])
    const result = await resolveAgentLaunch({
      env: { HOME: '/home/u', PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      readLoginShellPath: async () => null,
      isExecutable
    })
    expect(result).toEqual({ kind: 'not-found', shellPathUnavailable: true })
    expect(isExecutable).toHaveBeenNthCalledWith(1, '/usr/bin/claude')
  })

  it('ログインシェルの PATH が取れて見つからないときは shellPathUnavailable が false', async () => {
    const result = await resolveAgentLaunch({
      env: {},
      platform: 'linux',
      readLoginShellPath: async () => '/a',
      isExecutable: probeOf([])
    })
    expect(result).toEqual({ kind: 'not-found', shellPathUnavailable: false })
  })

  it('Windows は Path(大文字小文字違い)から探し、子の env に PATH を重複させない', async () => {
    const result = await resolveAgentLaunch({
      env: { Path: 'C:\\tools', PathExt: '.EXE' },
      platform: 'win32',
      readLoginShellPath: async () => null,
      isExecutable: probeOf(['C:\\tools\\claude.EXE'])
    })
    if (result.kind !== 'ok') throw new Error('not ok')
    expect(Object.keys(result.plan.env).filter((key) => key.toUpperCase() === 'PATH')).toEqual([
      'PATH'
    ])
    expect(result.plan.env.PATH).toBe('C:\\tools')
  })

  it('Windows はログインシェルを使わず PATH と PATHEXT で探す', async () => {
    const readLoginShellPath = vi.fn(async () => '/never')
    const result = await resolveAgentLaunch({
      env: { Path: 'C:\\tools', PATHEXT: '.EXE' },
      platform: 'win32',
      readLoginShellPath,
      isExecutable: probeOf(['C:\\tools\\claude.EXE'])
    })
    expect(result.kind).toBe('ok')
    expect(readLoginShellPath).not.toHaveBeenCalled()
  })
})

describe.skipIf(process.platform === 'win32')('isExecutableRegularFile(実 fs)', () => {
  let dir: string | null = null
  afterEach(async () => {
    if (dir !== null) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  const setup = async (): Promise<string> => {
    dir = await mkdtemp(join(tmpdir(), 'agent-command-'))
    return dir
  }

  it('実行可能なファイルとそのシンボリックリンクは true', async () => {
    const root = await setup()
    const file = join(root, 'tool')
    await writeFile(file, '#!/bin/sh\n')
    await chmod(file, 0o755)
    await symlink(file, join(root, 'link'))
    await expect(isExecutableRegularFile(file)).resolves.toBe(true)
    await expect(isExecutableRegularFile(join(root, 'link'))).resolves.toBe(true)
  })

  it('ディレクトリ・非実行ファイル・壊れたシンボリックリンク・存在しないパスは false', async () => {
    const root = await setup()
    const plain = join(root, 'plain')
    await writeFile(plain, 'x')
    await chmod(plain, 0o644)
    await mkdir(join(root, 'sub'), { mode: 0o755 })
    await symlink(join(root, 'missing'), join(root, 'broken'))
    await expect(isExecutableRegularFile(plain)).resolves.toBe(false)
    await expect(isExecutableRegularFile(join(root, 'sub'))).resolves.toBe(false)
    await expect(isExecutableRegularFile(join(root, 'broken'))).resolves.toBe(false)
    await expect(isExecutableRegularFile(join(root, 'nothing'))).resolves.toBe(false)
  })
})

describe('buildAgentLaunchArgs', () => {
  const ID = '11111111-1111-4111-8111-111111111111'
  it('new は --session-id、resume は --resume に、渡した ID をそのまま続ける', () => {
    expect(buildAgentLaunchArgs({ kind: 'new' }, ID)).toEqual(['--session-id', ID])
    expect(buildAgentLaunchArgs({ kind: 'resume', claudeSessionId: ID }, ID)).toEqual([
      '--resume',
      ID
    ])
  })

  it('未知の kind は既定の --session-id へ流さず投げる', () => {
    const unknownLaunch = { kind: 'fork', claudeSessionId: ID } as unknown as AgentLaunchRequest
    expect(() => buildAgentLaunchArgs(unknownLaunch, ID)).toThrow('未知の起動の指定です')
  })
})
