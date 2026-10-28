import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { removeTempPathSync } from '@shared/__tests__/helpers/tempDirGuard'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitCloneProcessOptions, GitCloneProcessResult } from '../gitCloneProcess'

// 子プロセスの結果ごとの扱い(成功・中止・打ち切り・起動失敗・終了コード)と、渡す引数を固定する。
// 子プロセスの実物の振る舞いは gitCloneService.integration.test.ts と gitCloneProcess.test.ts で確かめる
const mockRunGitCloneProcess = vi.hoisted(() =>
  vi.fn<(options: GitCloneProcessOptions) => Promise<GitCloneProcessResult>>()
)
vi.mock('../gitCloneProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../gitCloneProcess')>()),
  runGitCloneProcess: mockRunGitCloneProcess
}))

// 親フォルダの競合(確認と作成の間に消える・種類が変わる)や読み取りの失敗は、実 fs では再現しにくいため、
// 該当の呼び出しだけを差し替える。差し替えが無ければ実物を呼ぶ(各テストの後に戻す)
const fsOverrides = vi.hoisted(() => ({
  mkdir: null as null | (() => Promise<never>),
  realpath: null as null | (() => Promise<never>),
  stat: null as null | (() => Promise<never>)
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const wrapped = {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) =>
      fsOverrides.mkdir ? fsOverrides.mkdir() : actual.mkdir(...args),
    realpath: (...args: Parameters<typeof actual.realpath>) =>
      fsOverrides.realpath ? fsOverrides.realpath() : actual.realpath(...args),
    stat: (...args: Parameters<typeof actual.stat>) =>
      fsOverrides.stat ? fsOverrides.stat() : actual.stat(...args)
  }
  // 名前付きの import と default のどちらで参照されても差し替えが効くようにする
  return { ...wrapped, default: wrapped }
})

