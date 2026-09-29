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
  discardFileChanges,
  commit,
  getDiff,
  getLog,
  getBranches,
  getTags,
  amendCommit,
  isStagedRenameDiff,
  push,
  pull,
  fetchRemote,
  checkoutBranch,
  createBranch,
  deleteBranch
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
  it('simpleGit を folderPath を引数に呼ぶ', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    await getGitStatus('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
  })

  it('Git リポジトリでない場合 isRepo: false を返す', async () => {
    mockCheckIsRepo.mockResolvedValue(false)
    const result = await getGitStatus('/project')
    expect(result).toEqual({ isRepo: false, branch: null, ahead: 0, behind: 0, files: [] })
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

  it('branch が null のとき null をそのまま返す', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockResolvedValue({ ...baseStatusResult, current: null })
    const result = await getGitStatus('/project')
    expect(result.branch).toBeNull()
  })

  it('status() が throw した場合エラーが伝播する', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    mockStatus.mockRejectedValue(new Error('git error'))
    await expect(getGitStatus('/project')).rejects.toThrow('git error')
  })
})

describe('stageFile', () => {
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

describe('discardFileChanges', () => {
  // raw() の呼び出しを先頭の引数で振り分ける。出力形式は Task 1 冒頭の前提を参照
  const setupRaw = (outputs: {
    unmerged?: string
    tracked?: string
    intentToAdd?: string
    rmCachedError?: Error
  }): void => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-files' && args[1] === '-u') return outputs.unmerged ?? ''
      if (args[0] === 'ls-files') return outputs.tracked ?? ''
      if (args[0] === 'diff') return outputs.intentToAdd ?? ''
      if (args[0] === 'rm') {
        if (outputs.rmCachedError !== undefined) throw outputs.rmCachedError
        return ''
      }
      if (args[0] === 'restore') return ''
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

  it('追跡済みなら restore --worktree をリテラル pathspec で呼び、ゴミ箱へは移動しない', async () => {
    setupRaw({ tracked: 'src/a.ts\n' })
    const trash = vi.fn()
    await discardFileChanges('/project', 'src/a.ts', trash)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(mockRaw).toHaveBeenCalledWith(['restore', '--worktree', '--', ':(literal)src/a.ts'])
    expect(trash).not.toHaveBeenCalled()
  })

  // git は `--` の後ろでも [ ] * ? をグロブとして解釈するため、リテラル化しないと
  // 'a[1].txt' の取り消しで無関係な 'a1.txt' の変更まで消えてしまう
  it('グロブ文字を含むパスもリテラル化して渡す', async () => {
    setupRaw({ tracked: 'a[1].txt\n' })
    await discardFileChanges('/project', 'a[1].txt', vi.fn())
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '-u', '--', ':(literal)a[1].txt'])
    expect(mockRaw).toHaveBeenCalledWith(['ls-files', '--', ':(literal)a[1].txt'])
    expect(mockRaw).toHaveBeenCalledWith(['restore', '--worktree', '--', ':(literal)a[1].txt'])
  })

  it('未追跡(ls-files が空)なら絶対パスでゴミ箱へ移動し、restore は呼ばない', async () => {
    setupRaw({ tracked: '' })
    const trash = vi.fn().mockResolvedValue(undefined)
    await discardFileChanges('/project', 'new/file.txt', trash)
    expect(trash).toHaveBeenCalledWith('/project/new/file.txt')
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['restore']))
  })

  it('ゴミ箱への移動に失敗したら日本語エラーにする', async () => {
    setupRaw({ tracked: '' })
    const trash = vi.fn().mockRejectedValue(new Error('trash unavailable'))
    await expect(discardFileChanges('/project', 'new.txt', trash)).rejects.toThrow(
      'ゴミ箱へ移動できませんでした: new.txt'
    )
  })

  // git restore は 'is unmerged' で失敗するが、その英語エラーを見せる前に日本語で拒否する
  it('コンフリクト中(ls-files -u が空でない)なら日本語エラーで拒否し、何も実行しない', async () => {
    setupRaw({ unmerged: '100644 abc 1\tc.txt\n100644 def 2\tc.txt\n', tracked: 'c.txt\nc.txt\n' })
    const trash = vi.fn()
    await expect(discardFileChanges('/project', 'c.txt', trash)).rejects.toThrow(
      'コンフリクト中のファイルは取り消せません: c.txt'
    )
    expect(trash).not.toHaveBeenCalled()
    expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['restore']))
  })

  it('restore が失敗したら git のエラーをそのまま伝播する', async () => {
    mockRaw.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-files' && args[1] === '-u') return ''
      if (args[0] === 'ls-files') return 'a.ts\n'
      if (args[0] === 'diff') return ''
      throw new Error('restore failed')
    })
    await expect(discardFileChanges('/project', 'a.ts', vi.fn())).rejects.toThrow('restore failed')
  })

  // intent-to-add(git add -N、status は ' A')は ls-files に出るが、restore --worktree は
  // ファイルを空にするだけで ' A' のまま残る(履歴が無いので内容が失われる)。
  // 未追跡と同じくゴミ箱へ移す(最終レビューで追加)
  describe('intent-to-add のファイル', () => {
    it('diff --diff-filter=A で判定し、rm --cached の後でゴミ箱へ移し、restore は呼ばない', async () => {
      // 呼び出し順を記録するため、setupRaw ではなく個別に差し替える
      const order: string[] = []
      mockRaw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'ls-files' && args[1] === '-u') return ''
        if (args[0] === 'ls-files') return 'x.txt\n'
        if (args[0] === 'diff') return 'x.txt\n'
        order.push(args[0])
        return ''
      })
      const trash = vi.fn(async () => {
        order.push('trash')
      })
      await discardFileChanges('/project', 'dir/x.txt', trash)
      expect(mockRaw).toHaveBeenCalledWith([
        'diff',
        '--name-only',
        '--diff-filter=A',
        '--',
        ':(literal)dir/x.txt'
      ])
      expect(mockRaw).toHaveBeenCalledWith(['rm', '--cached', '-q', '--', ':(literal)dir/x.txt'])
      expect(trash).toHaveBeenCalledWith('/project/dir/x.txt')
      // ゴミ箱への移動に失敗しても、index に宙ぶらりんのエントリを残さず
      // 通常の未追跡ファイルに戻っているよう、rm --cached を先に行う
      expect(order).toEqual(['rm', 'trash'])
    })

    it('rm --cached が失敗したらゴミ箱へは移さず、エラーを伝播する', async () => {
      setupRaw({
        tracked: 'x.txt\n',
        intentToAdd: 'x.txt\n',
        rmCachedError: new Error('rm failed')
      })
      const trash = vi.fn()
      await expect(discardFileChanges('/project', 'x.txt', trash)).rejects.toThrow('rm failed')
      expect(trash).not.toHaveBeenCalled()
      expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['restore']))
    })

    it('ゴミ箱への移動に失敗したら未追跡と同じ日本語エラーにする', async () => {
      setupRaw({ tracked: 'x.txt\n', intentToAdd: 'x.txt\n' })
      const trash = vi.fn().mockRejectedValue(new Error('trash unavailable'))
      await expect(discardFileChanges('/project', 'x.txt', trash)).rejects.toThrow(
        'ゴミ箱へ移動できませんでした: x.txt'
      )
    })

    it('通常の追跡済み(diff --diff-filter=A が空)なら従来どおり restore する', async () => {
      setupRaw({ tracked: 'a.ts\n', intentToAdd: '' })
      const trash = vi.fn()
      await discardFileChanges('/project', 'a.ts', trash)
      expect(mockRaw).toHaveBeenCalledWith(['restore', '--worktree', '--', ':(literal)a.ts'])
      expect(mockRaw).not.toHaveBeenCalledWith(expect.arrayContaining(['rm']))
      expect(trash).not.toHaveBeenCalled()
    })
  })
})

