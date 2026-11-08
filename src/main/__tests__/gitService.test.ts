import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCheckIsRepo = vi.hoisted(() => vi.fn())
const mockStatus = vi.hoisted(() => vi.fn())
const mockAdd = vi.hoisted(() => vi.fn())
const mockReset = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockDiff = vi.hoisted(() => vi.fn())
const mockRaw = vi.hoisted(() => vi.fn())
const mockBranchLocal = vi.hoisted(() => vi.fn())
const mockTags = vi.hoisted(() => vi.fn())
const mockEnv = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())
const mockPull = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())
const mockCheckout = vi.hoisted(() => vi.fn())
const mockCheckoutLocalBranch = vi.hoisted(() => vi.fn())
const mockDeleteLocalBranch = vi.hoisted(() => vi.fn())
const mockSimpleGit = vi.hoisted(() =>
  vi.fn(() => {
    const git = {
      checkIsRepo: mockCheckIsRepo,
      status: mockStatus,
      add: mockAdd,
      reset: mockReset,
      commit: mockCommit,
      diff: mockDiff,
      raw: mockRaw,
      branchLocal: mockBranchLocal,
      tags: mockTags,
      env: mockEnv,
      push: mockPush,
      pull: mockPull,
      fetch: mockFetch,
      checkout: mockCheckout,
      checkoutLocalBranch: mockCheckoutLocalBranch,
      deleteLocalBranch: mockDeleteLocalBranch
    }
    // env() は simple-git 本来の挙動と同じくインスタンス自身を返す(チェーン用)
    mockEnv.mockReturnValue(git)
    return git
  })
)

const mockReadFileBuffer = vi.hoisted(() => vi.fn())
const mockIsExecutableFile = vi.hoisted(() => vi.fn())
const mockIsSymbolicLink = vi.hoisted(() => vi.fn())
const mockGetFileSize = vi.hoisted(() => vi.fn())

// GitError は「配下の git プロセスは実際に起動でき、exit code 非0で終了した」
// ことを表す。rev-parse がこの型で失敗した場合のみ「unborn HEAD(コミット無し)」
// と判定してよい。GitError でない失敗(git バイナリ不在等の spawn レベルの異常)は
// log の失敗と同じ根本原因である可能性が高いため区別する
const MockGitError = vi.hoisted(() => class MockGitError extends Error {})
// GitPluginError は simple-git のプラグイン(timeout プラグイン等)が独自に
// throw するエラー型。実際の GitPluginError と同様 plugin プロパティ
// ('timeout' 等)を持つ最小限のモック
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
vi.mock('simple-git', () => ({
  default: mockSimpleGit,
  GitError: MockGitError,
  GitPluginError: MockGitPluginError
}))
vi.mock('../fileSystem', () => ({
  readFileBuffer: mockReadFileBuffer,
  isExecutableFile: mockIsExecutableFile,
  isSymbolicLink: mockIsSymbolicLink,
  getFileSize: mockGetFileSize
}))

import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  getLog,
  getHeadCommitMessage,
  getBranches,
  getTags,
  amendCommit,
  isStagedRenameDiff,
  push,
  pull,
  fetchRemote,
  checkoutBranch,
  createBranch,
  deleteBranch,
  mergeBranch
} from '../gitService'

beforeEach(() => {
  vi.clearAllMocks()
  // vi.clearAllMocks() は呼び出し履歴のみクリアし、mockResolvedValue 等で
  // 設定した実装は残留する。isSymbolicLink はほとんどのテストで無関係
  // (シンボリックリンクではない)ため、ここでデフォルトを明示しておく
  mockIsSymbolicLink.mockResolvedValue(false)
  // getFileSize も同様にほとんどのテストで無関係(サイズ上限を超えず、空でもない)
  // ため、通常のテキストファイル相当の小さい値をデフォルトにしておく。
  // 0 にすると「空ファイル」分岐に入り、内容を読む前にメッセージが返ってしまう
  mockGetFileSize.mockResolvedValue(64)
})

const baseStatusResult = {
  current: 'main',
  ahead: 0,
  behind: 0,
  files: [],
  not_added: [],
  conflicted: [],
  created: [],
  deleted: [],
  modified: [],
  renamed: [],
  staged: [],
  isClean: () => true,
  detached: false,
  tracking: null
}

describe('getGitStatus', () => {
  beforeEach(() => {
    // 既定はマージ中ではない(MERGE_HEAD が無いと rev-parse -q --verify は空文字で resolve する)
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('')
  })

  it('git status は GIT_OPTIONAL_LOCKS=0 を足した環境で、環境の検査を外した simple-git で取る(.git/index を書かない)', async () => {
    const before = process.env.GIT_OPTIONAL_LOCKS
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    await getGitStatus('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      unsafe: expect.objectContaining({ allowUnsafeAskPass: true, allowUnsafeEditor: true })
    })
    expect(mockEnv).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0', PATH: process.env.PATH })
    )
    expect(mockStatus).toHaveBeenCalledOnce()
    // process.env そのものは書き換えない
    expect(process.env.GIT_OPTIONAL_LOCKS).toBe(before)
  })

  it('simpleGit を folderPath を引数に呼ぶ', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    await getGitStatus('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
  })

  it('Git リポジトリでない場合 isRepo: false を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    const result = await getGitStatus('/project')
    expect(result).toEqual({
      isRepo: false,
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: []
    })
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('正常系: isRepo: true でブランチ名・ahead/behind が含まれる', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({
      ...baseStatusResult,
      current: 'feature/foo',
      ahead: 2,
      behind: 1,
      files: []
    })
    const result = await getGitStatus('/project')
    expect(result.isRepo).toBe(true)
    expect(result.branch).toBe('feature/foo')
    expect(result.ahead).toBe(2)
    expect(result.behind).toBe(1)
  })

  it('files が正しく変換される（working_dir → workingDir）', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({
      ...baseStatusResult,
      files: [
        { path: 'src/index.ts', index: 'M', working_dir: ' ' },
        { path: 'README.md', index: '?', working_dir: '?' }
      ]
    })
    const result = await getGitStatus('/project')
    expect(result.files).toEqual([
      { path: 'src/index.ts', index: 'M', workingDir: ' ' },
      { path: 'README.md', index: '?', workingDir: '?' }
    ])
  })

  it('リネームされたファイルは、旧パス(from)も含めて返す', async () => {
    // ステージ済みリネームの diff を新パスだけの pathspec で取ると、git は
    // 旧パス側が pathspec から外れるためリネーム検出を行わず「新規ファイル+
    // 全行追加」として出力する。その diff をアンステージすると index から
    // 新パスが消えるだけで旧パスの削除がステージに残り、コミットすると
    // ファイルが消えてしまう(実機で再現確認済み)。判定材料として from が要る
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({
      ...baseStatusResult,
      files: [{ path: 'new.txt', index: 'R', working_dir: ' ', from: 'old.txt' }]
    })
    const result = await getGitStatus('/project')
    expect(result.files).toEqual([
      { path: 'new.txt', index: 'R', workingDir: ' ', from: 'old.txt' }
    ])
  })

  it('リネームでないファイルには from を含めない', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({
      ...baseStatusResult,
      files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }]
    })
    const result = await getGitStatus('/project')
    expect(result.files).toEqual([{ path: 'a.ts', index: 'M', workingDir: ' ' }])
  })

  it('MERGE_HEAD があれば mergeInProgress: true を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    mockRaw.mockResolvedValue('abc123\n')
    const result = await getGitStatus('/project')
    expect(result.mergeInProgress).toBe(true)
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  })

  it('MERGE_HEAD が無ければ mergeInProgress: false を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue(baseStatusResult)
    const result = await getGitStatus('/project')
    expect(result.mergeInProgress).toBe(false)
  })

  it('リポジトリでないときは MERGE_HEAD を問い合わせず mergeInProgress: false', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    const result = await getGitStatus('/project')
    expect(result.mergeInProgress).toBe(false)
    expect(mockRaw).not.toHaveBeenCalled()
  })

  it('branch が null のとき null をそのまま返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({ ...baseStatusResult, current: null })
    const result = await getGitStatus('/project')
    expect(result.branch).toBeNull()
  })

  describe('hasOrigin・hasRemote・upstream・detached', () => {
    // git remote と MERGE_HEAD の問い合わせを振り分ける(MERGE_HEAD は無い)
    const rawWithRemotes =
      (remotes: string) =>
      (args: string[]): Promise<string> =>
        Promise.resolve(args[0] === 'remote' ? remotes : '')

    it('git remote に origin の行があれば hasOrigin: true', async () => {
      mockCheckIsRepo.mockResolvedValue(true)
      mockStatus.mockResolvedValue(baseStatusResult)
      mockRaw.mockImplementation(rawWithRemotes('upstream\norigin\n'))
      const result = await getGitStatus('/project')
      expect(result.hasOrigin).toBe(true)
      expect(mockRaw).toHaveBeenCalledWith(['remote'])
    })

    it('origin が無ければ hasOrigin: false', async () => {
      mockCheckIsRepo.mockResolvedValue(true)
      mockStatus.mockResolvedValue(baseStatusResult)
      mockRaw.mockImplementation(rawWithRemotes('upstream\n'))
      const result = await getGitStatus('/project')
      expect(result.hasOrigin).toBe(false)
    })

    // hasRemote はリモートが 1 つでもあるか。origin 以外の名前のリモートだけ(git clone -o github など)でも真。
    // git remote は 1 回だけ呼び、hasOrigin と同じ出力から決める
    it.each([
      ['origin と別名', true, true, 'upstream\norigin\n'],
      ['origin 以外の名前だけ', false, true, 'github\n'],
      ['origin 以外の名前だけ(\\r\\n)', false, true, 'github\r\n'],
      ['リモートが無い', false, false, '']
    ])(
      'git remote が %s → hasOrigin: %s・hasRemote: %s',
      async (_label, hasOrigin, hasRemote, remotes) => {
        mockCheckIsRepo.mockResolvedValue(true)
        mockStatus.mockResolvedValue(baseStatusResult)
        mockRaw.mockImplementation(rawWithRemotes(remotes))
        const result = await getGitStatus('/project')
        expect(result).toMatchObject({ hasOrigin, hasRemote })
        expect(mockRaw.mock.calls.filter(([args]) => args[0] === 'remote')).toHaveLength(1)
      }
    )

    // gone(リモートの ref が消えた)でも simple-git は tracking に origin/<b> を返す(実機で確認)
    it.each([
      ['設定済み', 'origin/main', 'origin/main'],
      ['ローカルのブランチ', 'main', 'main'],
      ['未設定', null, null]
    ])('upstream は status.tracking(%s)', async (_label, tracking, expected) => {
      mockCheckIsRepo.mockResolvedValue(true)
      mockStatus.mockResolvedValue({ ...baseStatusResult, tracking })
      const result = await getGitStatus('/project')
      expect(result.upstream).toBe(expected)
    })

    it('detached は status.detached', async () => {
      mockCheckIsRepo.mockResolvedValue(true)
      mockStatus.mockResolvedValue({ ...baseStatusResult, current: 'HEAD', detached: true })
      const result = await getGitStatus('/project')
      expect(result.detached).toBe(true)
      expect(result.upstream).toBeNull()
    })

    it('git remote の失敗は getGitStatus の失敗にする', async () => {
      mockCheckIsRepo.mockResolvedValue(true)
      mockStatus.mockResolvedValue(baseStatusResult)
      mockRaw.mockImplementation((args: string[]) =>
        args[0] === 'remote' ? Promise.reject(new Error('fatal: bad config')) : Promise.resolve('')
      )
      await expect(getGitStatus('/project')).rejects.toThrow('fatal: bad config')
    })
  })

  it('status() が throw した場合エラーが伝播する', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockRejectedValue(new Error('git error'))
    await expect(getGitStatus('/project')).rejects.toThrow('git error')
  })
})

