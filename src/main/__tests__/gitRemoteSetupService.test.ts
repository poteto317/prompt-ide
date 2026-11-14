import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// simple-git の GitError(git プロセスが失敗した)と、プラグイン(timeout 等)が投げるエラーのモック
const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
const MockGitPluginError = vi.hoisted(
  () =>
    class MockGitPluginError extends MockGitError {
      plugin?: string
      constructor(_task?: unknown, plugin?: string, message?: string) {
        super(message)
        this.plugin = plugin
      }
    }
)
// フォルダが存在しないとき、simpleGit() の生成そのものが投げる(英語の固定文言)
const MockGitConstructError = vi.hoisted(() => class MockGitConstructError extends MockGitError {})
const mockRaw = vi.hoisted(() => vi.fn())
const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => ({ raw: mockRaw, checkIsRepo: mockCheckIsRepo }))
)

vi.mock('simple-git', () => ({
  simpleGit: mockSimpleGit,
  GitError: MockGitError,
  GitPluginError: MockGitPluginError,
  GitConstructError: MockGitConstructError
}))

import { GIT_REMOTE_TIMEOUT_MS } from '@shared/remoteTimeout'
import { REMOTE_OPERATION_TIMEOUT_MESSAGE } from '../gitRemoteTimeout'
import {
  ADD_ORIGIN_TIMEOUT_MESSAGE,
  ALREADY_REPOSITORY_MESSAGE,
  FOLDER_NOT_FOUND_MESSAGE,
  INIT_TIMEOUT_MESSAGE,
  NOT_ON_BRANCH_FOR_PUSH_MESSAGE,
  NOT_REPOSITORY_MESSAGE,
  NO_COMMIT_FOR_PUSH_MESSAGE,
  NO_ORIGIN_FOR_PUSH_MESSAGE,
  ORIGIN_EXISTS_MESSAGE,
  REMOTE_SETUP_LOCAL_TIMEOUT_MS,
  UPSTREAM_CONFIG_EXISTS_MESSAGE,
  UPSTREAM_NOT_CONFIRMED_MESSAGE,
  addOrigin,
  initRepository,
  pushSetUpstream
} from '../gitRemoteSetupService'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteUrlMessages'

const HEAD_SHA = `${'a'.repeat(40)}\n`
const timeoutError = (): Error =>
  new MockGitPluginError(undefined, 'timeout', 'block timeout reached')

type RawOptions = {
  /** check-ref-format --branch の名前ごとの結果(省略時は入力の名前そのままを出力)。Error なら reject */
  checkRefFormat?: (name: string) => string | Error
  /** rev-parse --git-dir の結果(省略時は not a git repository で reject = リポジトリの外)。Error なら reject */
  gitDir?: string | Error
  init?: Error
  /** symbolic-ref -q HEAD の出力(省略時 refs/heads/main) */
  headRef?: string
  /** git remote の出力(省略時は空) */
  remotes?: string | Error
  remoteAdd?: Error
  /** config --get remote.origin.url の出力(省略時は remote add に渡した URL) */
  originUrl?: string
  /** rev-parse -q --verify HEAD の出力(省略時はコミットあり) */
  headCommit?: string
  /** for-each-ref --format=%(upstream:short) の出力(省略時は空=upstream なし) */
  upstream?: string
  push?: Error
  /** push の前の config --get branch.<b>.remote / merge の出力(省略時は空=設定なし) */
  existingBranchRemote?: string
  existingBranchMerge?: string
  /** push の後の config --get branch.<b>.remote / merge の出力(省略時は origin と headRef) */
  branchRemote?: string
  branchMerge?: string
}

const notRepositoryError = (): Error =>
  new MockGitError('fatal: not a git repository (or any of the parent directories): .git\n')

