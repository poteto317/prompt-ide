import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

// runBaselineGitWithInput の spawn と、同期の版 runBaselineGitWithInputSync の spawnSync の options を simple-git の経路
// (cwd・env・windowsHide: true)と揃えることを固定する(ローカルレビュー第 3 周の指摘 2。windowsHide が無いと Windows で
// console のウィンドウが一瞬開く)。同期の版は失敗を投げずに false を返すことも固定する。隠れた git の作成の runIsolatedGit の
// spawn(位置の変数を足さない環境・extraEnv・cwd)も同じモックで固定する
const spawnMock = vi.hoisted(() => vi.fn())
const spawnSyncMock = vi.hoisted(() => vi.fn())
// simple-git も node:child_process を読むため、spawn だけを差し替える
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    default: { ...actual, spawn: spawnMock, spawnSync: spawnSyncMock },
    spawn: spawnMock,
    spawnSync: spawnSyncMock
  }
})

import {
  runBaselineGitDetectingUnreadablePath,
  runBaselineGitWithInput,
  runBaselineGitWithInputSync,
  runIsolatedGit
} from '../agentBaselineGit'
import type { BaselineGitLocation } from '../agentBaselineGit'
import { isGitTimeoutError } from '../gitStepErrors'

const fakeProcess = (): EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: () => void
} => {
  const proc = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  })
  proc.stdin.on('finish', () => setImmediate(() => proc.emit('close', 0)))
  return proc
}

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => fakeProcess())
})

const LOCATION: BaselineGitLocation = { folderPath: '/repo', indexPath: '/tmp/index', gitDir: null }

describe('runBaselineGitWithInput の spawn', () => {
  it('cwd・記録のインデックスの環境・windowsHide: true で git を起動する', async () => {
    await runBaselineGitWithInput(LOCATION, ['update-index', '--stdin'], 'a\0', {
      env: { PATH: '/bin' }
    })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(command).toBe('git')
    expect(args).toEqual(['-c', 'core.splitIndex=false', 'update-index', '--stdin'])
    expect(options).toEqual({
      cwd: '/repo',
      env: { PATH: '/bin', GIT_INDEX_FILE: '/tmp/index' },
      windowsHide: true
    })
  })

  it('隠れた git の場所なら GIT_DIR・GIT_WORK_TREE も環境に置き、cwd は開いたフォルダ。-c で core.hooksPath・core.fsmonitor=false を常に付ける', async () => {
    await runBaselineGitWithInput(
      { folderPath: '/folder', indexPath: '/tmp/b/index', gitDir: '/tmp/b/git' },
      ['ls-files'],
      '',
      { env: { PATH: '/bin', GIT_DIR: '/elsewhere' } }
    )
    const [, args, options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(args).toEqual([
      '-c',
      'core.splitIndex=false',
      '-c',
      'core.hooksPath=/tmp/b/git/no-hooks',
      '-c',
      'core.fsmonitor=false',
      'ls-files'
    ])
    expect(options).toEqual({
      cwd: '/folder',
      env: {
        PATH: '/bin',
        GIT_INDEX_FILE: '/tmp/b/index',
        GIT_DIR: '/tmp/b/git',
        GIT_WORK_TREE: '/folder'
      },
      windowsHide: true
    })
  })
})

describe('runBaselineGitWithInputSync', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset()
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined })
  })

  it('cwd・記録のインデックスの環境・入力・打ち切り・windowsHide: true で同期で起動し、終了コード 0 なら true', () => {
    const ok = runBaselineGitWithInputSync(
      LOCATION,
      ['update-ref', '-z', '--stdin'],
      'delete r\0v\0',
      {
        env: { PATH: '/bin' },
        timeoutMs: 2000,
        config: ['core.hooksPath=/nohooks']
      }
    )
    expect(ok).toBe(true)
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'git',
      [
        '-c',
        'core.splitIndex=false',
        '-c',
        'core.hooksPath=/nohooks',
        'update-ref',
        '-z',
        '--stdin'
      ],
      expect.objectContaining({
        cwd: '/repo',
        env: { PATH: '/bin', GIT_INDEX_FILE: '/tmp/index' },
        input: 'delete r\0v\0',
        timeout: 2000,
        windowsHide: true
      })
    )
  })

  it('隠れた git の場所なら -c で core.hooksPath・core.fsmonitor=false を呼び出し側の設定の後に付ける', () => {
    runBaselineGitWithInputSync(
      { folderPath: '/folder', indexPath: '/tmp/b/index', gitDir: '/tmp/b/git' },
      ['update-index', '--stdin'],
      '',
      { env: { PATH: '/bin' }, config: ['core.quotePath=false'] }
    )
    expect(spawnSyncMock.mock.calls[0]?.[1]).toEqual([
      '-c',
      'core.splitIndex=false',
      '-c',
      'core.quotePath=false',
      '-c',
      'core.hooksPath=/tmp/b/git/no-hooks',
      '-c',
      'core.fsmonitor=false',
      'update-index',
      '--stdin'
    ])
  })

  it.each([
    ['終了コードが 0 でない', { status: 1, error: undefined }],
    ['打ち切り・起動の失敗(error がある)', { status: null, error: new Error('ETIMEDOUT') }]
  ])('%s なら false', (_label, result) => {
    spawnSyncMock.mockReturnValue(result)
    expect(runBaselineGitWithInputSync(LOCATION, ['x'], '')).toBe(false)
  })

  it('spawnSync が投げても false(アプリの終了の後始末を止めない)', () => {
    spawnSyncMock.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(runBaselineGitWithInputSync(LOCATION, ['x'], '')).toBe(false)
  })
})