describe('stageFile', () => {
  const UNMERGED = '100644 aaa 2\ta.txt\0'

  beforeEach(() => {
    // 既定は未解決ではない(ls-files -u は何も出さない)
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('')
  })

  it('未解決(ls-files -u に一致)のファイルは add せずに日本語で拒否する', async () => {
    mockRaw.mockResolvedValue(UNMERGED)
    await expect(stageFile('/project', 'a.txt')).rejects.toThrow(
      'コンフリクト中のファイルはステージできません。コンフリクト解決ビューの「解決済みにする」を使ってください'
    )
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '-u', '-z', '--', ':(literal)a.txt'])
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('ls-files -u の結果に別のパスしか無ければ(完全一致しない)add する', async () => {
    mockRaw.mockResolvedValue('100644 aaa 2\ta.txt.bak\0')
    mockAdd.mockResolvedValue(undefined)
    await stageFile('/project', 'a.txt')
    expect(mockAdd).toHaveBeenCalledWith(':(literal)a.txt')
  })

  it('simpleGit を folderPath で呼び、add を filePath で呼ぶ', async () => {
    mockAdd.mockResolvedValue(undefined)
    await stageFile('/project', 'src/index.ts')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockAdd).toHaveBeenCalledWith(':(literal)src/index.ts')
  })

  it('add が throw した場合エラーが伝播する', async () => {
    mockAdd.mockRejectedValue(new Error('add failed'))
    await expect(stageFile('/project', 'src/index.ts')).rejects.toThrow('add failed')
  })
})

describe('unstageFile', () => {
  it('simpleGit を folderPath で呼び、reset を ["--", filePath] で呼ぶ', async () => {
    mockReset.mockResolvedValue(undefined)
    await unstageFile('/project', 'src/index.ts')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockReset).toHaveBeenCalledWith(['--', ':(literal)src/index.ts'])
  })

  it('reset が throw した場合エラーが伝播する', async () => {
    mockReset.mockRejectedValue(new Error('reset failed'))
    await expect(unstageFile('/project', 'src/index.ts')).rejects.toThrow('reset failed')
  })

  it('renamedFrom を渡すと、新パスと旧パスの両方を reset の対象にする(リネームの取り消しが片方だけにならないように)', async () => {
    // git mv でリネームして git add 済みの状態で、新パスだけを reset すると
    // 旧パスの削除だけが index に残ったまま(D old.txt / ?? new.txt)になり、
    // アンステージのつもりが壊れた状態を作ってしまう(実機で再現確認済み)。
    // 旧パスも reset の対象に含めることで、リネーム全体を正しく取り消す
    mockReset.mockResolvedValue(undefined)
    await unstageFile('/project', 'new.txt', 'old.txt')
    expect(mockReset).toHaveBeenCalledWith(['--', ':(literal)new.txt', ':(literal)old.txt'])
  })

  it('renamedFrom を省略した場合は、従来通り新パスのみを reset の対象にする', async () => {
    mockReset.mockResolvedValue(undefined)
    await unstageFile('/project', 'src/index.ts')
    expect(mockReset).toHaveBeenCalledWith(['--', ':(literal)src/index.ts'])
  })
})

describe('commit', () => {
  beforeEach(() => {
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('')
  })

  // 未解決があるまま git commit すると英語の生のエラー(Committing is not possible because you
  // have unmerged files)になる。日本語で拒否し、何も実行しない
  it('未解決のファイルがあるときは commit せずに日本語で拒否する', async () => {
    mockRaw.mockResolvedValue('100644 aaa 2\ta.txt\0')
    await expect(commit('/project', 'msg')).rejects.toThrow(
      '未解決のコンフリクトがあるためコミットできません。解決するか、マージを中止してください'
    )
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '-u', '-z'])
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it('simpleGit を folderPath で呼び、commit を message で呼ぶ', async () => {
    mockCommit.mockResolvedValue(undefined)
    await commit('/project', 'feat: 新機能を追加する')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCommit).toHaveBeenCalledWith('feat: 新機能を追加する')
  })

  it('commit が throw した場合エラーが伝播する', async () => {
    mockCommit.mockRejectedValue(new Error('commit failed'))
    await expect(commit('/project', 'msg')).rejects.toThrow('commit failed')
  })
})

describe('isStagedRenameDiff', () => {
  // getDiff(パッチ組み立て)と gitHandlers.ts(renamedFrom の境界チェック省略判定)が
  // 同じ条件を独立に持っていた重複を解消するため切り出した関数。両方の呼び出し元が
  // 想定する「いつ renamedFrom が有効か」を単体でも固定する
  it('staged=true かつ renamedFrom が指定されている場合のみ true を返す', () => {
    expect(isStagedRenameDiff(true, 'old.txt')).toBe(true)
  })

  it('staged=false の場合、renamedFrom があっても false を返す', () => {
    expect(isStagedRenameDiff(false, 'old.txt')).toBe(false)
  })

  it('renamedFrom が undefined の場合、staged=true でも false を返す', () => {
    expect(isStagedRenameDiff(true, undefined)).toBe(false)
  })
})