import { GIT_CLONE_IDLE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { CLONE_KILL_GRACE_MS } from '../gitCloneProcess'
import {
  CLONE_CANCELED_MESSAGE,
  CLONE_FAILURE,
  CLONE_FOLDER_NAME_MESSAGES,
  CLONE_PARENT_NOT_FOUND_MESSAGE,
  CLONE_TIMEOUT_MESSAGE,
  assertValidCloneRequest,
  cleanupFailedNote,
  cloneRepository,
  toCloneFailureDetail
} from '../gitCloneService'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteUrlMessages'

const isWindows = process.platform === 'win32'
let work: string
let parent: string

beforeEach(() => {
  // 持続する実装は使わない。各テストで mockImplementationOnce / mockResolvedValueOnce を設定する(パターン 103)
  mockRunGitCloneProcess.mockReset()
  fsOverrides.mkdir = fsOverrides.realpath = fsOverrides.stat = null
  work = realpathSync(mkdtempSync(join(tmpdir(), 'clone-unit-')))
  parent = join(work, 'parent')
  mkdirSync(parent)
})

afterEach(() => {
  if (existsSync(parent)) chmodSync(parent, 0o755)
  removeTempPathSync(work)
})

describe('cloneRepository(子プロセスの結果の扱い)', () => {
  it('既定の打ち切り・猶予と、親フォルダの実体を作業ディレクトリにして実行する', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'exited', code: 0, stderr: '' })
    const signal = new AbortController().signal
    const result = await cloneRepository('/abs/bare.git', 'repo', parent, signal)
    expect(result).toEqual({ status: 'cloned', path: join(parent, 'repo') })
    expect(mockRunGitCloneProcess).toHaveBeenCalledOnce()
    expect(mockRunGitCloneProcess.mock.calls[0][0]).toStrictEqual({
      args: [
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'protocol.fd.allow=never',
        'clone',
        '--progress',
        '--',
        '/abs/bare.git',
        join(parent, 'repo')
      ],
      cwd: parent,
      signal,
      idleTimeoutMs: GIT_CLONE_IDLE_TIMEOUT_MS,
      killGraceMs: CLONE_KILL_GRACE_MS
    })
  })

  it('git が終わった後でも、中止の要求が届いていれば保存先を削除して canceled', async () => {
    const controller = new AbortController()
    mockRunGitCloneProcess.mockImplementationOnce(async () => {
      controller.abort()
      return { kind: 'exited', code: 0, stderr: '' }
    })
    expect(await cloneRepository('/abs/bare.git', 'repo', parent, controller.signal)).toEqual({
      status: 'canceled'
    })
    expect(readdirSync(parent)).toEqual([])
  })

  it('既に中止されていれば、保存先を作らず git も起動しない', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await cloneRepository('/abs/bare.git', 'repo', parent, controller.signal)).toEqual({
      status: 'canceled'
    })
    expect(mockRunGitCloneProcess).not.toHaveBeenCalled()
    expect(readdirSync(parent)).toEqual([])
  })

  it('aborted は保存先を削除して canceled', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'aborted' })
    expect(
      await cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).toEqual({ status: 'canceled' })
    expect(readdirSync(parent)).toEqual([])
  })

  it('timed-out は保存先を削除して打ち切りの文言', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'timed-out' })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(CLONE_TIMEOUT_MESSAGE))
    expect(readdirSync(parent)).toEqual([])
  })

  it('起動できなければ、その理由を添えて失敗する', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({
      kind: 'spawn-failed',
      error: new Error('spawn git ENOENT')
    })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(`${CLONE_FAILURE}: spawn git ENOENT`))
    expect(readdirSync(parent)).toEqual([])
  })

  // 実物の runGitCloneProcess に、spawn が同期で投げる cwd(ファイル)を渡す(保存先を作った後に親がファイルへ差し替わる
  // 競合の再現。実 fs で競合そのものは作りにくいため、cwd だけを差し替える)。英語の errno を接頭辞無しで出さない
  it('spawn が同期で投げても、日本語の接頭辞つきの失敗にし、作った保存先を削除する', async () => {
    const actual = await vi.importActual<typeof import('../gitCloneProcess')>('../gitCloneProcess')
    const fileAsCwd = join(work, 'not-a-dir')
    writeFileSync(fileAsCwd, 'file')
    mockRunGitCloneProcess.mockImplementationOnce((options) =>
      actual.runGitCloneProcess({ ...options, cwd: fileAsCwd })
    )
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(`${CLONE_FAILURE}: spawn ENOTDIR`))
    expect(readdirSync(parent)).toEqual([])
  })

  it('終了コードが 0 以外なら、進捗を除いた標準エラーを伏せ字にして添える', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({
      kind: 'exited',
      code: 128,
      stderr:
        "Cloning into 'repo'...\nReceiving objects:  50% (1/2)\rReceiving objects: 100% (2/2), done.\n" +
        'git@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n'
    })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(
      new Error(
        `${CLONE_FAILURE}: Cloning into 'repo'...\n***@example.com: Permission denied (publickey).\nfatal: Could not read from remote repository.`
      )
    )
  })

  it('標準エラーが空なら接頭辞だけ', async () => {
    mockRunGitCloneProcess.mockResolvedValueOnce({ kind: 'exited', code: 1, stderr: '\n' })
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(CLONE_FAILURE))
  })

  // 親フォルダを書き込み禁止にすると、作った保存先を削除できない(root では書き込み禁止が効かないため除く)
  it.skipIf(isWindows || process.getuid?.() === 0)(
    '保存先を削除できなければ、そのパスを文言に添える',
    async () => {
      mockRunGitCloneProcess.mockImplementationOnce(async () => {
        chmodSync(parent, 0o555)
        return { kind: 'timed-out' }
      })
      await expect(
        cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
      ).rejects.toThrow(
        new Error(`${CLONE_TIMEOUT_MESSAGE}${cleanupFailedNote(join(parent, 'repo'))}`)
      )
    }
  )

  it.skipIf(isWindows || process.getuid?.() === 0)(
    '中止したが保存先を削除できなければ、中止の文言にそのパスを添えて失敗する',
    async () => {
      mockRunGitCloneProcess.mockImplementationOnce(async () => {
        chmodSync(parent, 0o555)
        return { kind: 'aborted' }
      })
      await expect(
        cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
      ).rejects.toThrow(
        new Error(`${CLONE_CANCELED_MESSAGE}${cleanupFailedNote(join(parent, 'repo'))}`)
      )
    }
  )

  it.skipIf(isWindows || process.getuid?.() === 0)(
    'git が失敗し、保存先も削除できなければ、失敗の詳細の後ろにそのパスを添える',
    async () => {
      mockRunGitCloneProcess.mockImplementationOnce(async () => {
        chmodSync(parent, 0o555)
        return { kind: 'exited', code: 128, stderr: 'fatal: boom\n' }
      })
      await expect(
        cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
      ).rejects.toThrow(
        new Error(`${CLONE_FAILURE}: fatal: boom${cleanupFailedNote(join(parent, 'repo'))}`)
      )
    }
  )

  it.skipIf(isWindows || process.getuid?.() === 0)(
    '親フォルダに書き込めなければ、詳細つきの失敗(見つからない、ではない)',
    async () => {
      chmodSync(parent, 0o555)
      const error = await cloneRepository(
        '/abs/bare.git',
        'repo',
        parent,
        new AbortController().signal
      ).catch((err: Error) => err)
      expect((error as Error).message.startsWith(`${CLONE_FAILURE}: `)).toBe(true)
      expect((error as Error).message).toContain('EACCES')
      expect(mockRunGitCloneProcess).not.toHaveBeenCalled()
    }
  )

  // 親フォルダの確認と保存先の作成の間に、親が消える(ENOENT)・ファイルに変わる(ENOTDIR)競合
  it.each(['ENOENT', 'ENOTDIR'])(
    '保存先の作成時に親フォルダが %s になっていたら、見つからない扱い',
    async (code) => {
      fsOverrides.mkdir = () => Promise.reject(Object.assign(new Error(code), { code }))
      await expect(
        cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
      ).rejects.toThrow(new Error(CLONE_PARENT_NOT_FOUND_MESSAGE))
      expect(mockRunGitCloneProcess).not.toHaveBeenCalled()
    }
  )

  it('親フォルダの実体の解決が「見つからない」以外で失敗したら、詳細つきの失敗', async () => {
    fsOverrides.realpath = () =>
      Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(`${CLONE_FAILURE}: EACCES: permission denied`))
  })

  it('親フォルダの確認の間に親が消えていたら、見つからない扱い', async () => {
    fsOverrides.stat = () =>
      Promise.reject(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }))
    await expect(
      cloneRepository('/abs/bare.git', 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(new Error(CLONE_PARENT_NOT_FOUND_MESSAGE))
  })
})