describe('runIsolatedGit の spawn', () => {
  it('位置の変数を外し(足さず)、extraEnv だけを足して cwd で起動する', async () => {
    await runIsolatedGit('/tmp/rec', ['init', '--bare', '-q', '--template=', 'git'], {
      env: { PATH: '/bin', GIT_DIR: '/elsewhere', GIT_INDEX_FILE: '/x', EDITOR: 'vim' },
      extraEnv: { GIT_DIR: '/tmp/rec/git' }
    })
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(command).toBe('git')
    expect(args).toEqual([
      '-c',
      'core.splitIndex=false',
      'init',
      '--bare',
      '-q',
      '--template=',
      'git'
    ])
    expect(options).toEqual({
      cwd: '/tmp/rec',
      env: { PATH: '/bin', GIT_DIR: '/tmp/rec/git' },
      windowsHide: true
    })
  })
})

// 読めないフォルダの検出(ローカルレビュー第 33 周の指摘 1)。実 git での両方式の確かめは agentBaselineSnapshot.integration.test.ts
describe('runBaselineGitDetectingUnreadablePath', () => {
  // stderr に chunks を順に書いてから閉じる偽の git
  const stderrChunks = (chunks: readonly (string | Buffer)[]): void => {
    spawnMock.mockImplementation(() => {
      const proc = fakeProcess()
      proc.stdin.removeAllListeners('finish')
      proc.stdin.on('finish', () => {
        for (const chunk of chunks) proc.stderr.write(chunk)
        proc.stderr.end()
        proc.stderr.on('end', () => setImmediate(() => proc.emit('close', 0)))
        proc.stderr.resume()
      })
      return proc
    })
  }
  const run = (): ReturnType<typeof runBaselineGitDetectingUnreadablePath> =>
    runBaselineGitDetectingUnreadablePath(LOCATION, ['add', '-A'], {
      env: { PATH: '/bin', LC_ALL: 'fr_FR.UTF-8', language: 'fr', LANG: 'fr_FR.UTF-8' },
      config: ['advice.addEmbeddedRepo=false']
    })

  it('英語のメッセージの環境(LC_ALL をカテゴリへ移して LC_MESSAGES=C・LANGUAGE を外す)と記録のインデックスの環境で起動する', async () => {
    stderrChunks([])
    expect(await run()).toEqual({ stdout: '', unreadablePath: false })
    const [, args, options] = spawnMock.mock.calls[0] as [string, string[], object]
    expect(args).toEqual([
      '-c',
      'core.splitIndex=false',
      '-c',
      'advice.addEmbeddedRepo=false',
      'add',
      '-A'
    ])
    expect(options).toEqual({
      cwd: '/repo',
      env: {
        PATH: '/bin',
        LANG: 'fr_FR.UTF-8',
        LC_CTYPE: 'fr_FR.UTF-8',
        LC_COLLATE: 'fr_FR.UTF-8',
        LC_NUMERIC: 'fr_FR.UTF-8',
        LC_TIME: 'fr_FR.UTF-8',
        LC_MONETARY: 'fr_FR.UTF-8',
        LC_PAPER: 'fr_FR.UTF-8',
        LC_NAME: 'fr_FR.UTF-8',
        LC_ADDRESS: 'fr_FR.UTF-8',
        LC_TELEPHONE: 'fr_FR.UTF-8',
        LC_MEASUREMENT: 'fr_FR.UTF-8',
        LC_IDENTIFICATION: 'fr_FR.UTF-8',
        LC_MESSAGES: 'C',
        GIT_INDEX_FILE: '/tmp/index'
      },
      windowsHide: true
    })
  })

  it.each([
    ['1 行', ["warning: could not open directory 'sec/': Permission denied\n"]],
    [
      'チャンクの境目で分かれた行',
      ['warning: could not op', "en directory 'a/b/': Permission denied\n"]
    ],
    ['改行の無い最後の行', ["x\nwarning: could not open directory 'sec/': Permission denied"]],
    // 多バイト文字の途中で分かれても読める。前に 64KB を超える別の警告があっても見落とさない
    [
      '多バイト文字の途中で分かれ、前に多くの警告がある行',
      [
        "warning: in the working copy of 'x', LF will be replaced by CRLF\n".repeat(2_000),
        Buffer.from("warning: could not open directory '日"),
        Buffer.from("本/': Permission denied\n")
      ]
    ]
  ])('stderr の %s の警告を見分ける', async (_label, chunks) => {
    stderrChunks(chunks)
    expect((await run()).unreadablePath).toBe(true)
  })

  it('ほかの警告と、行の途中の同じ文言は読めないフォルダとしない', async () => {
    stderrChunks([
      "warning: in the working copy of 'x', LF will be replaced by CRLF\n",
      "error: 'warning: could not open directory 'q'\n"
    ])
    expect((await run()).unreadablePath).toBe(false)
  })

  // 記録の途中でフォルダが消えた(ENOENT)・フォルダでなくなった(ENOTDIR)ときも git は同じ警告を出す(git 2.50.1 で実測)。
  // 消えたフォルダは記録の時点に無いので、読めないフォルダとしない(ローカルレビュー第 34 周の指摘 1)
  it.each([
    ['ENOENT', ["warning: could not open directory 'race/': No such file or directory\n"]],
    ['ENOTDIR', ["warning: could not open directory 'race/': Not a directory\n"]],
    [
      'ENOENT(改行の無い最後の行)',
      ["warning: could not open directory 'race/': No such file or directory"]
    ],
    [
      'ENOENT(CRLF の行)',
      ["warning: could not open directory 'race/': No such file or directory\r\n"]
    ]
  ])('%s の警告は読めないフォルダとしない', async (_label, chunks) => {
    stderrChunks(chunks)
    expect((await run()).unreadablePath).toBe(false)
  })

  it.each([
    ['Permission denied', "warning: could not open directory 'sec/': Permission denied\n"],
    // ENOENT・ENOTDIR 以外の errno は今までどおり失敗にする(安全側)
    ['Too many open files', "warning: could not open directory 'a/': Too many open files\n"],
    // フォルダの名前が ENOENT の文言を含んでも、末尾の errno で判定する
    [
      '名前に ENOENT の文言を含む Permission denied',
      "warning: could not open directory 'No such file or directory/': Permission denied\n"
    ]
  ])('%s の警告は読めないフォルダとする', async (_label, line) => {
    stderrChunks([
      'x\n',
      line,
      "warning: could not open directory 'race/': No such file or directory\n"
    ])
    expect((await run()).unreadablePath).toBe(true)
  })

  // 読める(r)が実行(x)できないフォルダの中の追跡済みのファイルは、lstat が EACCES で失敗し、git が「<パス>: Permission denied」
  // (diff-lib の perror)だけを出して exit 0 で飛ばす(git 2.50.1・2.53.0 で実測。ローカルレビュー第 35 周の指摘 1)
  it.each([
    ['perror の Permission denied', ['x\nd/f: Permission denied\n']],
    ['perror の Operation not permitted', ['d/f: Operation not permitted\n']],
    ['CRLF の perror の行', ['d/f: Permission denied\r\n']],
    ['チャンクの境目で分かれた perror の行', ['d/f: Permission ', 'denied']]
  ])('stderr の %s を読めないパスとして見分ける', async (_label, chunks) => {
    stderrChunks(chunks)
    expect((await run()).unreadablePath).toBe(true)
  })

  // パスは行の途中か末尾に出るため、名前に文言を含むパスで誤って失敗にしない
  it('名前に Permission denied を含むパスの CRLF の警告・入れ子のリポジトリの警告と、消えたパスの perror は読めないパスとしない', async () => {
    stderrChunks([
      "warning: in the working copy of 'c: Permission denied', LF will be replaced by CRLF the next time Git touches it\n",
      'warning: adding embedded git repository: n: Permission denied\r\n',
      'd/f: No such file or directory\n',
      'd/f: Not a directory\n',
      'error: Permission denied: x\n'
    ])
    expect((await run()).unreadablePath).toBe(false)
  })

  // 見分けるのは、exit 0 のまま作業ツリーの中の読めないパスを飛ばす既知の 2 つの形(could not open directory の警告と、接頭辞の
  // 無い perror の相対パスの行)だけ。フォルダの外の大域の除外・属性のファイル(~/.config/git/ignore など)が読めないときの
  // 「warning: unable to access '<絶対パス>': Permission denied」(exit 0)で、どのフォルダでも記録が失敗していた(ローカルレビュー
  // 第 36 周の指摘 1)。フォルダの中の読めない .gitignore・.gitattributes の同じ警告も見ない(add -A が記録するものは続く
  // 「error: open(...)」で exit 128 になる。ignore されて記録しないものは exit 0 だが、その中の規則が効かないだけで、飛ばすパスは
  // 無い。git 2.50.1 で実測)。接頭辞の付いた行と、絶対パスの perror も見ない
  it.each([
    [
      '大域の除外のファイルの unable to access の警告',
      "warning: unable to access '/home/u/.config/git/ignore': Permission denied\n"
    ],
    [
      '大域の属性のファイルの unable to access の警告(CRLF)',
      "warning: unable to access 'C:/Users/u/.config/git/attributes': Permission denied\r\n"
    ],
    [
      'フォルダの中の .gitignore の unable to access の警告',
      "warning: unable to access 'd/.gitignore': Permission denied\n"
    ],
    ['error の接頭辞の付いた行', 'error: d/f: Permission denied\n'],
    ['fatal の接頭辞の付いた行', 'fatal: d/f: Operation not permitted\n'],
    ['hint の接頭辞の付いた行', 'hint: d/f: Permission denied\n'],
    ['絶対パスの perror', '/home/u/f: Permission denied\n'],
    ['Windows のドライブの絶対パスの perror', 'C:\\Users\\u\\f: Permission denied\n'],
    ['Windows のドライブの絶対パス(/ 区切り)の perror', 'C:/Users/u/f: Operation not permitted\n'],
    ['Windows の UNC パスの perror', '\\\\srv\\share\\f: Permission denied\n']
  ])('stderr の %s は読めないパスとしない', async (_label, line) => {
    stderrChunks(['x\n', line])
    expect((await run()).unreadablePath).toBe(false)
  })
})