describe('getDiff', () => {
  it('diff の git は GIT_OPTIONAL_LOCKS=0 を足した環境で、環境の検査を外した simple-git で取る(サブモジュールの子の status にロックを取らせない)', async () => {
    // 未ステージの diff の pathspec がサブモジュール(gitlink)だと、git diff は dirty かを調べる子の git status を起動する。
    // 子は GIT_OPTIONAL_LOCKS が無いと .git/modules/<sub>/index.lock を取り、stat が古ければ index も書き直す
    // (diff.autoRefreshIndex=false は親の書き直ししか止めない。設計書 2026-11-08 の 1 章の 10)
    const before = process.env.GIT_OPTIONAL_LOCKS
    mockDiff.mockResolvedValue('')
    await getDiff('/project', 'sub', false, false)
    expect(mockSimpleGit).toHaveBeenCalledExactlyOnceWith('/project', {
      config: expect.arrayContaining(['diff.autoRefreshIndex=false']),
      unsafe: expect.objectContaining({ allowUnsafeAskPass: true, allowUnsafeEditor: true })
    })
    expect(mockEnv).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0', PATH: process.env.PATH })
    )
    expect(mockDiff).toHaveBeenCalledOnce()
    // process.env そのものは書き換えない
    expect(process.env.GIT_OPTIONAL_LOCKS).toBe(before)
  })

  it("未ステージの変更を simpleGit を folderPath で呼び、diff を ['-U3', '--', filePath] で呼ぶ(status は呼ばない)", async () => {
    // isUntracked は呼び出し元(renderer)が既に持っている git status 由来の情報。
    // ここで改めて git.status() を呼ぶと、diff タブを開くたびにリポジトリ全体を
    // 再スキャンする無駄な I/O が発生する
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', false, false)
    // core.quotePath=false を指定しないと、ファイル名に非ASCII文字を含む場合
    // git diff の出力がダブルクォート+オクタルエスケープされ(例: "b/\346...")、
    // diffParser.ts の toSelfDiffHeaderLines が "+++ b/" の固定長プレフィックスで
    // 新パスを切り出せなくなる(実機で再現確認済み)。diff.suppressBlankEmpty=false はパッチの形式を固定する設定
    // (gitDiffArgs の PATCH_FORMAT_CONFIG。実 git の出力は gitService.diff.integration.test.ts で固定)。
    // diff.autoRefreshIndex=false は、stat だけ変わったファイルがあっても .git/index を書き直させない
    // (index.lock を持つ間に外の git add・commit が失敗しうる。設計書 2026-11-08 の 1 章の 10)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      config: [
        'core.quotePath=false',
        'diff.suppressBlankEmpty=false',
        'diff.autoRefreshIndex=false'
      ],
      unsafe: expect.objectContaining({ allowUnsafeAskPass: true })
    })
    expect(mockStatus).not.toHaveBeenCalled()
    expect(mockDiff).toHaveBeenCalledWith([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '-U3',
      '--',
      ':(literal)src/index.ts'
    ])
    expect(result).toBe('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
  })

  it("ステージ済みの変更を diff を ['--cached', '-U3', '--', filePath] で呼ぶ(status は呼ばない)", async () => {
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', true, false)
    expect(mockStatus).not.toHaveBeenCalled()
    expect(mockDiff).toHaveBeenCalledWith([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--cached',
      '-U3',
      '--',
      ':(literal)src/index.ts'
    ])
    expect(result).toBe('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
  })

  it('ステージ済みリネームは、旧パスも pathspec に含めてリネームとして diff を取る', async () => {
    // 新パスだけを渡すと git はリネーム検出をせず「新規ファイル + 全行追加」を
    // 出力する。その diff をアンステージすると index から新パスが消えるだけで
    // 旧パスの削除がステージに残り、コミットするとファイルが消える
    // (実機で再現確認済み)。旧パスも渡せばリネームとして出力され、
    // reverse apply も正しく元の状態へ戻る
    mockDiff.mockResolvedValue('diff --git a/old.txt b/new.txt\nrename from old.txt\n')
    await getDiff('/project', 'new.txt', true, false, 'old.txt')
    expect(mockDiff).toHaveBeenCalledWith([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--cached',
      // diff.renames=false のユーザー設定でも必ずリネームとして出力させる。
      // 打ち消さないと「新規追加 + 削除」の 2 ファイル分の diff が返り、
      // 単一ファイル前提の parseDiff が 2 ファイル目の配管行を 1 ファイル目の
      // ハンク本文へ混入させてしまう(実機で再現確認済み)
      '--find-renames',
      '-U3',
      '--',
      ':(literal)new.txt',
      ':(literal)old.txt'
    ])
  })

  it('renamedFrom を渡しても未ステージ(staged: false)の diff には旧パスを含めない', async () => {
    // 未ステージ側の変更はリネーム後のパスに対するものなので、旧パスを混ぜると
    // 無関係な差分まで拾ってしまう
    mockDiff.mockResolvedValue('DIFF')
    await getDiff('/project', 'new.txt', false, false, 'old.txt')
    expect(mockDiff).toHaveBeenCalledWith([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '-U3',
      '--',
      ':(literal)new.txt'
    ])
  })

  it('isUntracked: true の場合、diff を呼ばずファイル内容から疑似diffを組み立てる', async () => {
    mockReadFileBuffer.mockResolvedValue(Buffer.from('line1\nline2\n', 'utf-8'))
    mockIsExecutableFile.mockResolvedValue(false)
    const result = await getDiff('/project', 'new.txt', false, true)
    expect(mockDiff).not.toHaveBeenCalled()
    expect(mockStatus).not.toHaveBeenCalled()
    expect(mockReadFileBuffer).toHaveBeenCalledWith('/project/new.txt')
    expect(result).toContain('--- /dev/null')
    expect(result).toContain('+++ b/new.txt')
    expect(result).toContain('+line1')
    expect(result).toContain('+line2')
    expect(result).toContain('new file mode 100644')
  })

  it('isUntracked: true かつ実行可能な場合、疑似diffの file mode を 100755 にする', async () => {
    // 100644 固定のままだと、この疑似diffを stageHunk 経由で git apply --cached した
    // とき、新規の実行可能ファイル(シェルスクリプト等)の実行ビットが失われてしまう
    mockReadFileBuffer.mockResolvedValue(Buffer.from('#!/bin/sh\n', 'utf-8'))
    mockIsExecutableFile.mockResolvedValue(true)
    const result = await getDiff('/project', 'run.sh', false, true)
    expect(mockIsExecutableFile).toHaveBeenCalledWith('/project/run.sh')
    expect(result).toContain('new file mode 100755')
  })

  it('isUntracked: true でファイルサイズが上限を超える場合、ファイル内容を読まず「大きすぎる」メッセージを返す', async () => {
    // 巨大な未追跡ファイル(ビルド成果物等を .gitignore 設定前に誤って開いた場合)を
    // 無条件に読み込んで疑似diff化すると、Electron のメインプロセス(全ウィンドウで
    // 共有)でメモリ/CPU が同期的にスパイクし、アプリ全体がフリーズしてしまう
    mockGetFileSize.mockResolvedValue(6 * 1024 * 1024)
    const result = await getDiff('/project', 'huge.log', false, true)
    expect(mockReadFileBuffer).not.toHaveBeenCalled()
    expect(result).toBe('ファイルサイズが大きすぎるため差分を表示できません: huge.log\n')
  })

  it('isUntracked: true でファイルサイズが上限ちょうどの場合は通常どおり疑似diffを組み立てる', async () => {
    mockGetFileSize.mockResolvedValue(5 * 1024 * 1024)
    mockReadFileBuffer.mockResolvedValue(Buffer.from('line1\n', 'utf-8'))
    mockIsExecutableFile.mockResolvedValue(false)
    const result = await getDiff('/project', 'ok.txt', false, true)
    expect(result).toContain('+line1')
  })

  it('isUntracked: true でシンボリックリンクの場合、実体を読まずステージ非対応メッセージを返す', async () => {
    // シンボリックリンクを readFileBuffer(fs.readFile)で読むとリンクを辿った先の
    // 実体の内容を読んでしまう。それを疑似diff化して git apply --cached すると、
    // 実体の内容がコピーされた通常ファイルとしてステージされ、シンボリックリンク
    // としての git 上の表現(mode 120000)にならない。実体を読む前に検出する
    mockIsSymbolicLink.mockResolvedValue(true)
    const result = await getDiff('/project', 'link.txt', false, true)
    expect(mockReadFileBuffer).not.toHaveBeenCalled()
    expect(result).toBe('シンボリックリンクの差分表示・ステージには対応していません: link.txt\n')
  })

  it('isUntracked: true でバイナリ(NULバイトを含む)の場合、疑似diffを組み立てず "Binary files ... differ" を返す', async () => {
    // utf-8 として無条件に読み込んでいた頃は、バイナリのバイト列が壊れた状態で
    // buildUntrackedDiff に渡され、その疑似diffを git apply --cached すると
    // 破損した内容がそのままインデックスにステージされてしまっていた
    mockReadFileBuffer.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))
    const result = await getDiff('/project', 'image.png', false, true)
    expect(result).toBe('Binary files /dev/null and b/image.png differ\n')
  })

  it('isUntracked: true で非UTF-8(Shift_JIS等、NULバイトを含まない)の場合、疑似diffを組み立てず "Binary files ... differ" を返す', async () => {
    // NULバイトが無いため isBinaryContent はバイナリと判定しないが、
    // buffer.toString('utf-8') で無条件にデコードすると不正なバイト列が
    // U+FFFD に置換され、それを git apply --cached すると元のファイルとは
    // 異なる(破損した)内容がそのままインデックスにステージされてしまう
    mockReadFileBuffer.mockResolvedValue(Buffer.from([0x82, 0xa0, 0x82, 0xa2])) // "あい" の Shift_JIS
    const result = await getDiff('/project', 'sjis.txt', false, true)
    expect(result).toBe('Binary files /dev/null and b/sjis.txt differ\n')
  })

  it('isUntracked: true でファイルの読み込みが ENOENT で失敗した場合、OS絶対パスを含む生のエラーではなく分かりやすいメッセージに変換する', async () => {
    // untracked 判定と実際のファイル読み込みの間にファイルが削除される等のレースが
    // 起きた場合、readFileBuffer の生の Node エラー(OS絶対パスを含む)が
    // そのまま IPC 経由でレンダラーへ伝播すると、他の fs 系ハンドラが
    // convertFsAccessError で統一している「わかりやすい日本語メッセージ」から外れる
    const enoent = Object.assign(
      new Error("ENOENT: no such file or directory, open '/project/gone.txt'"),
      { code: 'ENOENT' }
    )
    mockReadFileBuffer.mockRejectedValue(enoent)
    await expect(getDiff('/project', 'gone.txt', false, true)).rejects.toThrow(
      'ファイルが見つかりません: gone.txt'
    )
  })

  it('isUntracked: true でファイルの読み込みが ENOENT 以外の fs エラー(EACCES 等)で失敗した場合も、OS絶対パスを含む生のエラーではなく分かりやすいメッセージに変換する', async () => {
    const eacces = Object.assign(
      new Error("EACCES: permission denied, open '/project/locked.txt'"),
      { code: 'EACCES' }
    )
    mockReadFileBuffer.mockRejectedValue(eacces)
    await expect(getDiff('/project', 'locked.txt', false, true)).rejects.toThrow(
      'ファイル操作に失敗しました(EACCES): locked.txt'
    )
  })

  it('diff が throw した場合エラーが伝播する', async () => {
    mockDiff.mockRejectedValue(new Error('diff failed'))
    await expect(getDiff('/project', 'src/index.ts', false, false)).rejects.toThrow('diff failed')
  })

  it('isUntracked: true で readFileBuffer 成功後、isExecutableFile が ENOENT で失敗した場合も、OS絶対パスを含む生のエラーではなく分かりやすいメッセージに変換する', async () => {
    // untracked 判定とファイル読み込みの間だけでなく、読み込み後の
    // isExecutableFile(fs.stat)呼び出しまでの間にもファイルが削除される
    // レースは起こり得る。readFileBuffer だけを convertFsAccessError で
    // 包んでも、isExecutableFile 側の生エラーがそのまま伝播してしまっては
    // 「わかりやすい日本語メッセージ」の統一が崩れる
    mockReadFileBuffer.mockResolvedValue(Buffer.from('#!/bin/sh\n', 'utf-8'))
    const enoent = Object.assign(
      new Error("ENOENT: no such file or directory, stat '/project/run.sh'"),
      { code: 'ENOENT' }
    )
    mockIsExecutableFile.mockRejectedValue(enoent)
    await expect(getDiff('/project', 'run.sh', false, true)).rejects.toThrow(
      'ファイルが見つかりません: run.sh'
    )
  })

  it('isUntracked: true の空ファイルの場合、内部表現ではなく専用メッセージを返す', async () => {
    // 空ファイルはハンク(@@)を持てないため、ヘッダのみの diff を返していたが、
    // DiffView はハンクが無い diff のヘッダ行をそのまま画面に描画するため
    // "diff --git a/x b/x" などの内部表現がユーザーに露出してしまっていた
    mockGetFileSize.mockResolvedValue(0)
    mockReadFileBuffer.mockResolvedValue(Buffer.alloc(0))
    mockIsExecutableFile.mockResolvedValue(false)
    const result = await getDiff('/project', 'empty.txt', false, true)
    expect(result).toBe('空のファイルのため表示する差分はありません: empty.txt\n')
  })

  it('staged: true のときは isUntracked: true が渡されても疑似diffを組み立てず通常の diff を呼ぶ', async () => {
    // ステージ済みの未追跡ファイル(git add 直後)は index 上には存在するため、
    // 通常の --cached diff で正しく差分が取れる。疑似diff経路は未ステージの
    // 未追跡ファイル専用
    mockDiff.mockResolvedValue('diff --git a/new.txt b/new.txt\n@@ -0,0 +1 @@\n+line1\n')
    const result = await getDiff('/project', 'new.txt', true, true)
    expect(mockReadFileBuffer).not.toHaveBeenCalled()
    expect(mockDiff).toHaveBeenCalledWith([
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--cached',
      '-U3',
      '--',
      ':(literal)new.txt'
    ])
    expect(result).toBe('diff --git a/new.txt b/new.txt\n@@ -0,0 +1 @@\n+line1\n')
  })
})

