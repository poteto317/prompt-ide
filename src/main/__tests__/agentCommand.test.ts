import { afterEach, describe, it, expect, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildAgentEnv,
  findExecutableInPath,
  isExecutableRegularFile,
  resolveAgentLaunch
} from '../agentCommand'
import type { ExecutableProbe } from '../agentCommand'

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
    const env = buildAgentEnv(base, '/p', 'darwin', [], {})
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
    const env = buildAgentEnv(base, '/p', 'darwin', [], {})
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(env.GIT_ASKPASS).toBe('/askpass')
    expect(env.HOME).toBe('/home/u')
  })

  it('PATH・TERM・COLORTERM を設定し、undefined の値は写さない', () => {
    const env = buildAgentEnv(base, '/p:/q', 'darwin', [], {})
    expect(env.PATH).toBe('/p:/q')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env).not.toHaveProperty('UNDEFINED_VALUE')
  })

  it('LANG・LC_ALL・LC_CTYPE がどれも無ければ LANG=en_US.UTF-8 を足す', () => {
    expect(buildAgentEnv({}, '/p', 'darwin', [], {}).LANG).toBe('en_US.UTF-8')
  })

  it.each([
    ['LANG', { LANG: 'ja_JP.UTF-8' }, 'ja_JP.UTF-8'],
    ['LC_ALL', { LC_ALL: 'C' }, undefined],
    ['LC_CTYPE', { LC_CTYPE: 'UTF-8' }, undefined]
  ])('%s があれば LANG を足さない', (_label, given, expectedLang) => {
    expect(buildAgentEnv(given, '/p', 'darwin', [], {}).LANG).toBe(expectedLang)
  })

  it('win32 は大文字小文字を無視して Path を PATH に置き換え、除去キーも大文字小文字を無視する', () => {
    const env = buildAgentEnv(
      { Path: 'C:\\old', claudecode: '1', Electron_Foo: 'x', SystemRoot: 'C:\\Windows' },
      'C:\\new',
      'win32',
      [],
      {}
    )
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH'])
    expect(env.PATH).toBe('C:\\new')
    expect(env).not.toHaveProperty('claudecode')
    expect(env).not.toHaveProperty('Electron_Foo')
    expect(env.SystemRoot).toBe('C:\\Windows')
  })

  it('POSIX は Path と PATH を別の変数として扱う(大文字小文字を区別する)', () => {
    const env = buildAgentEnv({ Path: 'x', claudecode: '1' }, '/p', 'linux', [], {})
    expect(env.Path).toBe('x')
    expect(env.PATH).toBe('/p')
    expect(env.claudecode).toBe('1')
  })

  it('元の env を変えない', () => {
    const given = { ELECTRON_RUN_AS_NODE: '1', PATH: '/x' }
    buildAgentEnv(given, '/p', 'darwin', [], {})
    expect(given).toEqual({ ELECTRON_RUN_AS_NODE: '1', PATH: '/x' })
  })
})

describe('buildAgentEnv(NO_PROXY)', () => {
  it('どちらも無ければ、NO_PROXY・no_proxy の両方に 127.0.0.1,localhost を入れる', () => {
    const env = buildAgentEnv({}, '/p', 'darwin', [], {})
    expect(env.NO_PROXY).toBe('127.0.0.1,localhost')
    expect(env.no_proxy).toBe('127.0.0.1,localhost')
  })

  it('NO_PROXY だけがあれば、既存の値を残して両方に同じ値を入れる', () => {
    const env = buildAgentEnv({ NO_PROXY: 'corp.example, .internal' }, '/p', 'linux', [], {})
    expect(env.NO_PROXY).toBe('corp.example,.internal,127.0.0.1,localhost')
    expect(env.no_proxy).toBe('corp.example,.internal,127.0.0.1,localhost')
  })

  it('no_proxy だけがあれば、NO_PROXY にも同じ値を入れる', () => {
    const env = buildAgentEnv({ no_proxy: 'corp.example' }, '/p', 'darwin', [], {})
    expect(env.NO_PROXY).toBe('corp.example,127.0.0.1,localhost')
    expect(env.no_proxy).toBe('corp.example,127.0.0.1,localhost')
  })

  it('両方が違う値なら、和集合(NO_PROXY の順 → no_proxy の順)を両方に入れ、重複を足さない', () => {
    const env = buildAgentEnv({ NO_PROXY: 'a,localhost', no_proxy: 'b,a' }, '/p', 'darwin', [], {})
    expect(env.NO_PROXY).toBe('a,localhost,b,127.0.0.1')
    expect(env.no_proxy).toBe('a,localhost,b,127.0.0.1')
  })

  it('既にあれば足さない', () => {
    expect(buildAgentEnv({ NO_PROXY: '127.0.0.1,localhost' }, '/p', 'linux', [], {}).NO_PROXY).toBe(
      '127.0.0.1,localhost'
    )
  })

  it('Windows は名前の大文字小文字を区別しないため、NO_PROXY 1 つにまとめる', () => {
    const env = buildAgentEnv({ no_proxy: 'corp.example' }, 'C:\\p', 'win32', [], {})
    expect(Object.keys(env).filter((key) => key.toUpperCase() === 'NO_PROXY')).toEqual(['NO_PROXY'])
    expect(env.NO_PROXY).toBe('corp.example,127.0.0.1,localhost')
  })

  it('元の env を変えない', () => {
    const given = { NO_PROXY: 'a' }
    buildAgentEnv(given, '/p', 'darwin', [], {})
    expect(given).toEqual({ NO_PROXY: 'a' })
  })
})