// 打ち切りの規則(ローカルレビュー第 34 周の指摘 2)。記録の add -A は core.autocrlf=true で LF のファイルごとに警告を出すため、
// simple-git の timeout.block と同じく出力があるたびにタイマーをやり直す。runBaselineGitWithInput は経過した時間で打ち切る
describe('git の打ち切り', () => {
  // 閉じない偽の git(打ち切りまで動き続ける)
  const hangingProcess = (): ReturnType<typeof fakeProcess> => {
    const proc = fakeProcess()
    proc.stdin.removeAllListeners('finish')
    return proc
  }
  let proc: ReturnType<typeof fakeProcess>
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    proc = hangingProcess()
    spawnMock.mockImplementation(() => proc)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('読めないフォルダの検出の git は、出力が続く間は打ち切らず、出力が止まってから所定の時間で打ち切る', async () => {
    const result = runBaselineGitDetectingUnreadablePath(LOCATION, ['add', '-A'], {
      env: { PATH: '/bin' },
      timeoutMs: 1_000
    })
    const settledError = result.then(
      () => null,
      (error: unknown) => error
    )
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(800)
      proc.stderr.emit(
        'data',
        Buffer.from("warning: in the working copy of 'x', LF will be replaced by CRLF\n")
      )
    }
    await vi.advanceTimersByTimeAsync(800)
    proc.stdout.emit('data', Buffer.from('x'))
    await vi.advanceTimersByTimeAsync(999)
    expect(proc.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
    expect(isGitTimeoutError(await settledError)).toBe(true)
  })

  it('runBaselineGitWithInput は出力があっても起動からの経過した時間で打ち切る', async () => {
    const result = runBaselineGitWithInput(LOCATION, ['ls-files'], '', {
      env: { PATH: '/bin' },
      timeoutMs: 1_000
    })
    const settledError = result.then(
      () => null,
      (error: unknown) => error
    )
    await vi.advanceTimersByTimeAsync(800)
    proc.stderr.emit('data', Buffer.from('warning: x\n'))
    await vi.advanceTimersByTimeAsync(199)
    expect(proc.kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL')
    expect(isGitTimeoutError(await settledError)).toBe(true)
  })
})
