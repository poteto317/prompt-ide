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
      env: mockEnv
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
vi.mock('simple-git', () => ({ default: mockSimpleGit, GitError: MockGitError }))
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
  getBranches,
  getTags,
  amendCommit,
  isStagedRenameDiff
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
