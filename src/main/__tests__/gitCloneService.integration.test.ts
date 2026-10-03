import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitAll,
  initRepo,
  runGit,
  stubGitCeiling,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'
import {
  createTestTimers,
  waitForFile,
  waitUntilDead,
  writeFakeExecutable
} from './helpers/processProbe'
import {
  CLONE_DESTINATION_EXISTS_MESSAGE,
  CLONE_FAILURE,
  CLONE_FOLDER_NAME_MESSAGES,
  CLONE_PARENT_NOT_FOUND_MESSAGE,
  CLONE_TIMEOUT_MESSAGE,
  cloneRepository
} from '../gitCloneService'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteUrlMessages'

// 実 fs と実 git(2.50.1)での cloneRepository の振る舞い(パターン 41): ローカルの bare リポジトリからの clone、
// 保存先の作成と削除(既存のフォルダ・ファイル・シンボリックリンクに触れないこと)、打ち切り・中止で git が起動した
// ssh(偽の ssh)とその子まで止まること。git を起動せずに拒否するケース(URL・フォルダ名・親フォルダの検証、
// 既に中止されている場合)も、実 fs で「保存先を作らない」「親フォルダの外に作らない」を確かめるためにここに置く。
// ネットワークには出ない(偽の ssh・閉じたポート)
const isWindows = process.platform === 'win32'

let work: string
let parent: string
let bare: string
const startedPids: number[] = []
// テストの待ち(delay)のタイマー。テストが途中で失敗しても残さない(CLAUDE.md のテスト規約)
const timers = createTestTimers()

// pid ファイルを待つ。書かれなければ、clone を中止して終わるのを待ってから投げる(実行中の git・偽の ssh を残さない)
async function waitForPid(
  path: string,
  running: Promise<unknown>,
  controller: AbortController
): Promise<number> {
  try {
    return Number(await waitForFile(path, timers))
  } catch (err) {
    controller.abort()
    await running.catch(() => undefined)
    throw err
  }
}

// 偽の ssh を core.sshCommand に設定したグローバル設定を使う(GIT_SSH_COMMAND はアプリが設定しないため使わない)。
// git は ssh の種類を調べるために `-G` 付きで一度起動するので、そのときはすぐ終える
function useFakeSsh(body: string): void {
  const sshPath = join(work, 'fake-ssh')
  writeFakeExecutable(sshPath, body, { exitImmediatelyOn: ['-G'] })
  const configPath = join(work, 'gitconfig')
  writeFileSync(configPath, `[core]\n\tsshCommand = ${sshPath}\n`)
  vi.stubEnv('GIT_CONFIG_GLOBAL', configPath)
}

// PATH の先頭に偽の git を置く(引数の確認・出力しない git・保存先の差し替え)。
// 打ち切りの時間は 3 秒にする: 打ち切りのタイマーは spawn の時点から数え、macOS は新しく作った実行ファイルの初回の
// 起動を検査するため、偽のスクリプトが動き出すまでに時間がかかる。無負荷では数百ミリ秒だが、vitest を同時に走らせる
// 負荷では 1 秒を超えることがあり、短いと pid を書く前に止められる(初回の検査は writeFakeExecutable の warm-up で計測の外へ出すが、負荷による
// 起動の遅れ自体は残るため、余裕を持たせる)
function useFakeGit(body: string): void {
  const binDir = join(work, 'bin')
  mkdirSync(binDir, { recursive: true })
  const gitPath = join(binDir, 'git')
  writeFakeExecutable(gitPath, body)
  vi.stubEnv('PATH', `${binDir}:${process.env.PATH ?? ''}`)
}

beforeEach(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'clone-service-')))
  stubIsolatedGitEnv()
  stubGitCeiling(work)
  const source = join(work, 'source')
  mkdirSync(source)
  initRepo(source)
  writeRepoFile(source, 'README.md', 'hello\n')
  commitAll(source, 'init')
  bare = join(work, 'remote.git')
  runGit(work, 'clone', '-q', '--bare', source, bare)
  parent = join(work, 'parent')
  mkdirSync(parent)
})

afterEach(() => {
  timers.clearAll()
  for (const pid of startedPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // 既に終わっている
    }
  }
  vi.unstubAllEnvs()
  rmSync(work, { recursive: true, force: true })
})