describe('getLog', () => {
  const HASH_1 = 'a'.repeat(40)
  const HASH_2 = 'b'.repeat(40)
  const LOG_ARGS = [
    'log',
    '--topo-order',
    '--no-show-signature',
    '--decorate=full',
    '--decorate-refs=refs/heads/',
    '--decorate-refs=refs/remotes/',
    '--decorate-refs=refs/tags/',
    '--decorate-refs=HEAD',
    '--max-count=20',
    '--skip=0',
    '--pretty=format:%H%x1f%P%x1f%D%x1f%B%x1f%aI%x1f%an%x1e'
  ]
  const UPSTREAM_ARGS = ['rev-parse', '--symbolic-full-name', '@{upstream}']

  // 上流の取得は upstream を返すか、上流が無いときの GitError で失敗する。log は logOutput を返す
  function mockRepoWith(logOutput: string, upstream: string | null = null): void {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockImplementation((args: string[]) => {
      if (args[0] !== 'rev-parse') return Promise.resolve(logOutput)
      if (upstream === null) return Promise.reject(new MockGitError('fatal: no upstream'))
      return Promise.resolve(`${upstream}\n`)
    })
  }

  it('上流が無いときは HEAD だけを指定して git log を呼び、レコードをパースして返す(%B で単一行 subject も取得できる)', async () => {
    mockRepoWith(
      `${HASH_1}\x1f${HASH_2}\x1fHEAD -> refs/heads/main\x1ffeat: 新機能\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e` +
        `${HASH_2}\x1f\x1f\x1ffix: バグ修正\x1f2026-09-02T10:00:00+09:00\x1fBob\x1e`
    )
    const result = await getLog('/project', 20, 0)
    expect(mockRaw).toHaveBeenCalledWith(UPSTREAM_ARGS)
    expect(mockRaw).toHaveBeenCalledWith([...LOG_ARGS, 'HEAD', '--'])
    expect(result).toEqual([
      {
        hash: HASH_1,
        parents: [HASH_2],
        refs: [{ kind: 'current', name: 'main' }],
        isHead: true,
        message: 'feat: 新機能',
        date: '2026-09-03T10:00:00+09:00',
        authorName: 'Alice'
      },
      {
        hash: HASH_2,
        parents: [],
        refs: [],
        isHead: false,
        message: 'fix: バグ修正',
        date: '2026-09-02T10:00:00+09:00',
        authorName: 'Bob'
      }
    ])
  })

  it('上流があるときは HEAD と上流の完全な ref 名を指定する', async () => {
    mockRepoWith('', 'refs/remotes/origin/main')
    await getLog('/project', 20, 0)
    expect(mockRaw).toHaveBeenCalledWith([...LOG_ARGS, 'HEAD', 'refs/remotes/origin/main', '--'])
  })

  it('--max-count と --skip に limit と skip を渡す', async () => {
    mockRepoWith('')
    await getLog('/project', 5, 40)
    const logArgs = mockRaw.mock.calls.map(([args]) => args).find((args) => args[0] === 'log')
    expect(logArgs).toEqual(expect.arrayContaining(['--max-count=5', '--skip=40']))
  })

  it('上流の取得が GitError 以外で失敗したら、上流なしと誤判定せず投げ直す', async () => {
    // git バイナリ不在などを「上流が無い」にすると、原因が分からないまま上流のコミットが消える
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse' ? Promise.reject(new Error('spawn git ENOENT')) : Promise.resolve('')
    )
    await expect(getLog('/project', 20, 0)).rejects.toThrow('spawn git ENOENT')
  })

  it('env() を使わない(simple-git の安全ガードに弾かれて履歴が常に壊れるため)', async () => {
    // env() に環境変数を明示的に渡すと、simple-git の
    // blockUnsafeOperationsPlugin が spawn 前に内容を検査し、EDITOR / PAGER /
    // GIT_EDITOR / GIT_SSH_COMMAND 等が含まれていると GitPluginError を throw する
    // (実機で再現確認済み)。これらはほぼすべての開発者のシェルに設定されており、
    // main プロセスがそのまま継承するため、履歴パネルは常にエラー表示+空になり、
    // lastCommitMessage が null のままで amend チェックボックスも永久に disabled
    // になってしまう
    mockRepoWith('')
    await getLog('/project', 20, 0)
    expect(mockEnv).not.toHaveBeenCalled()
  })

  it('コミットが1件も無い場合、エラーメッセージの文字列一致ではなく rev-parse の成否で判定して空配列を返す', async () => {
    // ロケール依存の文字列一致を避けるため、構造的に判定する。
    // ローカライズされた git でも正しく「コミット無し」と判定できる。
    // rev-parse --verify HEAD が unborn HEAD で失敗する場合、git プロセス自体は
    // 正常に起動して exit code 非0で終わるため GitError になる
    mockCheckIsRepo.mockResolvedValue(true)
    // log も rev-parse も失敗する = HEAD が指すコミットが無い(unborn HEAD)
    mockRaw.mockRejectedValue(new MockGitError('fatal: Needed a single revision'))
    const result = await getLog('/project', 20, 0)
    expect(result).toEqual([])
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '--verify', 'HEAD'])
  })

  it('rev-parse が GitError 以外の理由(git バイナリ不在等)で失敗した場合、unborn HEAD と誤判定せず元の log 失敗を伝播する', async () => {
    // rev-parse --verify HEAD が失敗したというだけで無条件に「コミット無し」と
    // 判定すると、rev-parse も log と同じ根本原因(git が PATH に無い等)で
    // 失敗しているケースまで空配列に変換してしまい、コメントが明記する
    // 「コミット無し以外のエラーは握りつぶさず伝播する」という意図に反する。
    // GitError でない失敗(spawn レベルの異常)は unborn HEAD ではないので、
    // 元の log 失敗のエラーをそのまま投げる必要がある
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockRejectedValue(new Error('spawn git ENOENT'))
    await expect(getLog('/project', 20, 0)).rejects.toThrow('spawn git ENOENT')
  })

  it('%B で取得した複数行のコミット本文を、内部の改行を保ったまま message として返す', async () => {
    // amend 時にこの message をそのままメッセージ欄へ入れるため、%s（subject 1行のみ）
    // ではなく %B（本文全体）で取得できていることを検証する
    mockRepoWith(
      `${HASH_1}\x1f\x1f\x1ffeat: 新機能\n\n詳細な説明文\n2行目\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e`
    )
    const [entry] = await getLog('/project', 20, 0)
    expect(entry.message).toBe('feat: 新機能\n\n詳細な説明文\n2行目')
  })

  it('コミットが無いリポジトリで raw が throw した場合、空配列を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockRejectedValue(
      new MockGitError('fatal: your current branch does not have any commits yet')
    )
    const result = await getLog('/project', 20, 0)
    expect(result).toEqual([])
  })

  it('コミット無し以外のエラー(git 未検出等)は握りつぶさず伝播する', async () => {
    // 「コミットが無い」以外の全エラーを空配列にすると、Windows で git が PATH に
    // 無い場合やリポジトリ破損時にも履歴パネルが静かに「コミットなし」と表示され、
    // ユーザーに実際の問題が伝わらない
    mockCheckIsRepo.mockResolvedValue(true)
    // log は失敗するが rev-parse は成功する = コミットは存在するので、
    // log の失敗は「コミット無し」ではない別の問題として伝播させる
    mockRaw.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? Promise.resolve('abc123')
        : Promise.reject(new Error('spawn git ENOENT'))
    )
    await expect(getLog('/project', 20, 0)).rejects.toThrow('spawn git ENOENT')
  })

  it('git 管理外のフォルダ(checkIsRepo が false)では raw を呼ばず空配列を返す', async () => {
    // 「リポジトリでない」の判定は、git の生エラーメッセージへの文字列一致
    // (将来の git バージョンやロケール差異で揺らぎうる)ではなく、simple-git の
    // checkIsRepo() という構造的な API に委ねる(getGitStatus と同じ判定方法)。
    // getBranches/getTags は non-repo フォルダで throw しても呼び出し元
    // (useGitHistory)が .catch(() => []) で空配列に変換して正常系として扱うため、
    // getLog だけ非対称に扱うと非gitフォルダを開いただけで historyError が
    // セットされてしまう
    mockCheckIsRepo.mockResolvedValue(false)
    const result = await getLog('/not-a-repo', 20, 0)
    expect(mockRaw).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })
})