describe('resolveAgentLaunch', () => {
  it('ログインシェルの PATH の後ろに既定の探索先を足して探し、引数は空で返す(セッションの指定は starter が足す)', async () => {
    const isExecutable = probeOf(['/home/u/.local/bin/claude'])
    const result = await resolveAgentLaunch({
      env: { HOME: '/home/u', PATH: '/usr/bin' },
      platform: 'darwin',
      cliKind: 'claude',
      readLoginShellPath: async () => '/nvm/bin:/usr/bin',
      isExecutable
    })
    expect(result).toEqual({
      kind: 'ok',
      plan: {
        cliKind: 'claude',
        file: '/home/u/.local/bin/claude',
        args: [],
        env: expect.objectContaining({
          PATH: '/nvm/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:/snap/bin:/home/u/.local/bin:/home/u/.cargo/bin'
        })
      }
    })
    expect(isExecutable).toHaveBeenNthCalledWith(1, '/nvm/bin/claude')
  })

  it('ログインシェルの PATH が取れなければ main の PATH に倒し、見つからなければその旨を返す', async () => {
    const isExecutable = probeOf([])
    const result = await resolveAgentLaunch({
      env: { HOME: '/home/u', PATH: '/usr/bin:/bin' },
      platform: 'darwin',
      cliKind: 'claude',
      readLoginShellPath: async () => null,
      isExecutable
    })
    expect(result).toEqual({ kind: 'not-found', cliKind: 'claude', shellPathUnavailable: true })
    expect(isExecutable).toHaveBeenNthCalledWith(1, '/usr/bin/claude')
  })

  it('ログインシェルの PATH が取れて見つからないときは shellPathUnavailable が false', async () => {
    const result = await resolveAgentLaunch({
      env: {},
      platform: 'linux',
      cliKind: 'claude',
      readLoginShellPath: async () => '/a',
      isExecutable: probeOf([])
    })
    expect(result).toEqual({ kind: 'not-found', cliKind: 'claude', shellPathUnavailable: false })
  })

  it('Windows は Path(大文字小文字違い)から探し、子の env に PATH を重複させない', async () => {
    const result = await resolveAgentLaunch({
      env: { Path: 'C:\\tools', PathExt: '.EXE' },
      platform: 'win32',
      cliKind: 'claude',
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
      cliKind: 'claude',
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

describe('resolveAgentLaunch(CLI の種類)', () => {
  const deps = {
    env: { HOME: '/home/u', PATH: '/usr/bin' },
    platform: 'darwin' as const,
    readLoginShellPath: async (): Promise<string | null> => '/nvm/bin'
  }

  it('copilot は copilot を探し、計画に種類を載せる(引数は空)', async () => {
    const isExecutable = probeOf(['/nvm/bin/copilot'])
    await expect(
      resolveAgentLaunch({ ...deps, cliKind: 'copilot', isExecutable })
    ).resolves.toEqual({
      kind: 'ok',
      plan: { cliKind: 'copilot', file: '/nvm/bin/copilot', args: [], env: expect.any(Object) }
    })
    expect(isExecutable).toHaveBeenNthCalledWith(1, '/nvm/bin/copilot')
  })

  it('copilot だけがある PATH では、claude を選ぶと見つからない(結果に種類を載せる)', async () => {
    const isExecutable = probeOf(['/nvm/bin/copilot'])
    await expect(resolveAgentLaunch({ ...deps, cliKind: 'claude', isExecutable })).resolves.toEqual(
      {
        kind: 'not-found',
        cliKind: 'claude',
        shellPathUnavailable: false
      }
    )
  })

  it('copilot が見つからなければ、結果に copilot を載せる', async () => {
    await expect(
      resolveAgentLaunch({
        ...deps,
        cliKind: 'copilot',
        isExecutable: probeOf(['/nvm/bin/claude'])
      })
    ).resolves.toEqual({ kind: 'not-found', cliKind: 'copilot', shellPathUnavailable: false })
  })

  it('copilot の計画の環境変数だけから COPILOT_ALLOW_ALL を取り除く。共通の一覧はどちらでも取り除く', async () => {
    const env = { HOME: '/home/u', PATH: '/usr/bin', COPILOT_ALLOW_ALL: 'true', CLAUDECODE: '1' }
    const copilot = await resolveAgentLaunch({
      ...deps,
      env,
      cliKind: 'copilot',
      isExecutable: probeOf(['/nvm/bin/copilot'])
    })
    const claude = await resolveAgentLaunch({
      ...deps,
      env,
      cliKind: 'claude',
      isExecutable: probeOf(['/nvm/bin/claude'])
    })
    if (copilot.kind !== 'ok' || claude.kind !== 'ok') throw new Error('not ok')
    expect(copilot.plan.env).not.toHaveProperty('COPILOT_ALLOW_ALL')
    expect(claude.plan.env.COPILOT_ALLOW_ALL).toBe('true')
    expect(copilot.plan.env).not.toHaveProperty('CLAUDECODE')
    expect(claude.plan.env).not.toHaveProperty('CLAUDECODE')
  })

  it('copilot の計画の環境変数には COPILOT_DISABLE_RESUME_AUTO_CD=1 を足し(利用者の 0 を上書き)、claude の計画は利用者の値のまま', async () => {
    const env = { HOME: '/home/u', PATH: '/usr/bin', COPILOT_DISABLE_RESUME_AUTO_CD: '0' }
    const copilot = await resolveAgentLaunch({
      ...deps,
      env,
      cliKind: 'copilot',
      isExecutable: probeOf(['/nvm/bin/copilot'])
    })
    const claude = await resolveAgentLaunch({
      ...deps,
      env,
      cliKind: 'claude',
      isExecutable: probeOf(['/nvm/bin/claude'])
    })
    if (copilot.kind !== 'ok' || claude.kind !== 'ok') throw new Error('not ok')
    expect(copilot.plan.env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
    expect(claude.plan.env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('0')
    // 計画の引数は空のまま(会話の指定は starter が起動の表の buildArgs で足す)
    expect(copilot.plan.args).toEqual([])
  })
})

describe('buildAgentEnv(種類ごとの追加の除外)', () => {
  it('追加の除外は完全一致で取り除き、似た名前・認証の変数は残す', () => {
    const env = buildAgentEnv(
      {
        COPILOT_ALLOW_ALL: 'true',
        COPILOT_ALLOW_ALL_TOOLS: '1',
        COPILOT_HOME: '/h',
        COPILOT_GITHUB_TOKEN: 'c',
        GH_TOKEN: 'g',
        GITHUB_TOKEN: 't'
      },
      '/p',
      'darwin',
      ['COPILOT_ALLOW_ALL'],
      {}
    )
    expect(env).not.toHaveProperty('COPILOT_ALLOW_ALL')
    expect(env).toMatchObject({
      COPILOT_ALLOW_ALL_TOOLS: '1',
      COPILOT_HOME: '/h',
      COPILOT_GITHUB_TOKEN: 'c',
      GH_TOKEN: 'g',
      GITHUB_TOKEN: 't'
    })
  })

  it('win32 は追加の除外も大文字小文字を無視する', () => {
    const env = buildAgentEnv(
      { copilot_allow_all: 'true' },
      'C:\\p',
      'win32',
      ['COPILOT_ALLOW_ALL'],
      {}
    )
    expect(env).not.toHaveProperty('copilot_allow_all')
  })
})

describe('buildAgentEnv(種類ごとの足す環境変数。段階 3a)', () => {
  it('取り除く一覧を適用した後に足し、利用者の環境の同じ名前を上書きする', () => {
    const env = buildAgentEnv(
      { HOME: '/home/u', COPILOT_DISABLE_RESUME_AUTO_CD: '0' },
      '/p',
      'darwin',
      [],
      { COPILOT_DISABLE_RESUME_AUTO_CD: '1' }
    )
    expect(env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
    expect(env.HOME).toBe('/home/u')
    // 取り除く一覧に同じ名前があっても、足した値は残る(取り除いた後に足す)
    const removedThenAdded = buildAgentEnv(
      { COPILOT_DISABLE_RESUME_AUTO_CD: '0' },
      '/p',
      'darwin',
      ['COPILOT_DISABLE_RESUME_AUTO_CD'],
      { COPILOT_DISABLE_RESUME_AUTO_CD: '1' }
    )
    expect(removedThenAdded.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
  })

  it('win32 は大文字小文字だけ違う同じ名前を取り除いてから足す', () => {
    const env = buildAgentEnv({ copilot_disable_resume_auto_cd: '0' }, 'C:\\p', 'win32', [], {
      COPILOT_DISABLE_RESUME_AUTO_CD: '1'
    })
    expect(env).not.toHaveProperty('copilot_disable_resume_auto_cd')
    expect(env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
  })

  it('POSIX は大文字小文字の違う名前を別の変数として残す', () => {
    const env = buildAgentEnv({ copilot_disable_resume_auto_cd: '0' }, '/p', 'linux', [], {
      COPILOT_DISABLE_RESUME_AUTO_CD: '1'
    })
    expect(env.copilot_disable_resume_auto_cd).toBe('0')
    expect(env.COPILOT_DISABLE_RESUME_AUTO_CD).toBe('1')
  })

  it('PATH・TERM・COLORTERM は足す環境変数より後に設定する(表に同じ名前があっても上書きされる)', () => {
    const env = buildAgentEnv({}, '/p', 'darwin', [], {
      PATH: '/evil',
      TERM: 'dumb',
      COLORTERM: 'none'
    })
    expect(env.PATH).toBe('/p')
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })
})