// 問い合わせを種類で振り分ける。出力の前提は一時ディレクトリの実 git 2.50.1・simple-git 3.36.0 で確認済み:
// - check-ref-format --branch は成功時に名前を出力し、不正な名前は GitError で reject する
// - symbolic-ref -q HEAD・rev-parse -q --verify HEAD・config --get は、無いと終了コード 1・stderr 空で、
//   simple-git は空文字で resolve する
const setupRaw = (o: RawOptions = {}): void => {
  const headRef = o.headRef ?? 'refs/heads/main\n'
  let addedUrl = ''
  let pushed = false
  mockRaw.mockImplementation(async (args: string[]) => {
    const [command] = args
    if (command === 'check-ref-format') {
      const result = o.checkRefFormat?.(args[2]) ?? `${args[2]}\n`
      if (result instanceof Error) throw result
      return result
    }
    if (command === 'init') {
      if (o.init !== undefined) throw o.init
      return 'Initialized empty Git repository\n'
    }
    if (command === 'symbolic-ref') return headRef
    if (command === 'remote' && args[1] === 'add') {
      if (o.remoteAdd !== undefined) throw o.remoteAdd
      addedUrl = args[4]
      return ''
    }
    if (command === 'remote') {
      if (o.remotes instanceof Error) throw o.remotes
      return o.remotes ?? ''
    }
    if (command === 'config' && args[2] === 'remote.origin.url') {
      return o.originUrl ?? `${addedUrl}\n`
    }
    if (command === 'config' && args[2].endsWith('.remote')) {
      return pushed ? (o.branchRemote ?? 'origin\n') : (o.existingBranchRemote ?? '')
    }
    if (command === 'config' && args[2].endsWith('.merge')) {
      return pushed ? (o.branchMerge ?? headRef) : (o.existingBranchMerge ?? '')
    }
    if (command === 'rev-parse' && args[1] === '--git-dir') {
      const result = o.gitDir ?? notRepositoryError()
      if (result instanceof Error) throw result
      return result
    }
    if (command === 'rev-parse') return o.headCommit ?? HEAD_SHA
    if (command === 'for-each-ref') return o.upstream ?? ''
    if (command === 'push') {
      if (o.push !== undefined) throw o.push
      pushed = true
      return ''
    }
    throw new Error(`unexpected raw: ${args.join(' ')}`)
  })
}

const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
const calledCommands = (): string[] => rawCalls().map((args) => args[0])

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckIsRepo.mockReset()
  mockRaw.mockReset()
})