describe('getHeadCommitMessage', () => {
  const LOG_ARGS = ['log', '-1', '--no-show-signature', '--pretty=format:%B', 'HEAD', '--']

  it('HEAD の %B を trim して返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockResolvedValue('feat: 新機能\n\n本文\n\n')
    await expect(getHeadCommitMessage('/project')).resolves.toBe('feat: 新機能\n\n本文')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockRaw).toHaveBeenCalledWith(LOG_ARGS)
  })

  it('空のメッセージのコミットは null ではなく空文字を返す(amend できる)', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockResolvedValue('\n')
    await expect(getHeadCommitMessage('/project')).resolves.toBe('')
  })

  it('リポジトリでなければ log を呼ばず null を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    mockRaw.mockClear()
    await expect(getHeadCommitMessage('/not-a-repo')).resolves.toBeNull()
    expect(mockRaw).not.toHaveBeenCalled()
  })

  it('コミットが無いときは rev-parse の失敗で判定して null を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockRejectedValue(new MockGitError('fatal: Needed a single revision'))
    await expect(getHeadCommitMessage('/project')).resolves.toBeNull()
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '--verify', 'HEAD'])
  })

  it('コミットがあるのに log が失敗したら投げ直す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockImplementation((args: string[]) =>
      args[0] === 'rev-parse'
        ? Promise.resolve('abc123')
        : Promise.reject(new MockGitError('fatal: bad object HEAD'))
    )
    await expect(getHeadCommitMessage('/project')).rejects.toThrow('fatal: bad object HEAD')
  })

  it('rev-parse が GitError 以外で失敗したら、コミット無しと誤判定せず log の失敗を投げ直す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockImplementation((args: string[]) =>
      Promise.reject(new Error(args[0] === 'rev-parse' ? 'rev-parse failed' : 'spawn git ENOENT'))
    )
    await expect(getHeadCommitMessage('/project')).rejects.toThrow('spawn git ENOENT')
  })
})

describe('getBranches', () => {
  beforeEach(() => {
    mockRaw.mockReset()
  })

  it('branchLocal の結果を GitBranch[] に変換する', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    mockRaw.mockResolvedValue('refs/heads/main\n')
    const result = await getBranches('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    // 印の欄そのものが無いことまで固定する(toEqual は undefined の欄を区別しない)
    expect(result).toStrictEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false }
    ])
  })

  // branchLocal の detached は rebase 中・bisect 中に false になるため、判定に使わない
  it('ブランチ上にいなければ、branchLocal の detached が false でも現在の項目に印を付ける', async () => {
    mockBranchLocal.mockResolvedValue({
      all: ['(no', 'main'],
      current: '(no',
      detached: false
    })
    mockRaw.mockResolvedValue('')
    await expect(getBranches('/project')).resolves.toStrictEqual([
      { name: '(no', current: true, isDetachedHead: true },
      { name: 'main', current: false }
    ])
  })

  it('ブランチ上にいれば、branchLocal の detached が true でも印を付けない', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main', detached: true })
    mockRaw.mockResolvedValue('refs/heads/main\n')
    await expect(getBranches('/project')).resolves.toStrictEqual([{ name: 'main', current: true }])
  })
})

describe('getTags', () => {
  it('tags の結果を string[] で返す', async () => {
    mockTags.mockResolvedValue({ all: ['v1.0.0', 'v1.1.0'] })
    const result = await getTags('/project')
    expect(result).toEqual(['v1.0.0', 'v1.1.0'])
  })
})

describe('amendCommit', () => {
  beforeEach(() => {
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('')
  })

  // マージ中の amend は git が 'You are in the middle of a merge -- cannot amend.' の英語で失敗する
  it('マージ中(MERGE_HEAD あり)は commit せずに日本語で拒否する', async () => {
    mockRaw.mockResolvedValue('abc123\n')
    await expect(amendCommit('/project', 'msg')).rejects.toThrow(
      'マージ中のためコミットを修正できません。マージを完了または中止してください'
    )
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(mockCommit).not.toHaveBeenCalled()
  })

  it("simpleGit を folderPath で呼び、'--amend' は files ではなくオプション引数で渡す", async () => {
    // simple-git の commit(message, files, options) は
    // ['commit', '-m', msg, ...files, ...options] を組み立てる。'--amend' を
    // files スロットに渡すと、今は git がオプションを位置に関係なく解釈するため
    // 動くが、simple-git が他タスクと同様に files の前へ '--' を挿入する実装に
    // 変われば `git commit -m msg -- --amend` となり、amend ではなく
    // 「--amend という名前のファイル」を対象にした新規コミットに静かに化ける
    mockCommit.mockResolvedValue(undefined)
    await amendCommit('/project', 'feat: 修正後のメッセージ')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCommit).toHaveBeenCalledWith('feat: 修正後のメッセージ', undefined, {
      '--amend': null
    })
  })

  it('commit が throw した場合エラーが伝播する', async () => {
    mockCommit.mockRejectedValue(new Error('amend failed'))
    await expect(amendCommit('/project', 'msg')).rejects.toThrow('amend failed')
  })
})

// push/pull/fetch はネットワークI/Oを伴う。認証プロンプト待ち(認証情報未設定で
// 端末から起動した場合、git が /dev/tty を開いてプロンプトを出し誰も応答しない)や
// 到達不能なホストへの接続では、タイムアウトが無いと simple-git の Promise が
// 永久に解決せず、useGitRemoteOperations.ts の isPushing/isPulling/isFetching が
// true のまま戻らずボタンが恒久的に disabled のまま固まる(pull の場合は
// lock.lockGlobal() も解除されず commit/ハンク操作まで巻き添えになる)。
// simple-git 標準の timeout プラグイン(stdout/stderr に一定時間データが来ないと
// 強制終了する)を使う。env() 経由で GIT_TERMINAL_PROMPT 等を渡す方式は、
// blockUnsafeOperationsPlugin が GIT_SSH_COMMAND 等の継承環境変数を検査して
// GitPluginError を投げる既存の地雷(getLog 参照)を再び踏むため採用しない。
// progress オプション(no-op)も必須で渡す。渡さないと --progress が付与されず、
// 実際に転送中の正常な操作でも stderr に進捗が流れないため誤ってタイムアウトする
const GIT_REMOTE_TIMEOUT_MS = 30_000