describe('commit', () => {
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
  it("未ステージの変更を simpleGit を folderPath で呼び、diff を ['-U3', '--', filePath] で呼ぶ(status は呼ばない)", async () => {
    // isUntracked は呼び出し元(renderer)が既に持っている git status 由来の情報。
    // ここで改めて git.status() を呼ぶと、diff タブを開くたびにリポジトリ全体を
    // 再スキャンする無駄な I/O が発生する
    mockDiff.mockResolvedValue('diff --git a/src/index.ts b/src/index.ts\n@@ -1 +1 @@\n-a\n+b\n')
    const result = await getDiff('/project', 'src/index.ts', false, false)
    // core.quotePath=false を指定しないと、ファイル名に非ASCII文字を含む場合
    // git diff の出力がダブルクォート+オクタルエスケープされ(例: "b/\346...")、
    // diffParser.ts の toSelfDiffHeaderLines が "+++ b/" の固定長プレフィックスで
    // 新パスを切り出せなくなる(実機で再現確認済み)
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', { config: ['core.quotePath=false'] })
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
  it('git log を --max-count/--skip/--pretty オプションで呼び、レコードをパースして返す（%B で単一行 subject も取得できる）', async () => {
    mockCheckIsRepo.mockResolvedValue(true)
    const record =
      'abc123\x1ffeat: 新機能\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e' +
      'def456\x1ffix: バグ修正\x1f2026-09-02T10:00:00+09:00\x1fBob\x1e'
    mockRaw.mockResolvedValue(record)
    const result = await getLog('/project', 20, 0)
    expect(mockRaw).toHaveBeenCalledWith([
      'log',
      '--max-count=20',
      '--skip=0',
      '--pretty=format:%H%x1f%B%x1f%aI%x1f%an%x1e'
    ])
    expect(result).toEqual([
      {
        hash: 'abc123',
        message: 'feat: 新機能',
        date: '2026-09-03T10:00:00+09:00',
        authorName: 'Alice'
      },
      {
        hash: 'def456',
        message: 'fix: バグ修正',
        date: '2026-09-02T10:00:00+09:00',
        authorName: 'Bob'
      }
    ])
  })

  it('env() を使わない(simple-git の安全ガードに弾かれて履歴が常に壊れるため)', async () => {
    // env() に環境変数を明示的に渡すと、simple-git の
    // blockUnsafeOperationsPlugin が spawn 前に内容を検査し、EDITOR / PAGER /
    // GIT_EDITOR / GIT_SSH_COMMAND 等が含まれていると GitPluginError を throw する
    // (実機で再現確認済み)。これらはほぼすべての開発者のシェルに設定されており、
    // main プロセスがそのまま継承するため、履歴パネルは常にエラー表示+空になり、
    // lastCommitMessage が null のままで amend チェックボックスも永久に disabled
    // になってしまう
    mockCheckIsRepo.mockResolvedValue(true)
    mockRaw.mockResolvedValue('')
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
    mockCheckIsRepo.mockResolvedValue(true)
    const record =
      'abc123\x1ffeat: 新機能\n\n詳細な説明文\n2行目\x1f2026-09-03T10:00:00+09:00\x1fAlice\x1e'
    mockRaw.mockResolvedValue(record)
    const result = await getLog('/project', 20, 0)
    expect(result).toEqual([
      {
        hash: 'abc123',
        message: 'feat: 新機能\n\n詳細な説明文\n2行目',
        date: '2026-09-03T10:00:00+09:00',
        authorName: 'Alice'
      }
    ])
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

describe('getBranches', () => {
  it('branchLocal の結果を GitBranch[] に変換する', async () => {
    mockBranchLocal.mockResolvedValue({ all: ['main', 'feature/x'], current: 'main' })
    const result = await getBranches('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project')
    expect(result).toEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false }
    ])
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
  it('simpleGit を folderPath とタイムアウト設定で呼び、pull を引数なしで呼ぶ', async () => {
    mockPull.mockResolvedValue(undefined)
    await pull('/project')
    expect(mockSimpleGit).toHaveBeenCalledWith('/project', {
      timeout: { block: GIT_REMOTE_TIMEOUT_MS },
      progress: expect.any(Function)
    })
    expect(mockPull).toHaveBeenCalledWith()
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
      throw new Error(`unexpected raw: ${args.join(' ')}`)
    })
  }

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