describe.skipIf(isWindows)('cloneRepository(実 git)', () => {
  it('絶対パスの bare リポジトリから clone し、保存先の実体のパスを返す', async () => {
    const result = await cloneRepository(bare, 'repo', parent, new AbortController().signal)
    const destination = join(parent, 'repo')
    expect(result).toEqual({ status: 'cloned', path: realpathSync(destination) })
    expect(readFileSync(join(destination, 'README.md'), 'utf8')).toBe('hello\n')
    expect(runGit(destination, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(runGit(destination, 'remote', 'get-url', 'origin').trim()).toBe(bare)
    // protocol の設定は git の -c で渡し、新しいリポジトリの設定には書き残さない(clone の -c は書き残す)
    expect(readFileSync(join(destination, '.git', 'config'), 'utf8')).not.toContain('protocol')
  })

  it('file:// の URL からも clone できる', async () => {
    const result = await cloneRepository(
      `file://${bare}`,
      'via-file',
      parent,
      new AbortController().signal
    )
    expect(result.status).toBe('cloned')
    expect(readFileSync(join(parent, 'via-file', 'README.md'), 'utf8')).toBe('hello\n')
  })

  it('URL の前後の空白は除く', async () => {
    const result = await cloneRepository(
      `  ${bare}\n`,
      'trimmed',
      parent,
      new AbortController().signal
    )
    expect(result.status).toBe('cloned')
  })

  // 既存のフォルダは上書きしない。空のフォルダでも拒否する(git clone 自身は空のフォルダへの clone を受け付ける)
  it.each([
    ['中身のあるフォルダ', true],
    ['空のフォルダ', false]
  ])('保存先に%sがあれば拒否し、そのフォルダには触れない', async (_label, withFile) => {
    const existing = join(parent, 'repo')
    mkdirSync(existing)
    if (withFile) writeFileSync(join(existing, 'keep.txt'), 'keep')
    await expect(
      cloneRepository(bare, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(CLONE_DESTINATION_EXISTS_MESSAGE)
    expect(existsSync(existing)).toBe(true)
    expect(readdirSync(existing)).toEqual(withFile ? ['keep.txt'] : [])
  })

  it('保存先に同名のファイルがあれば拒否する', async () => {
    writeFileSync(join(parent, 'repo'), 'file')
    await expect(
      cloneRepository(bare, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(CLONE_DESTINATION_EXISTS_MESSAGE)
    expect(readFileSync(join(parent, 'repo'), 'utf8')).toBe('file')
  })

  it.each([
    ['存在しない', () => join(work, 'missing')],
    ['ファイル', () => join(work, 'source', 'README.md')],
    ['相対パス', () => 'parent']
  ])('親フォルダが%sなら拒否する', async (_label, makeParent) => {
    await expect(
      cloneRepository(bare, 'repo', makeParent(), new AbortController().signal)
    ).rejects.toThrow(CLONE_PARENT_NOT_FOUND_MESSAGE)
  })

  it.each([
    ['', REMOTE_URL_RULE_MESSAGES.empty],
    ['ext::sh -c touch% /tmp/pwned', REMOTE_URL_RULE_MESSAGES['invalid-char']],
    ['fd::3', REMOTE_URL_RULE_MESSAGES.unsupported],
    ['--upload-pack=touch', REMOTE_URL_RULE_MESSAGES['leading-dash']],
    ['https://alice:secret@example.com/a.git', REMOTE_URL_RULE_MESSAGES.unsupported]
  ])('URL %j は git を呼ぶ前に拒否し、保存先を作らない', async (url, message) => {
    await expect(
      cloneRepository(url, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(message)
    expect(readdirSync(parent)).toEqual([])
  })

  it.each([
    ['', CLONE_FOLDER_NAME_MESSAGES.empty],
    ['a/b', CLONE_FOLDER_NAME_MESSAGES.invalid],
    ['..', CLONE_FOLDER_NAME_MESSAGES.invalid],
    ['../escape', CLONE_FOLDER_NAME_MESSAGES.invalid],
    [' repo', CLONE_FOLDER_NAME_MESSAGES.invalid]
  ])('フォルダ名 %j は拒否し、親フォルダの外にも作らない', async (name, message) => {
    await expect(cloneRepository(bare, name, parent, new AbortController().signal)).rejects.toThrow(
      message
    )
    expect(readdirSync(parent)).toEqual([])
    expect(existsSync(join(work, 'escape'))).toBe(false)
  })

  it('git の失敗は詳細を添えて投げ、作った保存先を削除する', async () => {
    const error = await cloneRepository(
      join(work, 'missing.git'),
      'repo',
      parent,
      new AbortController().signal
    ).catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message.startsWith(`${CLONE_FAILURE}: `)).toBe(true)
    expect((error as Error).message).toContain('missing.git')
    expect(readdirSync(parent)).toEqual([])
  })

  it('既に中止されていれば、保存先を作らずに canceled を返す', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await cloneRepository(bare, 'repo', parent, controller.signal)).toEqual({
      status: 'canceled'
    })
    expect(readdirSync(parent)).toEqual([])
  })

  it('git の前に protocol の設定を置き、clone の引数は -- の後ろに URL と保存先を渡す', async () => {
    const argsFile = join(work, 'args.txt')
    useFakeGit(`for a in "$@"; do printf '%s\\n' "$a"; done > '${argsFile}'\nexit 0`)
    await cloneRepository(bare, 'repo', parent, new AbortController().signal)
    expect(readFileSync(argsFile, 'utf8').trimEnd().split('\n')).toEqual([
      '-c',
      'protocol.ext.allow=never',
      '-c',
      'protocol.fd.allow=never',
      'clone',
      '--progress',
      '--',
      bare,
      join(parent, 'repo')
    ])
  })

  // scp 形式の user は検証を通る。ssh は接続先を `user@host: Permission denied` と出し、git はそのまま流す
  it.each([
    ['scp 形式', 'tok123@127.0.0.1:a/b.git', 'tok123'],
    ['ssh://', 'ssh://tok123@127.0.0.1/a/b.git', 'tok123']
  ])('%s の URL の失敗の文言では、ユーザー名を伏せる', async (_label, url, secret) => {
    useFakeSsh(`echo "${secret}@127.0.0.1: Permission denied (publickey)." >&2\nexit 255`)
    const error = await cloneRepository(url, 'repo', parent, new AbortController().signal).catch(
      (err: Error) => err
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message.startsWith(`${CLONE_FAILURE}: `)).toBe(true)
    expect((error as Error).message).toContain('***@127.0.0.1')
    expect((error as Error).message).not.toContain(secret)
    expect(readdirSync(parent)).toEqual([])
  })

  it('ssh が出力せずに待ち続けると打ち切り、ssh の子まで止めて保存先を削除する', async () => {
    const pidFile = join(work, 'ssh-sleep.pid')
    useFakeSsh(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
    const controller = new AbortController()
    const running = cloneRepository(
      'ssh://git@127.0.0.1/a/b.git',
      'repo',
      parent,
      controller.signal,
      {
        idleTimeoutMs: 3000
      }
    )
    // 下の rejects の確認より先に打ち切られても(pid を待つ間の失敗など)、Unhandled Rejection にしない
    void running.catch(() => undefined)
    const sleepPid = await waitForPid(pidFile, running, controller)
    startedPids.push(sleepPid)
    await expect(running).rejects.toThrow(CLONE_TIMEOUT_MESSAGE)
    expect(await waitUntilDead(sleepPid, timers)).toBe(true)
    expect(readdirSync(parent)).toEqual([])
  }, 15_000)

  it('中止すると ssh の子まで止め、保存先を削除して canceled を返す', async () => {
    const pidFile = join(work, 'ssh-sleep.pid')
    useFakeSsh(`sleep 30 &\necho $! > '${pidFile}'\nwait`)
    const controller = new AbortController()
    const running = cloneRepository('git@127.0.0.1:a/b.git', 'repo', parent, controller.signal)
    void running.catch(() => undefined)
    const sleepPid = await waitForPid(pidFile, running, controller)
    startedPids.push(sleepPid)
    controller.abort()
    expect(await running).toEqual({ status: 'canceled' })
    expect(await waitUntilDead(sleepPid, timers)).toBe(true)
    expect(readdirSync(parent)).toEqual([])
    // 既定の時間切れ(5 秒)では、pid を待つ上限(10 秒)より先にテストが切れて原因が読めなくなる
  }, 15_000)

  it('出力せず SIGTERM も無視する git は、SIGKILL で止めて保存先を削除する', async () => {
    const pidFile = join(work, 'git.pid')
    useFakeGit(`trap '' TERM INT\necho $$ > '${pidFile}'\nexec sleep 30`)
    const controller = new AbortController()
    const running = cloneRepository(bare, 'repo', parent, controller.signal, {
      idleTimeoutMs: 3000,
      killGraceMs: 200
    })
    void running.catch(() => undefined)
    const gitPid = await waitForPid(pidFile, running, controller)
    startedPids.push(gitPid)
    await expect(running).rejects.toThrow(CLONE_TIMEOUT_MESSAGE)
    expect(await waitUntilDead(gitPid, timers)).toBe(true)
    expect(readdirSync(parent)).toEqual([])
  }, 15_000)

  it('保存先が実行中にシンボリックリンクへ差し替えられていたら、リンク自体を消さない', async () => {
    const outside = join(work, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'precious.txt'), 'keep')
    // 引数の最後(保存先)を消して、外のフォルダへのリンクに差し替えてから失敗する
    useFakeGit(`for last; do :; done\nrmdir "$last"\nln -s '${outside}' "$last"\nexit 128`)
    await expect(
      cloneRepository(bare, 'repo', parent, new AbortController().signal)
    ).rejects.toThrow(CLONE_FAILURE)
    // 外のフォルダの中身が残ること(fs.rm はもともとリンクをたどらないため、この確認だけでは lstat の判定は守れない)
    expect(readFileSync(join(outside, 'precious.txt'), 'utf8')).toBe('keep')
    // lstat の判定が守るのは「自分が作ったものではない(リンクに差し替えられた)保存先を削除しない」こと
    expect(lstatSync(join(parent, 'repo')).isSymbolicLink()).toBe(true)
  })

  it('別のリポジトリの中の親フォルダにも clone できる(入れ子のリポジトリになる)', async () => {
    const outerRepo = join(work, 'outer')
    mkdirSync(outerRepo)
    initRepo(outerRepo)
    const result = await cloneRepository(bare, 'nested', outerRepo, new AbortController().signal)
    expect(result.status).toBe('cloned')
    expect(runGit(join(outerRepo, 'nested'), 'rev-parse', '--show-toplevel').trim()).toBe(
      realpathSync(join(outerRepo, 'nested'))
    )
  })
})