describe('push', () => {
  it('simpleGit を folderPath とタイムアウト設定で呼び、push を引数なしで呼ぶ', async () => {
    mockPush.mockResolvedValue(undefined)
    await push('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
    expect(mockPush).toHaveBeenCalledWith()
  })

  it('push が throw した場合エラーが伝播する', async () => {
    mockPush.mockRejectedValue(new Error('push failed'))
    await expect(push('/project')).rejects.toThrow('push failed')
  })

  it('push がタイムアウト(GitPluginError, plugin: timeout)で失敗した場合、わかりやすい日本語メッセージに変換される', async () => {
    // 実際の timeoutPlugin は plugin: 'timeout' の GitPluginError を投げる
    // ("block timeout reached" という固定の英語メッセージ)。ユーザーには
    // 内部実装の文字列ではなく、原因の推測とセットの日本語メッセージを見せる
    mockPush.mockRejectedValue(
      new MockGitPluginError(undefined, 'timeout', 'block timeout reached')
    )
    await expect(push('/project')).rejects.toThrow(
      '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'
    )
  })

  it('push が GitPluginError(timeout 以外の plugin)で失敗した場合、元のエラーをそのまま伝播する', async () => {
    mockPush.mockRejectedValue(
      new MockGitPluginError(undefined, 'spawn.after', 'some other plugin error')
    )
    await expect(push('/project')).rejects.toThrow('some other plugin error')
  })
})

describe('pull', () => {
  beforeEach(() => {
    // 既定はマージ中ではない(MERGE_HEAD が無いと rev-parse -q --verify は空文字で resolve する)
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('')
    mockPull.mockReset()
    mockStatus.mockReset()
    mockStatus.mockResolvedValue({ conflicted: [] })
  })

  it('コンフリクトが無ければ conflicted: false を返す', async () => {
    mockPull.mockResolvedValue(undefined)
    await expect(pull('/project')).resolves.toEqual({ conflicted: false })
  })

  it('pull が例外を投げなくても、status にコンフリクトがあれば conflicted: true を返す', async () => {
    mockPull.mockResolvedValue(undefined)
    mockStatus.mockResolvedValue({ conflicted: ['a.txt'] })
    await expect(pull('/project')).resolves.toEqual({ conflicted: true })
  })

  it('pull が例外を投げ、status にコンフリクトがあれば、その文言を付けて conflicted: true を返す', async () => {
    mockPull.mockRejectedValue(new Error('CONFLICT (content)'))
    mockStatus.mockResolvedValue({ conflicted: ['a.txt'] })
    await expect(pull('/project')).resolves.toEqual({
      conflicted: true,
      errorMessage: 'CONFLICT (content)'
    })
  })

  it('pull の例外の後に status も失敗したら、pull のエラーを伝える', async () => {
    mockPull.mockRejectedValue(new Error('pull failed'))
    mockStatus.mockRejectedValue(new Error('status failed'))
    await expect(pull('/project')).rejects.toThrow('pull failed')
  })

  // コンフリクトの有無が分からないまま成功として返すと、同期がプッシュへ進んでしまう
  it('pull の成功の後に status が失敗したら、成功として返さない', async () => {
    mockPull.mockResolvedValue(undefined)
    mockStatus.mockRejectedValue(new Error('status failed'))
    await expect(pull('/project')).rejects.toThrow(
      'プルは完了しましたが、コンフリクトの確認に失敗しました: status failed'
    )
  })

  it('simpleGit を folderPath とタイムアウト設定で呼び、pull を引数なしで呼ぶ', async () => {
    mockPull.mockResolvedValue(undefined)
    await pull('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
    expect(mockPull).toHaveBeenCalledWith()
  })

  it('マージ中(MERGE_HEAD あり)は pull を呼ばずに日本語で拒否する', async () => {
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('abc123\n')
    await expect(pull('/project')).rejects.toThrow(
      'マージ中のため pull できません。マージを完了または中止してください'
    )
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(mockPull).not.toHaveBeenCalled()
  })

  it('pull が throw した場合エラーが伝播する', async () => {
    mockPull.mockRejectedValue(new Error('pull failed'))
    await expect(pull('/project')).rejects.toThrow('pull failed')
  })

  it('pull がタイムアウト(GitPluginError, plugin: timeout)で失敗した場合、わかりやすい日本語メッセージに変換される', async () => {
    mockPull.mockRejectedValue(
      new MockGitPluginError(undefined, 'timeout', 'block timeout reached')
    )
    await expect(pull('/project')).rejects.toThrow(
      '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'
    )
  })
})

describe('fetchRemote', () => {
  it('simpleGit を folderPath とタイムアウト設定で呼び、fetch を引数なしで呼ぶ', async () => {
    mockFetch.mockResolvedValue(undefined)
    await fetchRemote('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
    expect(mockFetch).toHaveBeenCalledWith()
  })

  it('fetch が throw した場合エラーが伝播する', async () => {
    mockFetch.mockRejectedValue(new Error('fetch failed'))
    await expect(fetchRemote('/project')).rejects.toThrow('fetch failed')
  })

  it('fetch がタイムアウト(GitPluginError, plugin: timeout)で失敗した場合、わかりやすい日本語メッセージに変換される', async () => {
    mockFetch.mockRejectedValue(
      new MockGitPluginError(undefined, 'timeout', 'block timeout reached')
    )
    await expect(fetchRemote('/project')).rejects.toThrow(
      '操作がタイムアウトしました。認証情報が未設定か、ネットワークに問題がある可能性があります'
    )
  })
})

describe('checkoutBranch', () => {
  beforeEach(() => {
    // 既定はマージ中ではない(MERGE_HEAD が無いと rev-parse -q --verify は空文字で resolve する)
    mockRaw.mockReset()
    mockRaw.mockResolvedValue('')
  })

  // マージ中に切り替えると、解決済みの内容が切り替え先と一致するとき MERGE_HEAD ごと
  // マージ中の状態が黙って失われる(実機で確認)。git に渡す前に拒否する
  it('マージ中(MERGE_HEAD あり)は checkout を呼ばずに拒否する', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    mockRaw.mockResolvedValue('abc123\n')
    await expect(checkoutBranch('/project', 'feature/x')).rejects.toThrow(
      'マージ中のためブランチを切り替えられません。マージを完了または中止してください'
    )
    expect(mockRaw).toHaveBeenCalledWith(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(mockCheckout).not.toHaveBeenCalled()
  })

  it('simpleGit を folderPath で呼び、実在するブランチ名なら checkout を branchName で呼ぶ', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    mockCheckout.mockResolvedValue(undefined)
    await checkoutBranch('/project', 'feature/x')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockCheckout).toHaveBeenCalledWith('feature/x')
  })

  it('checkout が throw した場合エラーがそのまま伝播する', async () => {
    // 未コミットの変更が切り替え先ブランチと衝突する場合など、simple-git は
    // 通常の GitError(GitPluginError ではない)を投げる。これは push/pull/fetch の
    // タイムアウトエラーとは異なり、gitコマンド自体が返す情報がユーザーにとって
    // 意味のある内容(「ローカルの変更が上書きされる」等)なので、独自メッセージへの
    // 変換はせず素通しする
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    mockCheckout.mockRejectedValue(
      new Error('Your local changes to the following files would be overwritten by checkout')
    )
    await expect(checkoutBranch('/project', 'feature/x')).rejects.toThrow(
      'Your local changes to the following files would be overwritten by checkout'
    )
  })

  // コードレビュー指摘: branchName は checkout() の positional 引数として git へ
  // そのまま渡る。simple-git はシェル経由で spawn しないためシェルインジェクションは
  // 起きないが、'-' で始まる文字列は git 自身にオプションとして解釈されてしまう
  // (例: '--orphan' で意図しない孤立ブランチが作られる)。UI は必ず getBranches() が
  // 返した実在のローカルブランチ名からのみ選択させているため実害は無いが、
  // IPC 境界(gitHandlers.ts)は任意の文字列を受け付けてしまうため、gitService 層で
  // 許可リスト方式(実在するローカルブランチ名のみ)で検証する
  it('存在しないブランチ名を渡すと checkout を呼ばずにエラーを投げる', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    await expect(checkoutBranch('/project', '--orphan')).rejects.toThrow(
      '存在しないブランチです: --orphan'
    )
    expect(mockCheckout).not.toHaveBeenCalled()
  })
})

