import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { REMOTE_OPERATION_TIMEOUT_MESSAGE } from '../gitRemoteTimeout'
import {
  ALREADY_REPOSITORY_MESSAGE,
  NOT_ON_BRANCH_FOR_PUSH_MESSAGE,
  NOT_REPOSITORY_MESSAGE,
  NO_COMMIT_FOR_PUSH_MESSAGE,
  NO_ORIGIN_FOR_PUSH_MESSAGE,
  ORIGIN_EXISTS_MESSAGE,
  UPSTREAM_CONFIG_EXISTS_MESSAGE,
  addOrigin,
  initRepository,
  pushSetUpstream
} from '../gitRemoteSetupService'
import { REMOTE_URL_RULE_MESSAGES } from '../gitRemoteUrlMessages'
import {
  commitAll,
  initRepo,
  killRecordedProcess,
  runGit,
  stubGitCeiling,
  stubIsolatedGitEnv,
  writeRepoFile
} from './helpers/realGitRepo'

// 'é' の NFC(1 文字)と NFD(e + 結合文字)
const NFC_E = '\u00e9'
const NFD_E = 'e\u0301'

// gitRemoteSetupService.test.ts は simple-git をモックするため、実際の git が引数をどう解釈するか
// (--initial-branch の 1 引数、remote add の --、完全な refspec と --progress、利用者の push の設定)は
// 検証できない。ここで実 git で固定する。環境は GIT_CONFIG_GLOBAL=/dev/null・GIT_CONFIG_NOSYSTEM=1 で
// 固定し、init.defaultBranch などの既定に依存しない(パターン 46)
describe('gitRemoteSetupService(実 git)', () => {
  let root: string

  beforeEach(() => {
    stubIsolatedGitEnv()
    // 一時ディレクトリより上のリポジトリ(TMPDIR がリポジトリの中にある環境など)を checkIsRepo が拾わない
    stubGitCeiling(tmpdir())
    root = mkdtempSync(join(tmpdir(), 'remote-setup-'))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  const dir = (name: string): string => {
    const path = join(root, name)
    mkdirSync(path, { recursive: true })
    return path
  }
  const headRef = (repo: string): string => runGit(repo, 'symbolic-ref', 'HEAD').trim()
  // キーが無いと git config は終了コード 1 で終わり、runGit が投げる
  const configOrEmpty = (repo: string, key: string): string => {
    try {
      return runGit(repo, 'config', '--get', key).trim()
    } catch {
      return ''
    }
  }
  const makeBare = (name = 'remote.git'): string => {
    const bare = join(root, name)
    runGit(root, 'init', '-q', '--bare', bare)
    return bare
  }
  const makeRepoWithCommit = (name = 'repo', content = '1\n'): string => {
    const repo = dir(name)
    initRepo(repo)
    writeRepoFile(repo, 'a.txt', content)
    commitAll(repo, 'first')
    return repo
  }
  const refOf = (repo: string, ref: string): string => runGit(repo, 'rev-parse', ref).trim()

  describe('initRepository', () => {
    it.each(['main', 'feat/x', '日本語'])(
      '%s で初期化し、HEAD がそのブランチを指す',
      async (name) => {
        const folder = dir('work')
        await initRepository(folder, name)
        expect(headRef(folder)).toBe(`refs/heads/${name}`)
      }
    )

    // macOS の git は NFD の名前を NFD のまま refs/heads/<NFD> にする(実機で確認。パターン 83)
    it('NFD の名前は NFC にそろえて初期化する', async () => {
      const folder = dir('work')
      await initRepository(folder, `caf${NFD_E}`)
      expect(headRef(folder)).toBe(`refs/heads/caf${NFC_E}`)
    })

    it('前後の空白を除いて初期化する', async () => {
      const folder = dir('work')
      await initRepository(folder, '  main  ')
      expect(headRef(folder)).toBe('refs/heads/main')
    })

    // git init は HEAD・-x・@ を通し、a..b・main.lock・@{-1} は失敗しても .git を残す(実機で確認)
    it.each([
      ['HEAD', 'ブランチ名として使用できない名前です: HEAD'],
      ['-x', '`-` で始まるブランチ名は使用できません: -x'],
      ['@', 'ブランチ名として使用できない名前です: @'],
      ['a..b', 'ブランチ名として使用できない名前です: a..b'],
      ['main.lock', 'ブランチ名として使用できない名前です: main.lock'],
      ['@{-1}', 'ブランチ名として使用できない名前です: @{-1}']
    ])('%s は拒否し、.git を作らない', async (name, message) => {
      const folder = dir('work')
      await expect(initRepository(folder, name)).rejects.toThrow(message)
      expect(existsSync(join(folder, '.git'))).toBe(false)
    })

    // 既存のリポジトリに git init すると、終了コード 0 で再初期化され --initial-branch は無視される(実機で確認)
    it('既にリポジトリのフォルダは拒否し、HEAD を変えない', async () => {
      const repo = makeRepoWithCommit()
      await expect(initRepository(repo, 'trunk')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(headRef(repo)).toBe('refs/heads/main')
    })

    it('親がリポジトリのサブフォルダは拒否し、サブフォルダに .git を作らない', async () => {
      const repo = makeRepoWithCommit()
      const sub = join(repo, 'sub')
      mkdirSync(sub)
      await expect(initRepository(sub, 'main')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(existsSync(join(sub, '.git'))).toBe(false)
    })

    it('利用者の init.defaultBranch より、入力した名前を使う', async () => {
      const globalConfig = join(root, 'gitconfig')
      writeFileSync(globalConfig, '[init]\n\tdefaultBranch = trunk\n')
      vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig)
      const folder = dir('work')
      await initRepository(folder, 'main')
      expect(headRef(folder)).toBe('refs/heads/main')
    })

    // git init は名前の検証で失敗しても HEAD の無い .git を残す。それは checkIsRepo では「リポジトリではない」になる
    it('失敗した init の残骸(HEAD の無い .git)があっても、正しい名前で初期化できる', async () => {
      const folder = dir('work')
      expect(() => runGit(folder, 'init', '-q', '--initial-branch=a..b')).toThrow()
      expect(existsSync(join(folder, '.git', 'HEAD'))).toBe(false)
      await initRepository(folder, 'main')
      expect(headRef(folder)).toBe('refs/heads/main')
    })

    // bare リポジトリと .git ディレクトリ(とその中)では checkIsRepo(--is-inside-work-tree)が false になる。
    // git init は成功して中に .git を作ってしまう(実機で確認)。rev-parse --git-dir の成功で既存のリポジトリと判定する
    it.each([
      ['bare リポジトリ', (): string => makeBare('bare.git')],
      ['bare リポジトリの中のフォルダ', (): string => join(makeBare('bare.git'), 'refs')],
      ['.git ディレクトリ', (): string => join(makeRepoWithCommit(), '.git')],
      ['.git ディレクトリの中のフォルダ', (): string => join(makeRepoWithCommit(), '.git', 'refs')]
    ])('%s では拒否し、.git を作らず、既存の config を変えない', async (_label, make) => {
      const folder = make()
      const configPath = join(runGit(folder, 'rev-parse', '--absolute-git-dir').trim(), 'config')
      const before = readFileSync(configPath, 'utf8')
      await expect(initRepository(folder, 'dev')).rejects.toThrow(ALREADY_REPOSITORY_MESSAGE)
      expect(existsSync(join(folder, '.git'))).toBe(false)
      expect(readFileSync(configPath, 'utf8')).toBe(before)
    })

    // simple-git の checkIsRepo は「not a git repository」を false に読み替える(差分 1)。git init が失敗する
    it('壊れた .git ファイルは、git の失敗として「初期化できませんでした」を返す', async () => {
      const folder = dir('work')
      writeFileSync(join(folder, '.git'), `gitdir: ${join(root, 'nonexistent')}\n`)
      await expect(initRepository(folder, 'main')).rejects.toThrow(
        'リポジトリを初期化できませんでした: '
      )
    })
  })

  describe('addOrigin', () => {
    let repo: string
    const configText = (): string => readFileSync(join(repo, '.git', 'config'), 'utf8')
    const originUrl = (): string => runGit(repo, 'remote', 'get-url', 'origin').trim()

    beforeEach(() => {
      repo = makeRepoWithCommit()
    })

    it.each([
      'https://github.com/a/b.git',
      'http://example.com/a.git',
      'ssh://git@host:22/a.git',
      'git://host/a',
      'git@github.com:a/b.git'
    ])('%s を追加し、remote get-url が一致する', async (url) => {
      await addOrigin(repo, url)
      expect(originUrl()).toBe(url)
    })

    it('bare リポジトリの絶対パスと file:// を追加できる', async () => {
      const bare = makeBare()
      await addOrigin(repo, bare)
      expect(originUrl()).toBe(bare)
      const other = makeRepoWithCommit('other')
      await addOrigin(other, `file://${bare}`)
      expect(runGit(other, 'remote', 'get-url', 'origin').trim()).toBe(`file://${bare}`)
    })

    // remote add は通信しない(-f を付けない)
    it('到達できない URL でも通信せずにすぐ終わる', async () => {
      const started = Date.now()
      await addOrigin(repo, 'https://unreachable.invalid/x.git')
      expect(Date.now() - started).toBeLessThan(5000)
      expect(originUrl()).toBe('https://unreachable.invalid/x.git')
    })

    it.each([
      ['ext:: とコマンド', 'ext::sh -c touch% x'],
      ['ext::', 'ext::sh'],
      ['fd::', 'fd::3'],
      ['相対パス', '../remote.git'],
      ['user@ の無い host:path', 'host:path'],
      ['- で始まる', '--upload-pack=x'],
      ['改行を含む', '/a\n/b'],
      // git:// は userinfo を解釈せず、push の失敗の文言にホスト名として資格情報を出す(実機で確認)
      ['git:// の userinfo', 'git://alice:s3cret@127.0.0.1:19418/b.git'],
      // パスワード入りの URL は構造的に拒否する(利用者の決定。認証は credential helper に任せる)
      ['https の user:token', 'https://alice:ghp_TOKEN123@github.com/a/b.git'],
      ['https のトークンだけ', 'https://ghp_TOKEN123@github.com/a/b.git'],
      ['ssh の user:password', 'ssh://u:pw@github.com/x/y.git'],
      ['userinfo に生の /(パスワードが数字で始まる)', 'https://alice:1234/s3cret@h/r'],
      ['userinfo の #', 'https://h#sec@h2/r'],
      ['ssh の host の %XX', 'ssh://alice%3Apw%40h/r']
    ])('%s(%j)は拒否し、.git/config を変えない', async (_label, url) => {
      const before = configText()
      await expect(addOrigin(repo, url)).rejects.toThrow()
      expect(configText()).toBe(before)
    })

    // protocol.ext.allow=always では、push 時に ext:: のコマンドが実行される(実機で確認)。追加の時点で止める
    it('protocol.ext.allow=always の環境でも ext:: を追加しない', async () => {
      runGit(repo, 'config', 'protocol.ext.allow', 'always')
      const before = configText()
      await expect(addOrigin(repo, 'ext::sh')).rejects.toThrow(REMOTE_URL_RULE_MESSAGES.unsupported)
      expect(configText()).toBe(before)
    })

    it('origin が既にあれば拒否する', async () => {
      runGit(repo, 'remote', 'add', 'origin', 'https://h/first.git')
      await expect(addOrigin(repo, 'https://h/second.git')).rejects.toThrow(ORIGIN_EXISTS_MESSAGE)
      expect(originUrl()).toBe('https://h/first.git')
    })

    // remote.origin.url が無くても git remote は origin を出し、remote add は already exists になる(実機で確認)
    it('remote.origin.fetch だけがある場合も拒否する', async () => {
      runGit(repo, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
      await expect(addOrigin(repo, 'https://h/a.git')).rejects.toThrow(ORIGIN_EXISTS_MESSAGE)
    })

    it('リポジトリでなければ拒否する', async () => {
      const plain = dir('plain')
      await expect(addOrigin(plain, 'https://h/a.git')).rejects.toThrow(NOT_REPOSITORY_MESSAGE)
    })

    // クラッシュ後に残った config.lock(または addOrigin の同時実行)で remote add が失敗すると、git は
    // `fatal: could not set 'remote.origin.url' to '<url>'` と URL をそのまま出す(実機 git 2.50.1 で確認)。
    // 検証はパスワード入りの URL を拒否するため、ここに届く userinfo は scp 形式・ssh:// のユーザー名だけ。
    // 文言は IPC で画面まで届くため、それも伏せる(防御の 2 層)
    it('config.lock が残っていて失敗しても、文言に URL の user を出さない', async () => {
      writeFileSync(join(repo, '.git', 'config.lock'), '')
      const err = await addOrigin(repo, 'tok123@github.com:a/b.git').catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      const message = (err as Error).message
      expect(message).toMatch(/^リモートを追加できませんでした: /)
      expect(message).toContain('***@github.com:a/b.git')
      expect(message).not.toContain('tok123')
    })

    it('Windows のドライブの形は windowsPaths のときだけ追加する', async () => {
      await expect(addOrigin(repo, 'C:/repos/a.git', undefined, false)).rejects.toThrow(
        REMOTE_URL_RULE_MESSAGES.unsupported
      )
      await addOrigin(repo, 'C:/repos/a.git', undefined, true)
      expect(originUrl()).toBe('C:/repos/a.git')
    })
  })

  describe('pushSetUpstream', () => {
    let repo: string
    let bare: string

    beforeEach(() => {
      repo = makeRepoWithCommit()
      bare = makeBare()
    })

    const expectUpstreamOf = (branch: string): void => {
      expect(configOrEmpty(repo, `branch.${branch}.remote`)).toBe('origin')
      expect(configOrEmpty(repo, `branch.${branch}.merge`)).toBe(`refs/heads/${branch}`)
      expect(refOf(bare, `refs/heads/${branch}`)).toBe(refOf(repo, 'HEAD'))
    }

    it('origin(絶対パス)へ送り、upstream を設定する', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
      expect(runGit(repo, 'rev-parse', '--abbrev-ref', 'main@{upstream}').trim()).toBe(
        'origin/main'
      )
    })

    it('file:// の origin へも送れる', async () => {
      runGit(repo, 'remote', 'add', 'origin', `file://${bare}`)
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
    })

    it('detached HEAD では送らない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'checkout', '-q', '--detach')
      await expect(pushSetUpstream(repo)).rejects.toThrow(NOT_ON_BRANCH_FOR_PUSH_MESSAGE)
      expect(runGit(bare, 'for-each-ref').trim()).toBe('')
    })

    it('リベースで止めている間は送らない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      writeRepoFile(repo, 'a.txt', '2\n')
      commitAll(repo, 'second')
      try {
        runGit(repo, 'rebase', '--exec', 'false', 'HEAD~1')
      } catch {
        // 意図した停止(終了コード 1)
      }
      expect(existsSync(join(repo, '.git', 'rebase-merge'))).toBe(true)
      await expect(pushSetUpstream(repo)).rejects.toThrow(NOT_ON_BRANCH_FOR_PUSH_MESSAGE)
      expect(runGit(bare, 'for-each-ref').trim()).toBe('')
    })

    // git に任せると `src refspec main does not match any` の英語になる(実機で確認)
    it('コミットが無ければ送らない', async () => {
      const empty = dir('empty')
      initRepo(empty)
      runGit(empty, 'remote', 'add', 'origin', bare)
      await expect(pushSetUpstream(empty)).rejects.toThrow(NO_COMMIT_FOR_PUSH_MESSAGE)
    })

    it('origin が無ければ送らない', async () => {
      await expect(pushSetUpstream(repo)).rejects.toThrow(NO_ORIGIN_FOR_PUSH_MESSAGE)
    })

    // -u は既存の branch.<b>.remote / merge を黙って上書きする。利用者の設定を変えない(パターン 45)
    it('upstream が既にあれば上書きしない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'push', '-q', '-u', 'origin', 'main')
      await expect(pushSetUpstream(repo)).rejects.toThrow(
        'upstream は既に設定されています: origin/main'
      )
      expect(configOrEmpty(repo, 'branch.main.merge')).toBe('refs/heads/main')
    })

    // %(upstream:short) は、削除済み(または fetch の refspec の無い)remote を指す upstream を空にする。
    // 名前の . や / は config のキーのサブセクションにそのまま入る(実機で確認)。サブセクションは大文字小文字を
    // 区別するため、大文字を含む名前も小文字にせずに読む
    it.each(['main', 'feat.x/y', 'Feat.X/y'])(
      '%s の branch.<b>.remote / merge が表示されない upstream として設定済みなら、上書きせず送らない',
      async (name) => {
        runGit(repo, 'remote', 'add', 'origin', bare)
        if (name !== 'main') runGit(repo, 'checkout', '-q', '-b', name)
        runGit(repo, 'config', `branch.${name}.remote`, 'ghost')
        runGit(repo, 'config', `branch.${name}.merge`, 'refs/heads/feature')
        await expect(pushSetUpstream(repo)).rejects.toThrow(UPSTREAM_CONFIG_EXISTS_MESSAGE)
        expect(configOrEmpty(repo, `branch.${name}.remote`)).toBe('ghost')
        expect(configOrEmpty(repo, `branch.${name}.merge`)).toBe('refs/heads/feature')
        expect(runGit(bare, 'for-each-ref').trim()).toBe('')
      }
    )

    // 同名のタグがあると `push -u origin main` は `src refspec main matches more than one` で失敗する(パターン 43)
    it('同じ名前のタグがあっても、完全な refspec で送れる', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'tag', 'main')
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
    })

    // refs/ で始まる refspec なので、- で始まるブランチ名もオプションと解釈されない(パターン 21)
    it('- で始まるブランチ名でも送れる', async () => {
      const dash = dir('dash')
      runGit(dash, 'init', '-q', '--initial-branch=-x')
      runGit(dash, 'config', 'user.email', 'test@example.com')
      runGit(dash, 'config', 'user.name', 'test')
      runGit(dash, 'config', 'commit.gpgsign', 'false')
      writeRepoFile(dash, 'a.txt', '1\n')
      commitAll(dash, 'first')
      runGit(dash, 'remote', 'add', 'origin', bare)
      await pushSetUpstream(dash)
      expect(configOrEmpty(dash, 'branch.-x.merge')).toBe('refs/heads/-x')
      expect(refOf(bare, 'refs/heads/-x')).toBe(refOf(dash, 'HEAD'))
    })

    it('リモートの同名のブランチと non-fast-forward なら失敗し、upstream を設定しない', async () => {
      const other = makeRepoWithCommit('other', 'other\n')
      runGit(other, 'push', '-q', bare, 'main')
      runGit(repo, 'remote', 'add', 'origin', bare)
      await expect(pushSetUpstream(repo)).rejects.toThrow(/^初回 push に失敗しました: /)
      expect(configOrEmpty(repo, 'branch.main.remote')).toBe('')
    })

    // 完全な refspec のため、push.default・remote.origin.push に影響されない(実機で確認)
    it('push.default=nothing・remote.origin.push があっても、そのブランチを同じ名前で送る', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      runGit(repo, 'config', 'push.default', 'nothing')
      runGit(repo, 'config', 'remote.origin.push', 'refs/heads/main:refs/heads/elsewhere')
      await pushSetUpstream(repo)
      expectUpstreamOf('main')
      expect(runGit(bare, 'for-each-ref', '--format=%(refname)').trim()).toBe('refs/heads/main')
    })

    // ssh と scp 形式の push の失敗では、ssh 自身が `<user>@<host>: Permission denied (publickey).` と
    // 接続先を出し、git はそれをそのまま stderr に流す(https・http は git が資格情報を取り除く)。
    // ssh:// の `u:pw@` は user が `u:pw` として ssh に渡る(実機 git 2.50.1 で確認)。addOrigin の検証はパスワード入りの
    // URL を拒否するが、端末で追加した origin(ここでは runGit で追加)への初回 push の文言は伏せる(防御の 2 層)。
    // ネットワークに出ないよう、
    // core.sshCommand に、最初のオプションでない引数(接続先)を ssh と同じ形で出して失敗する偽の ssh を置く
    it.each([
      ['ssh:// の user:password', 'ssh://u:pw@github.com/x/y.git', ['u:pw', 'pw']],
      ['scp 形式の user(トークン)', 'tok123@github.com:x/y.git', ['tok123']]
    ])('ssh の認証の失敗(%s)でも、文言に資格情報を出さない', async (_label, url, secrets) => {
      const fakeSsh = join(root, 'fake-ssh')
      writeFileSync(
        fakeSsh,
        [
          '#!/bin/sh',
          'for a in "$@"; do case "$a" in -*) ;; *) host="$a"; break;; esac; done',
          'echo "$host: Permission denied (publickey)." >&2',
          'exit 255',
          ''
        ].join('\n')
      )
      chmodSync(fakeSsh, 0o755)
      runGit(repo, 'config', 'core.sshCommand', fakeSsh)
      runGit(repo, 'remote', 'add', 'origin', url)
      const err = await pushSetUpstream(repo).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      const message = (err as Error).message
      expect(message).toMatch(/^初回 push に失敗しました: /)
      // 偽の ssh が呼ばれ、接続先(資格情報を伏せた形)が文言に届いている
      expect(message).toContain('***@github.com: Permission denied (publickey).')
      for (const secret of secrets) expect(message).not.toContain(secret)
      expect(configOrEmpty(repo, 'branch.main.remote')).toBe('')
    })

    // 認証待ちなどで出力が途絶えた場合と同じく、pre-push フックの sleep で打ち切りを確かめる(パターン 84)
    it('応答が途絶えたら打ち切り、upstream を設定しない', async () => {
      runGit(repo, 'remote', 'add', 'origin', bare)
      const hook = join(repo, '.git', 'hooks', 'pre-push')
      const pidFile = join(repo, '.git', 'hook.pid')
      // exec で sleep がフックと同じ PID になる。打ち切りは git だけを止め sleep は孤児として残るため、
      // 記録した PID で後始末する
      writeFileSync(hook, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 5\n`)
      chmodSync(hook, 0o755)
      try {
        await expect(pushSetUpstream(repo, 300)).rejects.toThrow(REMOTE_OPERATION_TIMEOUT_MESSAGE)
        expect(configOrEmpty(repo, 'branch.main.remote')).toBe('')
      } finally {
        await killRecordedProcess(pidFile, 1000)
      }
    })
  })

  // 開いた後に削除・移動されたフォルダ。simpleGit() の英語の GitConstructError を見せない(パターン 74)
  describe('フォルダが存在しない', () => {
    it.each([
      ['initRepository', (path: string) => initRepository(path, 'main')],
      ['addOrigin', (path: string) => addOrigin(path, 'https://h/a.git')],
      ['pushSetUpstream', (path: string) => pushSetUpstream(path)]
    ] as Array<[string, (path: string) => Promise<void>]>)(
      '%s はフォルダが見つからない旨の日本語で失敗する',
      async (_label, run) => {
        const gone = join(root, 'gone')
        await expect(run(gone)).rejects.toThrow(`フォルダが見つかりません: ${gone}`)
        expect(existsSync(gone)).toBe(false)
      }
    )
  })
})