describe('toCloneFailureDetail', () => {
  it('進捗の行(\\r で上書きする行を含む)と空行を除き、行末の空白を落とす', () => {
    expect(
      toCloneFailureDetail(
        "Cloning into 'x'...\nremote: Counting objects:   3% (1/32)        \rremote: Counting objects: 100% (32/32), done.        \n\nfatal: bad  \n"
      )
    ).toBe("Cloning into 'x'...\nfatal: bad")
  })

  it('CRLF の改行もそろえる', () => {
    expect(toCloneFailureDetail('a\r\nb\r\n')).toBe('a\nb')
  })
})

describe('assertValidCloneRequest', () => {
  it('前後の空白を除いた URL を返す', () => {
    expect(assertValidCloneRequest('  https://github.com/a/b.git \n', 'b', false)).toBe(
      'https://github.com/a/b.git'
    )
  })

  it('URL を先に、フォルダ名を後に検証する', () => {
    expect(() => assertValidCloneRequest('', '', false)).toThrow(REMOTE_URL_RULE_MESSAGES.empty)
    expect(() => assertValidCloneRequest('/abs/bare.git', '', false)).toThrow(
      CLONE_FOLDER_NAME_MESSAGES.empty
    )
  })

  it('Windows のドライブの形は windowsPaths のときだけ通す', () => {
    expect(assertValidCloneRequest('C:/repos/bare.git', 'b', true)).toBe('C:/repos/bare.git')
    expect(() => assertValidCloneRequest('C:/repos/bare.git', 'b', false)).toThrow(
      REMOTE_URL_RULE_MESSAGES.unsupported
    )
  })
})