describe('initRepository', () => {
  beforeEach(() => {
    mockCheckIsRepo.mockResolvedValue(false)
  })

  it('check-ref-format → checkIsRepo → rev-parse --git-dir → init → symbolic-ref の順に、名前を 1 引数で渡す', async () => {
    setupRaw()
    await initRepository('/project', 'main')
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--branch', 'main'],
      ['rev-parse', '--git-dir'],
      ['init', '--initial-branch=main'],
      ['symbolic-ref', '-q', 'HEAD']
    ])
    // checkIsRepo は check-ref-format の後、init の前
    const checkOrder = mockCheckIsRepo.mock.invocationCallOrder[0]
    expect(checkOrder).toBeGreaterThan(mockRaw.mock.invocationCallOrder[0])
    expect(checkOrder).toBeLessThan(mockRaw.mock.invocationCallOrder[1])
  })

  // 作成中のダイアログは閉じられないため、最長の待ち時間を保証する(パターン 84・85)
  it('simple-git は 30 秒の打ち切りで作り、timeoutMs で差し替えられる', async () => {
    setupRaw()
    expect(REMOTE_SETUP_LOCAL_TIMEOUT_MS).toBe(30_000)
    await initRepository('/project', 'main')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: REMOTE_SETUP_LOCAL_TIMEOUT_MS },
      allowEnvironment: expect.any(Array)
    })
    await initRepository('/project', 'main', 500)
    expect(mockSimpleGit).toHaveBeenLastCalledWith('/project', {
      timeout: { block: 500 },
      allowEnvironment: expect.any(Array)
    })
  })

  // 入口で 1 回だけ正規化し、以後の検証・init・確認・文言はその名前を使う(パターン 83)
  it('前後の空白を除き NFC にそろえた名前で検証・初期化・確認する', async () => {
    setupRaw({ headRef: 'refs/heads/caf\u00e9\n' })
    await initRepository('/project', '  cafe\u0301 ')
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--branch', 'caf\u00e9'],
      ['rev-parse', '--git-dir'],
      ['init', '--initial-branch=caf\u00e9'],
      ['symbolic-ref', '-q', 'HEAD']
    ])
  })

  it("'-' で始まる名前は git を呼ばずに拒否する", async () => {
    setupRaw()
    await expect(initRepository('/project', '-x')).rejects.toThrow(
      '`-` で始まるブランチ名は使用できません: -x'
    )
    expect(mockRaw).not.toHaveBeenCalled()
    expect(mockCheckIsRepo).not.toHaveBeenCalled()
  })

  it.each(['', '   ', '@'])('%j は git を呼ばずに拒否する', async (name) => {
    setupRaw()
    await expect(initRepository('/project', name)).rejects.toThrow(
      `ブランチ名として使用できない名前です: ${name.trim()}`
    )
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // git init は HEAD・refs/heads/foo などを通し、a..b などは失敗しても .git を残す(実機で確認)。git に任せない
  it.each([
    ['reject', new MockGitError("fatal: 'HEAD' is not a valid branch name")],
    ['出力が入力と違う', 'main\n']
  ])(
    'check-ref-format が %s なら拒否し、checkIsRepo にも init にも進まない',
    async (_label, result) => {
      setupRaw({ checkRefFormat: (name) => (name === 'HEAD' ? result : `${name}\n`) })
      await expect(initRepository('/project', 'HEAD')).rejects.toThrow(
        'ブランチ名として使用できない名前です: HEAD'
      )
      expect(mockCheckIsRepo).not.toHaveBeenCalled()
      expect(calledCommands()).not.toContain('init')
    }
  )

  // 壊れた .git ファイルがあると check-ref-format --branch はどの名前でも失敗する(実機で確認。差分 1)。
  // 名前の誤りと見せず、git がこのフォルダで動かないことを初期化の失敗として伝える
  it('check-ref-format が名前と関係なく失敗するなら、初期化の失敗にする', async () => {
    setupRaw({ checkRefFormat: () => new MockGitError('fatal: not a git repository: /x\n') })
    await expect(initRepository('/project', 'feat')).rejects.toThrow(
      'リポジトリを初期化できませんでした: fatal: not a git repository: /x'
    )
    expect(rawCalls()).toEqual([
      ['check-ref-format', '--branch', 'feat'],
      ['check-ref-format', '--branch', 'main']
    ])
    expect(mockCheckIsRepo).not.toHaveBeenCalled()
  })

  // 既存のリポジトリに git init すると終了コード 0 で再初期化され、--initial-branch は無視される(実機で確認)
  it('既にリポジトリ(親を含む)なら拒否し、init しない', async () => {
    setupRaw()
    mockCheckIsRepo.mockResolvedValue(true)
    await expect(initRepository('/project', 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
    expect(calledCommands()).not.toContain('init')
  })

  // bare リポジトリと .git ディレクトリ(とその中)では、checkIsRepo(--is-inside-work-tree)は false だが、
  // rev-parse --git-dir は成功する(実機で確認)。git init すると中に .git が作られてしまう
  it.each(['.', '/repo/.git'])(
    'checkIsRepo が偽でも rev-parse --git-dir が成功(%s)すれば拒否し、init しない',
    async (gitDir) => {
      setupRaw({ gitDir: `${gitDir}\n` })
      await expect(initRepository('/project', 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(calledCommands()).not.toContain('init')
    }
  )

  // checkIsRepo が偽で resolve した直後の rev-parse --git-dir の reject は、リポジトリの外(not a git repository・
  // 終了コード 128)。文言では分岐しない(パターン 18)。打ち切りだけは区別し、init に進まない
  it('rev-parse --git-dir の打ち切りは時間切れの文言にし、init しない', async () => {
    setupRaw({ gitDir: timeoutError() })
    await expect(initRepository('/project', 'main')).rejects.toThrow(INIT_TIMEOUT_MESSAGE)
    expect(calledCommands()).not.toContain('init')
  })

  it('rev-parse --git-dir の打ち切り以外の reject は、リポジトリの外として初期化する', async () => {
    setupRaw({ gitDir: new MockGitError('fatal: something else\n') })
    await initRepository('/project', 'main')
    expect(calledCommands()).toContain('init')
  })

  it('checkIsRepo が真なら rev-parse --git-dir を呼ばない', async () => {
    setupRaw({ gitDir: '.\n' })
    mockCheckIsRepo.mockResolvedValue(true)
    await expect(initRepository('/project', 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
    expect(rawCalls()).toEqual([['check-ref-format', '--branch', 'main']])
  })

  it('checkIsRepo の reject(dubious ownership など)は初期化の失敗にし、init しない', async () => {
    setupRaw()
    mockCheckIsRepo.mockRejectedValue(new MockGitError('fatal: detected dubious ownership\n'))
    await expect(initRepository('/project', 'main')).rejects.toThrow(
      'リポジトリを初期化できませんでした: fatal: detected dubious ownership'
    )
    expect(calledCommands()).not.toContain('init')
  })

  it('init の失敗は git のメッセージを添える', async () => {
    setupRaw({ init: new MockGitError('fatal: cannot mkdir .git: Permission denied\n') })
    await expect(initRepository('/project', 'main')).rejects.toThrow(
      'リポジトリを初期化できませんでした: fatal: cannot mkdir .git: Permission denied'
    )
  })

  it('init の打ち切りは時間切れの文言にする', async () => {
    setupRaw({ init: timeoutError() })
    await expect(initRepository('/project', 'main')).rejects.toThrow(INIT_TIMEOUT_MESSAGE)
  })

  it('checkIsRepo の打ち切りも時間切れの文言にする', async () => {
    setupRaw()
    mockCheckIsRepo.mockRejectedValue(timeoutError())
    await expect(initRepository('/project', 'main')).rejects.toThrow(INIT_TIMEOUT_MESSAGE)
  })

  // 終了コード 0 は効果があったことを意味しない(パターン 69)
  it('init の後に HEAD が refs/heads/<name> でなければ失敗にする', async () => {
    setupRaw({ headRef: 'refs/heads/master\n' })
    await expect(initRepository('/project', 'main')).rejects.toThrow(
      /^リポジトリを初期化できませんでした$/
    )
  })
})

describe('addOrigin', () => {
  beforeEach(() => {
    mockCheckIsRepo.mockResolvedValue(true)
  })

  it('checkIsRepo → git remote → remote add -- origin <url> → config --get の順に、前後の空白を除いた URL で呼ぶ', async () => {
    setupRaw()
    await addOrigin('/project', '  https://github.com/a/b.git \n')
    expect(rawCalls()).toEqual([
      ['remote'],
      ['remote', 'add', '--', 'origin', 'https://github.com/a/b.git'],
      ['config', '--get', 'remote.origin.url']
    ])
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: REMOTE_SETUP_LOCAL_TIMEOUT_MS },
      allowEnvironment: expect.any(Array)
    })
  })

  it.each([
    ['empty', '   ', 'URL を入力してください'],
    ['too-long', `https://h/${'a'.repeat(2039)}`, 'URL が長すぎます（2048 文字まで）'],
    [
      'invalid-char',
      'https://h/a b',
      'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'
    ],
    [
      'invalid-char',
      "https://u:p'ss@h/r",
      'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'
    ],
    // 引用符を含むローカルのパスも拒否する(既知の制約)。文言で引用符が理由だと分かる(3 周目のレビュー)
    [
      'invalid-char',
      "/repos/O'Brien/b.git",
      'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'
    ],
    ['leading-dash', '--upload-pack=x', '`-` で始まる URL は使用できません'],
    [
      'unsupported',
      'ext::sh',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // authority の `@` は 1 個まで(パスワードの `@` は %40 と書く。3 周目のレビュー)
    [
      'unsupported',
      'ssh://u:p@ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // ssh:// の userinfo の %2F は git が `/` に戻して ssh に渡し、資格情報の前半がホスト名として出る(4 周目のレビュー)
    [
      'unsupported',
      'ssh://alice:s3cr%2Fet@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // userinfo に生の `/` があると authority が `user:pa` で切れ、git は失敗の文言に `user:pa` を出す。port は数字だけ
    // (5 周目のレビュー)
    [
      'unsupported',
      'https://user:pa/ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // パスワード入りの URL は構造的に拒否する(利用者の決定。認証は credential helper に任せる)
    [
      'unsupported',
      'https://alice:ghp_TOKEN@github.com/a/b.git',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    [
      'unsupported',
      'ssh://u:pw@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // userinfo に生の `/` を含み、パスワードが数字で始まる形(authority が `alice:1234` に切れる。6 周目のレビュー)
    [
      'unsupported',
      'https://alice:1234/s3cret@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ]
  ])('規則の違反(%s)は git を呼ばずに拒否する', async (kind, url, message) => {
    setupRaw()
    await expect(addOrigin('/project', url)).rejects.toThrow(message)
    expect(REMOTE_URL_RULE_MESSAGES[kind as keyof typeof REMOTE_URL_RULE_MESSAGES]).toBe(message)
    expect(mockSimpleGit).not.toHaveBeenCalled()
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // URL に資格情報(https://user:token@host/...)が入っていても、画面に出さない
  it('エラーの文言に URL を含めない', async () => {
    setupRaw()
    const err = await addOrigin('/project', 'https://user:secret@h/a b').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(REMOTE_URL_RULE_MESSAGES['invalid-char'])
    expect((err as Error).message).not.toContain('secret')
  })

  describe('Windows のドライブの形', () => {
    const originalPlatform = process.platform
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('windowsPaths が偽なら拒否し、真なら追加する', async () => {
      setupRaw()
      await expect(addOrigin('/project', 'C:/repos/a.git', undefined, false)).rejects.toThrow(
        REMOTE_URL_RULE_MESSAGES.unsupported
      )
      await addOrigin('/project', 'C:/repos/a.git', undefined, true)
      expect(rawCalls()).toContainEqual(['remote', 'add', '--', 'origin', 'C:/repos/a.git'])
    })

    it('windowsPaths の既定は process.platform === win32', async () => {
      setupRaw()
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      await expect(addOrigin('/project', 'C:/repos/a.git')).rejects.toThrow(
        REMOTE_URL_RULE_MESSAGES.unsupported
      )
      Object.defineProperty(process, 'platform', { value: 'win32' })
      await expect(addOrigin('/project', 'C:/repos/a.git')).resolves.toBeUndefined()
    })
  })

  it('リポジトリでなければ拒否し、git remote を呼ばない', async () => {
    setupRaw()
    mockCheckIsRepo.mockResolvedValue(false)
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(NOT_REPOSITORY_MESSAGE)
    expect(mockRaw).not.toHaveBeenCalled()
  })

  // git remote add は already exists の英語で失敗する。先に日本語で弾く
  it('origin が既にあれば拒否し、remote add しない', async () => {
    setupRaw({ remotes: 'upstream\r\norigin\r\n' })
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(ORIGIN_EXISTS_MESSAGE)
    expect(rawCalls()).toEqual([['remote']])
  })

  it.each([
    ['git remote', { remotes: new MockGitError('fatal: bad config line 3\n') }],
    ['remote add', { remoteAdd: new MockGitError('error: could not lock config file\n') }]
  ] as Array<[string, RawOptions]>)(
    '%s の失敗は git のメッセージを添えた追加の失敗にする',
    async (_label, o) => {
      setupRaw(o)
      await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(
        /^リモートを追加できませんでした: (fatal: bad config line 3|error: could not lock config file)$/
      )
    }
  )

  it('remote add の打ち切りは時間切れの文言にする', async () => {
    setupRaw({ remoteAdd: timeoutError() })
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(
      ADD_ORIGIN_TIMEOUT_MESSAGE
    )
  })

  it('追加の後に remote.origin.url が入力と違えば失敗にする', async () => {
    setupRaw({ originUrl: 'https://other/a.git\n' })
    await expect(addOrigin('/project', 'https://h/a.git')).rejects.toThrow(
      /^リモートを追加できませんでした$/
    )
  })
})

describe('pushSetUpstream', () => {
  beforeEach(() => {
    mockCheckIsRepo.mockResolvedValue(true)
  })

  it('検証の後、完全な refspec で push -u し、branch.<b>.remote / merge を確かめる', async () => {
    setupRaw({ remotes: 'origin\n', headRef: 'refs/heads/feat/x\n' })
    await pushSetUpstream('/project')
    expect(rawCalls()).toEqual([
      ['remote'],
      ['symbolic-ref', '-q', 'HEAD'],
      ['rev-parse', '-q', '--verify', 'HEAD'],
      ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feat/x'],
      ['config', '--get', 'branch.feat/x.remote'],
      ['config', '--get', 'branch.feat/x.merge'],
      ['push', '--set-upstream', 'origin', 'refs/heads/feat/x:refs/heads/feat/x'],
      ['config', '--get', 'branch.feat/x.remote'],
      ['config', '--get', 'branch.feat/x.merge']
    ])
  })

  // progress プラグインが末尾に --progress を足すため、`--` を使うと refspec として扱われて失敗する(実機で確認)
  it('push の引数に `--` を使わない', async () => {
    setupRaw({ remotes: 'origin\n' })
    await pushSetUpstream('/project')
    const pushArgs = rawCalls().find((args) => args[0] === 'push')
    expect(pushArgs).not.toContain('--')
  })

  it('simple-git は push と同じ打ち切り(30 秒・progress あり)で作り、timeoutMs で差し替えられる', async () => {
    setupRaw({ remotes: 'origin\n' })
    await pushSetUpstream('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function),
      allowEnvironment: expect.any(Array)
    })
    // 1 回目の push の後は、モックの branch.<b>.remote が設定済みになるため作り直す
    setupRaw({ remotes: 'origin\n' })
    await pushSetUpstream('/project', 500)
    expect(mockSimpleGit).toHaveBeenLastCalledWith('/project', {
      timeout: { block: 500 },
      progress: expect.any(Function),
      allowEnvironment: expect.any(Array)
    })
  })

  it.each([
    ['リポジトリでない', {}, NOT_REPOSITORY_MESSAGE, false],
    ['origin が無い', { remotes: 'upstream\n' }, NO_ORIGIN_FOR_PUSH_MESSAGE, true],
    [
      'ブランチ上にいない(detached・リベース中)',
      { remotes: 'origin\n', headRef: '' },
      NOT_ON_BRANCH_FOR_PUSH_MESSAGE,
      true
    ],
    ['コミットが無い', { remotes: 'origin\n', headCommit: '' }, NO_COMMIT_FOR_PUSH_MESSAGE, true],
    [
      'upstream が既にある',
      { remotes: 'origin\n', upstream: 'origin/main\n' },
      'upstream は既に設定されています: origin/main',
      true
    ],
    // %(upstream:short) は、削除済みの remote や fetch の refspec の無い remote を指す upstream を空にする
    // (実機で確認)。-u はその branch.<b>.remote / merge を黙って上書きする(パターン 45)
    [
      'branch.<b>.remote だけが設定済み(upstream は表示されない)',
      { remotes: 'origin\n', existingBranchRemote: 'ghost\n' },
      UPSTREAM_CONFIG_EXISTS_MESSAGE,
      true
    ],
    [
      'branch.<b>.merge だけが設定済み(upstream は表示されない)',
      { remotes: 'origin\n', existingBranchMerge: 'refs/heads/feature\n' },
      UPSTREAM_CONFIG_EXISTS_MESSAGE,
      true
    ]
  ] as Array<[string, RawOptions, string, boolean]>)(
    '%s なら拒否し、push しない',
    async (_label, o, message, isRepo) => {
      setupRaw(o)
      mockCheckIsRepo.mockResolvedValue(isRepo)
      await expect(pushSetUpstream('/project')).rejects.toThrow(message)
      expect(calledCommands()).not.toContain('push')
    }
  )

  it('push の失敗は git のメッセージを添える(non-fast-forward など)', async () => {
    setupRaw({
      remotes: 'origin\n',
      push: new MockGitError(' ! [rejected]        main -> main (fetch first)\n')
    })
    await expect(pushSetUpstream('/project')).rejects.toThrow(
      '初回 push に失敗しました: ! [rejected]        main -> main (fetch first)'
    )
    // push の後の設定の確認には進まない(push の前の設定の確認は行う)
    expect(calledCommands().at(-1)).toBe('push')
  })

  it.each([
    ['push', { remotes: 'origin\n', push: timeoutError() }],
    ['事前検証(git remote)', { remotes: timeoutError() }]
  ] as Array<[string, RawOptions]>)(
    '%s の打ち切りは既存の push と同じ文言にする',
    async (_label, o) => {
      setupRaw(o)
      await expect(pushSetUpstream('/project')).rejects.toThrow(REMOTE_OPERATION_TIMEOUT_MESSAGE)
    }
  )

  // 事前検証の git の失敗も英語の GitError のまま見せない(パターン 74)
  it('事前検証の git の失敗は初回 push の失敗にする', async () => {
    setupRaw({ remotes: new MockGitError('fatal: bad config line 3\n') })
    await expect(pushSetUpstream('/project')).rejects.toThrow(
      '初回 push に失敗しました: fatal: bad config line 3'
    )
  })

  // 終了コード 0 は効果があったことを意味しない(パターン 69)
  it.each([
    ['branch.<b>.remote が無い', { remotes: 'origin\n', branchRemote: '' }],
    ['branch.<b>.merge が別の ref', { remotes: 'origin\n', branchMerge: 'refs/heads/other\n' }]
  ] as Array<[string, RawOptions]>)('push の後に %s なら失敗にする', async (_label, o) => {
    setupRaw(o)
    await expect(pushSetUpstream('/project')).rejects.toThrow(UPSTREAM_NOT_CONFIRMED_MESSAGE)
  })
})

// フォルダが開いた後に削除・移動されていると、simpleGit() の生成が英語の GitConstructError を投げる(パターン 74)
describe('フォルダが存在しない', () => {
  beforeEach(() => {
    setupRaw({ remotes: 'origin\n' })
    mockCheckIsRepo.mockResolvedValue(true)
    mockSimpleGit.mockImplementationOnce(() => {
      throw new MockGitConstructError('Cannot use simple-git on a directory that does not exist')
    })
  })

  it.each([
    ['initRepository', () => initRepository('/gone', 'main')],
    ['addOrigin', () => addOrigin('/gone', 'https://h/a.git')],
    ['pushSetUpstream', () => pushSetUpstream('/gone')]
  ] as Array<[string, () => Promise<void>]>)(
    '%s はフォルダが見つからない旨の日本語で失敗し、git を呼ばない',
    async (_label, run) => {
      await expect(run()).rejects.toThrow(/^フォルダが見つかりません: \/gone$/)
      expect(FOLDER_NOT_FOUND_MESSAGE).toBe('フォルダが見つかりません')
      expect(mockRaw).not.toHaveBeenCalled()
      expect(mockCheckIsRepo).not.toHaveBeenCalled()
    }
  )
})

// フォルダが見つからない旨に変換するのは GitConstructError だけ。生成時のそれ以外の失敗は、操作の失敗の文言に
// 元のメッセージを添える(フォルダがあるのに「見つかりません」と見せない)
describe('simple-git の生成が GitConstructError 以外で失敗する', () => {
  beforeEach(() => {
    mockSimpleGit.mockImplementationOnce(() => {
      throw new Error('boom')
    })
  })

  it.each([
    [
      'initRepository',
      () => initRepository('/project', 'main'),
      'リポジトリを初期化できませんでした: boom'
    ],
    [
      'addOrigin',
      () => addOrigin('/project', 'https://h/a.git'),
      'リモートを追加できませんでした: boom'
    ],
    ['pushSetUpstream', () => pushSetUpstream('/project'), '初回 push に失敗しました: boom']
  ] as Array<[string, () => Promise<void>, string]>)(
    '%s はフォルダが見つからない旨にせず、操作の失敗として投げる',
    async (_label, run, message) => {
      // Error を渡した toThrow は message の完全一致で比べる
      await expect(run()).rejects.toThrow(new Error(message))
      expect(mockRaw).not.toHaveBeenCalled()
      expect(mockCheckIsRepo).not.toHaveBeenCalled()
    }
  )
})