describe('createBranch', () => {
  // check-ref-format --branch は成功時に正規化後の名前を出力する(実機 git 2.50.1 で確認)
  const mockCheckRefFormatOk = (name: string): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'check-ref-format') return `${name}\n`
      // MERGE_HEAD が無いと rev-parse -q --verify は空文字で resolve する
      if (args[0] === 'rev-parse') return ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

  // マージ中に作成して切り替えると MERGE_HEAD ごとマージ中の状態が黙って失われる(実機で確認)。
  // ブランチ名の検証の後、ブランチを作る git 呼び出しの前に拒否する
  it('マージ中(MERGE_HEAD あり)は checkoutLocalBranch を呼ばずに拒否する', async () => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'check-ref-format') return 'feature/new\n'
      if (args[0] === 'rev-parse') return 'abc123\n'
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    await expect(createBranch('/project', 'feature/new')).rejects.toThrow(
      'マージ中のためブランチを切り替えられません。マージを完了または中止してください'
    )
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  // 空文字は check-ref-format に渡す前に弾く(@shared/branchName の規則)
  it('空文字は git を一切呼ばずに拒否する', async () => {
    await expect(createBranch('/project', '')).rejects.toThrow(
      'ブランチ名として使用できない名前です: '
    )
    expect(mockRaw).not.toHaveBeenCalled()
    expect(mockBranchLocal).not.toHaveBeenCalled()
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  it('検証を通過したら checkoutLocalBranch を branchName で呼ぶ', async () => {
    mockCheckRefFormatOk('feature/new')
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    mockCheckoutLocalBranch.mockResolvedValue(undefined)
    await createBranch('/project', 'feature/new')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockRaw).toHaveBeenCalledWith(['check-ref-format', '--branch', 'feature/new'])
    expect(mockCheckoutLocalBranch).toHaveBeenCalledWith('feature/new')
  })

  // '-' 始まりは check-ref-format 自体にオプションとして解釈されるため、
  // git に渡す前に弾く(docs/review-findings-patterns.md パターン21)
  it("'-' で始まる名前は git を一切呼ばずに拒否する", async () => {
    await expect(createBranch('/project', '--orphan')).rejects.toThrow(
      '`-` で始まるブランチ名は使用できません: --orphan'
    )
    expect(mockRaw).not.toHaveBeenCalled()
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  // git checkout @ は '@' をブランチ名ではなく HEAD の別名として解釈するため、
  // checkoutBranch('@') は exit 0 のまま何もせず現在のブランチに留まる
  // (実機 git 2.50.1 で確認)。check-ref-format --branch @ 自体は '@' を出力して
  // 成功するため、check-ref-format 側の検証だけでは弾けない
  it("'@' のみの名前は git を一切呼ばずに拒否する", async () => {
    await expect(createBranch('/project', '@')).rejects.toThrow(
      'ブランチ名として使用できない名前です: @'
    )
    expect(mockRaw).not.toHaveBeenCalled()
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  // 検証の順序: 形式(check-ref-format)が不正なら、重複チェック(branchLocal)にも作成にも進まない
  it('check-ref-format が失敗したら日本語エラーにし、branchLocal も checkoutLocalBranch も呼ばない', async () => {
    mockRaw.mockRejectedValue(new MockGitError("fatal: 'a..b' is not a valid branch name"))
    await expect(createBranch('/project', 'a..b')).rejects.toThrow(
      'ブランチ名として使用できない名前です: a..b'
    )
    expect(mockBranchLocal).not.toHaveBeenCalled()
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  // check-ref-format --branch は '@{-1}' を直前のブランチ名へ展開して成功扱いにする
  // (実機で '@{-1}' → 'topic' を確認)。出力が入力と一致しない名前は拒否する
  it('check-ref-format の出力が入力と一致しない(@{-1} 等の展開)場合は拒否する', async () => {
    mockRaw.mockResolvedValue('topic\n')
    await expect(createBranch('/project', '@{-1}')).rejects.toThrow(
      'ブランチ名として使用できない名前です: @{-1}'
    )
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  it('同名のローカルブランチが既にあれば拒否する', async () => {
    mockCheckRefFormatOk('main')
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    await expect(createBranch('/project', 'main')).rejects.toThrow(
      '同じ名前のブランチが既に存在します: main'
    )
    expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
  })

  // refs/heads 配下はディレクトリ構造のため親子になる名前は共存できない。checkout -b まで
  // 進むと git の英語エラー(`cannot lock ref ...`)がそのままバナーに出てしまう
  it.each([
    ['main/sub', ['main'], 'main'],
    ['feature', ['main', 'feature/x'], 'feature/x']
  ])(
    '%s は既存ブランチと階層が衝突するため日本語エラーにして作成しない',
    async (name, all, conflicting) => {
      mockCheckRefFormatOk(name)
      mockBranchLocal.mockResolvedValue({ all, current: 'main' })
      await expect(createBranch('/project', name)).rejects.toThrow(
        `既存のブランチ ${conflicting} と名前が衝突します: ${name}`
      )
      expect(mockCheckoutLocalBranch).not.toHaveBeenCalled()
    }
  )

  it('checkoutLocalBranch が throw した場合エラーがそのまま伝播する', async () => {
    mockCheckRefFormatOk('feature/new')
    mockBranchLocal.mockResolvedValue({ all: ['main'], current: 'main' })
    mockCheckoutLocalBranch.mockRejectedValue(new Error('checkout -b failed'))
    await expect(createBranch('/project', 'feature/new')).rejects.toThrow('checkout -b failed')
  })
})

describe('deleteBranch', () => {
  // raw() の呼び出しを「コマンドの先頭引数 → 戻り値」で振り分ける。
  // 実機の出力形式(実機 git 2.50.1 で確認)の根拠は、gitService.ts の isBranchMerged と
  // gitWorktreeParser.ts 冒頭のコメントを参照
  const setupRaw = (outputs: {
    worktree?: string
    upstream?: string
    revParse?: string
    merged?: string
  }): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'worktree')
        return outputs.worktree ?? 'worktree /project\nHEAD abc\nbranch refs/heads/main\n'
      if (args[0] === 'for-each-ref' && args[1] === '--format=%(upstream)')
        return outputs.upstream ?? '\n'
      if (args[0] === 'rev-parse') return outputs.revParse ?? ''
      if (args[0] === 'for-each-ref' && args[1].startsWith('--merged=')) return outputs.merged ?? ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

  beforeEach(() => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    mockDeleteLocalBranch.mockResolvedValue({ branch: 'feature/x', hash: 'abc', success: true })
  })

  it('存在しないブランチ名は git の削除を呼ばずに拒否する', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', '--force', false)).rejects.toThrow(
      '存在しないブランチです: --force'
    )
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  it('現在のブランチは拒否する', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', 'main', true)).rejects.toThrow(
      '現在のブランチは削除できません: main'
    )
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  // 別 worktree で使用中のブランチの削除失敗は、未マージの失敗と同じ
  // `error: ... '<name>'` 形式になり区別できない(実機で確認)。事前に弾かないと
  // 「強制削除しますか？」と誤って聞いてしまう
  it('別の worktree でチェックアウトされているブランチは拒否する', async () => {
    setupRaw({
      worktree:
        'worktree /project\nHEAD abc\nbranch refs/heads/main\n\n' +
        'worktree /other\nHEAD def\nbranch refs/heads/feature/x\n'
    })
    await expect(deleteBranch('/project', 'feature/x', true)).rejects.toThrow(
      '他のワークツリーで使用中のブランチは削除できません: feature/x'
    )
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  it('存在しないブランチなら worktree 一覧を取得しない', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', 'nope', false)).rejects.toThrow()
    expect(mockRaw).not.toHaveBeenCalledWith(['worktree', 'list', '--porcelain'])
  })

  it('upstream が無くマージ済み(HEAD 基準)なら安全削除して deleted: true を返す', async () => {
    setupRaw({ upstream: '\n', merged: 'refs/heads/feature/x\n' })
    await expect(deleteBranch('/project', 'feature/x', false)).resolves.toEqual({ deleted: true })
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=HEAD',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
    expect(mockDeleteLocalBranch).toHaveBeenCalledWith('feature/x', false)
  })

  it('未マージなら削除を呼ばずに not-fully-merged を返す', async () => {
    setupRaw({ upstream: '\n', merged: '' })
    await expect(deleteBranch('/project', 'feature/x', false)).resolves.toEqual({
      deleted: false,
      reason: 'not-fully-merged'
    })
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  it('upstream が設定され実在すれば、upstream を基準にマージ判定する', async () => {
    setupRaw({
      upstream: 'refs/remotes/origin/feature/x\n',
      revParse: 'abc123\n',
      merged: 'refs/heads/feature/x\n'
    })
    await expect(deleteBranch('/project', 'feature/x', false)).resolves.toEqual({ deleted: true })
    expect(mockRaw).toHaveBeenCalledWith([
      'rev-parse',
      '--verify',
      '--quiet',
      'refs/remotes/origin/feature/x'
    ])
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=refs/remotes/origin/feature/x',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
  })

  it('upstream が設定され実在しても、upstream 基準で未マージなら削除せず not-fully-merged を返す', async () => {
    setupRaw({
      upstream: 'refs/remotes/origin/feature/x\n',
      revParse: 'abc123\n',
      merged: ''
    })
    await expect(deleteBranch('/project', 'feature/x', false)).resolves.toEqual({
      deleted: false,
      reason: 'not-fully-merged'
    })
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=refs/remotes/origin/feature/x',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
    expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
  })

  // git 本体も upstream の ref が解決できなければ HEAD にフォールバックする
  it('upstream が設定されていても ref が消えていれば HEAD を基準にする', async () => {
    setupRaw({
      upstream: 'refs/remotes/origin/gone\n',
      revParse: '',
      merged: 'refs/heads/feature/x\n'
    })
    await deleteBranch('/project', 'feature/x', false)
    expect(mockRaw).toHaveBeenCalledWith([
      'for-each-ref',
      '--merged=HEAD',
      '--format=%(refname)',
      'refs/heads/feature/x'
    ])
  })

  it('force が true ならマージ判定をせずに強制削除する', async () => {
    setupRaw({})
    await expect(deleteBranch('/project', 'feature/x', true)).resolves.toEqual({ deleted: true })
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['rev-parse']))
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['--format=%(upstream)']))
    expect(mockDeleteLocalBranch).toHaveBeenCalledWith('feature/x', true)
  })

  it('削除コマンドが throw した場合エラーがそのまま伝播する', async () => {
    setupRaw({ upstream: '\n', merged: 'refs/heads/feature/x\n' })
    mockDeleteLocalBranch.mockRejectedValue(new Error('delete failed'))
    await expect(deleteBranch('/project', 'feature/x', false)).rejects.toThrow('delete failed')
  })
})

describe('mergeBranch', () => {
  // raw() の呼び出しを種類で振り分ける。MERGE_HEAD の問い合わせは呼ばれるたびに
  // mergeHead の先頭から順に返す(1 回目: 事前検証、2 回目: マージ後の判定)。
  // simple-git は終了コードが非 0 でも stderr が空なら reject しないため、
  // コンフリクト時の merge は空文字で resolve する(実機で確認)
  const setupRaw = (opts: {
    mergeHead?: string[]
    dirty?: string
    conflicted?: string
    merge?: () => Promise<string>
    abortError?: Error
    // `<name>^{commit}` の解決先と、for-each-ref で得るブランチ先端。
    // 既定は同じ SHA(同名のタグ等が無い状態)
    resolved?: string
    branchTip?: string
    // for-each-ref の出力そのもの(指定すると branchTip より優先)
    forEachRef?: string
    // `symbolic-ref -q HEAD` の出力。既定はブランチ上。ブランチ上にいない状態(detached・rebase 中・
    // bisect 中)は、-q により終了コード 1・stderr 空で終わり simple-git が空文字で resolve する
    headRef?: string
  }): void => {
    const mergeHead = [...(opts.mergeHead ?? ['', ''])]
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'symbolic-ref') return opts.headRef ?? 'refs/heads/main\n'
      if (args[0] === 'for-each-ref') {
        const refName = args[args.length - 1]
        return opts.forEachRef ?? `${refName} ${(opts.branchTip ?? 'sha1\n').trim()}\n`
      }
      if (args[0] === 'rev-parse' && args.some((a) => a.endsWith('^{commit}'))) {
        return opts.resolved ?? 'sha1\n'
      }
      if (args[0] === 'rev-parse') return mergeHead.shift() ?? ''
      if (args[0] === 'status') return opts.dirty ?? ''
      if (args[0] === 'diff') return opts.conflicted ?? ''
      if (args[0] === 'merge' && args[1] === '--abort') {
        if (opts.abortError !== undefined) throw opts.abortError
        return ''
      }
      if (args[0] === 'merge') return opts.merge !== undefined ? opts.merge() : ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }
  const rawCalls = (): string[][] => mockRaw.mock.calls.map((call) => call[0] as string[])
  const mergeWasCalled = (): boolean =>
    rawCalls().some((a) => a[0] === 'merge' && a[1] !== '--abort')
  const abortWasCalled = (): boolean =>
    rawCalls().some((a) => a[0] === 'merge' && a[1] === '--abort')

  beforeEach(() => {
    mockBranchLocal.mockResolvedValue({
      all: ['main', 'feature/x'],
      current: 'main'
    })
  })

  // simple-git の summary.detached は rebase・bisect 中を検出しないため使わず、
  // symbolic-ref が空(ブランチ上にいない)かで判定する
  it('symbolic-ref が空を返したら(ブランチ上にいない)拒否し、merge を呼ばない', async () => {
    setupRaw({ headRef: '' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'ブランチをチェックアウトしてからマージしてください'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('マージに成功したら merged の結果を返す', async () => {
    setupRaw({})
    await expect(mergeBranch('/project', 'feature/x')).resolves.toEqual({ status: 'merged' })
  })

  it('ブランチ上にいるかを git symbolic-ref -q HEAD で問い合わせる', async () => {
    setupRaw({})
    await mergeBranch('/project', 'feature/x')
    expect(rawCalls()).toContainEqual(['symbolic-ref', '-q', 'HEAD'])
  })

  // 検証の順序を固定する: ブランチ上にいない状態では、以降の判定には進まない
  it('ブランチ上にいない状態と自身のマージが同時に真なら、ブランチ上にいないエラーで拒否する', async () => {
    setupRaw({ headRef: '' })
    await expect(mergeBranch('/project', 'main')).rejects.toThrow(
      'ブランチをチェックアウトしてからマージしてください'
    )
    expect(rawCalls().some((a) => a[0] === 'for-each-ref')).toBe(false)
  })

  it('現在のブランチ自身は拒否する', async () => {
    setupRaw({})
    await expect(mergeBranch('/project', 'main')).rejects.toThrow(
      '現在のブランチ自身はマージできません: main'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('マージ中(MERGE_HEAD がある)なら拒否する', async () => {
    setupRaw({ mergeHead: ['0123abcd\n'] })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'マージ中のため実行できません'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('追跡済みファイルに未コミットの変更があれば拒否する(--untracked-files=no で問い合わせる)', async () => {
    setupRaw({ dirty: ' M a.txt\0' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '未コミットの変更があるためマージできません。先にコミットしてください'
    )
    expect(rawCalls()).toContainEqual(['status', '--porcelain', '-z', '--untracked-files=no'])
    expect(mergeWasCalled()).toBe(false)
  })

  // 検証の順序を固定する: 前の検証に失敗したら後の git 呼び出しには進まない
  it('同名のタグの曖昧さとマージ中が同時に真なら、同名タグのエラーで MERGE_HEAD の問い合わせより先に拒否する', async () => {
    setupRaw({ mergeHead: ['0123abcd\n'], resolved: 'tagsha\n', branchTip: 'sha1\n' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature/x'
    )
    expect(rawCalls()).not.toContainEqual(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    expect(mergeWasCalled()).toBe(false)
  })

  it('マージ中と未コミットの変更が同時に真なら、マージ中のエラーで status を呼ばずに拒否する', async () => {
    setupRaw({ mergeHead: ['0123abcd\n'], dirty: ' M a.txt\0' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'マージ中のため実行できません'
    )
    expect(rawCalls().some((a) => a[0] === 'status')).toBe(false)
  })

  it('方式を固定して呼ぶ(branch.<name>.mergeoptions の --squash / --no-commit に左右されない)。成功したら中止はしない', async () => {
    setupRaw({})
    await mergeBranch('/project', 'feature/x')
    expect(rawCalls()).toContainEqual([
      'merge',
      '--no-edit',
      '--commit',
      '--no-squash',
      'feature/x'
    ])
    expect(abortWasCalled()).toBe(false)
  })

  // git が何も変えずに失敗した場合(無関係な履歴の拒否、上書きされる未追跡ファイル、
  // コミッター情報なし等)は MERGE_HEAD が残らない。中止はせず、git のエラーをそのまま投げる
  it('merge が失敗し MERGE_HEAD が無ければ、中止せずに git のエラーをそのまま投げる', async () => {
    const gitError = new Error('fatal: refusing to merge unrelated histories')
    setupRaw({
      merge: async () => {
        throw gitError
      }
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toBe(gitError)
    expect(abortWasCalled()).toBe(false)
  })

  // コンフリクトでは git は終了コード 1 で stderr が空のため、simple-git は reject せず
  // resolve する。例外の有無ではなく MERGE_HEAD の有無で判定する(パターン28)。
  // 未解決ファイルがあるときは中止せず、解決か中止を促すエラーを投げて途中の状態を残す
  it('merge が resolve しても MERGE_HEAD が残り未解決があれば、中止せずに未解決ファイルを示して投げる', async () => {
    setupRaw({ mergeHead: ['', 'abc123\n'], conflicted: 'a.txt\0b.txt\0' })
    await expect(mergeBranch('/project', 'feature/x')).resolves.toEqual({
      status: 'conflict',
      message: 'コンフリクトしました（a.txt, b.txt）。解決するか、マージを中止してください'
    })
    expect(rawCalls()).toContainEqual(['diff', '--name-only', '-z', '--diff-filter=U'])
    expect(abortWasCalled()).toBe(false)
  })

  it('merge が reject しても MERGE_HEAD が残り未解決があれば、同じく中止せずに投げる', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: 'a.txt\0',
      merge: async () => {
        throw new Error('CONFLICT')
      }
    })
    await expect(mergeBranch('/project', 'feature/x')).resolves.toEqual({
      status: 'conflict',
      message: 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
    })
    expect(abortWasCalled()).toBe(false)
  })

  it('未解決ファイルが 6 件以上なら「ほか N 件」にまとめる', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: Array.from({ length: 6 }, (_, i) => `f${i + 1}.txt\0`).join('')
    })
    await expect(mergeBranch('/project', 'feature/x')).resolves.toEqual({
      status: 'conflict',
      message:
        'コンフリクトしました（f1.txt, f2.txt, f3.txt, f4.txt, f5.txt ほか 1 件）。解決するか、マージを中止してください'
    })
  })

  // pre-merge-commit フックの失敗等、コンフリクト以外でも MERGE_HEAD が残る(実機で確認)。
  // 未解決のファイルは無いが、途中の状態を残さないよう中止する
  it('未解決ファイルが無いまま MERGE_HEAD が残っていれば、中止して git のエラーを添える', async () => {
    setupRaw({
      mergeHead: ['', 'abc123\n'],
      conflicted: '',
      merge: async () => {
        throw new Error('hook failed')
      }
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      'マージを完了できなかったため中止しました: hook failed'
    )
    expect(abortWasCalled()).toBe(true)
  })

  it('未解決ファイルが無く、中止自体が失敗したら、その git のエラーをそのまま投げる', async () => {
    const abortError = new Error('abort failed')
    setupRaw({ mergeHead: ['', 'abc123\n'], conflicted: '', abortError })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toBe(abortError)
    // 中止の前に未解決ファイルを取得して 0 件と判定している
    expect(rawCalls().some((a) => a[0] === 'diff')).toBe(true)
    expect(abortWasCalled()).toBe(true)
  })

  // 同名のタグがあると git は refs/tags を優先し、警告だけで終了コード 0 になる(実機で確認)。
  // 選んでいないコミットをマージして成功扱いにしないよう、名前の解決先がブランチの先端と
  // 食い違えば git のマージを呼ばずに拒否する
  it('名前の解決先がブランチの先端と違えば(同名のタグ等)、マージを呼ばずに拒否する', async () => {
    setupRaw({ resolved: 'tag-sha\n', branchTip: 'branch-sha\n' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature/x'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('名前が何にも解決できなければ拒否する', async () => {
    setupRaw({ resolved: '', branchTip: 'branch-sha\n' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature/x'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('解決先とブランチの先端が同じなら通る', async () => {
    setupRaw({ resolved: 'same\n', branchTip: 'same\n' })
    await mergeBranch('/project', 'feature/x')
    expect(mergeWasCalled()).toBe(true)
  })

  it('名前の解決先を ^{commit} で、ブランチの先端を for-each-ref で問い合わせる', async () => {
    setupRaw({})
    await mergeBranch('/project', 'feature/x')
    expect(rawCalls()).toContainEqual(['rev-parse', '--verify', '-q', 'feature/x^{commit}'])
    expect(rawCalls()).toContainEqual([
      'for-each-ref',
      '--format=%(refname) %(objectname)',
      'refs/heads/feature/x'
    ])
  })

  // for-each-ref のパターンは配下(refs/heads/feature/x/y)にも一致しうる。
  // refname が完全一致する行だけを先端とする
  it('for-each-ref に完全一致する行が無ければ(配下の行だけ)拒否する', async () => {
    setupRaw({ forEachRef: 'refs/heads/feature/x/y sha1\n' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature/x'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('for-each-ref の出力が空なら拒否する', async () => {
    setupRaw({ forEachRef: '' })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature/x'
    )
    expect(mergeWasCalled()).toBe(false)
  })

  it('完全一致の行が複数の行の中にあっても、その行の SHA を先端とする', async () => {
    setupRaw({
      resolved: 'right\n',
      forEachRef:
        'refs/heads/feature/x/y wrong\nrefs/heads/feature/x right\nrefs/heads/feature/x/z wrong2\n'
    })
    await mergeBranch('/project', 'feature/x')
    expect(mergeWasCalled()).toBe(true)
  })

  it('完全一致の行が複数の行の中にあり、SHA が解決先と違えば拒否する', async () => {
    setupRaw({
      resolved: 'wrong\n',
      forEachRef: 'refs/heads/feature/x/y wrong\nrefs/heads/feature/x right\n'
    })
    await expect(mergeBranch('/project', 'feature/x')).rejects.toThrow(
      '同名のタグ等があり、ブランチを特定できないためマージできません: feature/x'
    )
    expect(mergeWasCalled()).toBe(false)
  })
})

// 許可リスト検証(assertLocalBranchExists)は checkout・削除・マージで共通。
// 3 操作すべてが同じ文言で拒否し、git のコマンドを呼ばないことを固定する(パターン21)
describe('許可リストに無いブランチ名の拒否(checkout・削除・マージ共通)', () => {
  beforeEach(() => {
    mockBranchLocal.mockResolvedValue({
      all: ['main', 'feature/x'],
      current: 'main',
      detached: false
    })
  })

  const operations: Record<string, (name: string) => Promise<unknown>> = {
    checkout: (name) => checkoutBranch('/project', name),
    delete: (name) => deleteBranch('/project', name, false),
    merge: (name) => mergeBranch('/project', name)
  }

  it.each(['checkout', 'delete', 'merge'])(
    '%s は許可リストに無い名前を同じ文言で拒否し、git の操作を呼ばない',
    async (operation) => {
      await expect(operations[operation]('--force')).rejects.toThrow(
        '存在しないブランチです: --force'
      )
      expect(mockCheckout).not.toHaveBeenCalled()
      expect(mockDeleteLocalBranch).not.toHaveBeenCalled()
      expect(mockRaw).not.toHaveBeenCalled()
    }
  )
})
