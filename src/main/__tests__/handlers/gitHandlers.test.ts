import { describe, it, expect, vi, beforeEach } from 'vitest'
import { relative, sep } from 'node:path'
import type { FolderAccessManager } from '../../folderAccessManager'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetGitStatus = vi.hoisted(() => vi.fn())
const mockStageFile = vi.hoisted(() => vi.fn())
const mockUnstageFile = vi.hoisted(() => vi.fn())
const mockCommit = vi.hoisted(() => vi.fn())
const mockGetDiff = vi.hoisted(() => vi.fn())
const mockStageHunk = vi.hoisted(() => vi.fn())
const mockUnstageHunk = vi.hoisted(() => vi.fn())
const mockGetLog = vi.hoisted(() => vi.fn())
const mockGetBranches = vi.hoisted(() => vi.fn())
const mockGetTags = vi.hoisted(() => vi.fn())
const mockAmendCommit = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())
const mockPull = vi.hoisted(() => vi.fn())
const mockFetchRemote = vi.hoisted(() => vi.fn())
const mockCheckoutBranch = vi.hoisted(() => vi.fn())
const mockToGitRelativePath = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('../../gitService', () => ({
  getGitStatus: mockGetGitStatus,
  stageFile: mockStageFile,
  unstageFile: mockUnstageFile,
  commit: mockCommit,
  getDiff: mockGetDiff,
  getLog: mockGetLog,
  getBranches: mockGetBranches,
  getTags: mockGetTags,
  amendCommit: mockAmendCommit,
  push: mockPush,
  pull: mockPull,
  fetchRemote: mockFetchRemote,
  checkoutBranch: mockCheckoutBranch,
  // gitHandlers.ts と gitService.ts が同じ条件を共有するために切り出した実体を
  // そのまま使う(モックで別ロジックを持つと、本番の判定とテストの前提がずれる)
  isStagedRenameDiff: (staged: boolean, renamedFrom: string | undefined): renamedFrom is string =>
    staged && renamedFrom !== undefined
}))

vi.mock('../../gitApply', () => ({
  stageHunk: mockStageHunk,
  unstageHunk: mockUnstageHunk
}))

vi.mock('../../pathNormalize', () => ({
  toGitRelativePath: mockToGitRelativePath
}))

vi.mock('node:fs/promises', () => ({
  default: { realpath: mockRealpath },
  realpath: mockRealpath
}))

import { registerGitHandlers } from '../../handlers/gitHandlers'

const mockIpcMain = { handle: mockHandle } as never

function makeFolderAccess(overrides?: Partial<FolderAccessManager>): FolderAccessManager {
  return {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    assertWithinFolder: vi.fn(),
    assertParentWithinFolder: vi.fn(),
    ...overrides
  } as unknown as FolderAccessManager
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number): { sender: { id: number } } {
  return { sender: { id: senderId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  // 既存の git:getDiff テストは実際の相対パス変換と同じ結果を返すデフォルト実装で扱う。
  // 正規化そのものの振る舞いは pathNormalize.test.ts で検証する
  mockToGitRelativePath.mockImplementation((folder: string, absolutePath: string) =>
    relative(folder, absolutePath).split(sep).join('/')
  )
  // 既定はシンボリックリンクを含まないパス(realpath = 入力そのもの)
  mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
})

describe('registerGitHandlers', () => {
  describe('git:getStatus', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getStatus')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder を引数に getGitStatus を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      const mockResult = { isRepo: true, branch: 'main', ahead: 0, behind: 0, files: [] }
      mockGetGitStatus.mockResolvedValue(mockResult)
      const result = await getRegisteredHandler('git:getStatus')(makeEvent(1))
      expect(mockGetGitStatus).toHaveBeenCalledWith('/project')
      expect(result).toEqual(mockResult)
    })

    it('getGitStatus が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetGitStatus.mockRejectedValue(new Error('git error'))
      await expect(getRegisteredHandler('git:getStatus')(makeEvent(1))).rejects.toThrow('git error')
    })
  })

  describe('git:stage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')).rejects.toThrow(
        'No folder open'
      )
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、stageFile にはリポジトリ相対パスで呼ぶ', async () => {
      // 絶対パスのまま stageFile(git add)に渡すと、失敗時の GitError に
      // pathspec として OS 絶対パス(ユーザー名やディレクトリ構造を含む)が
      // そのまま乗り、レンダラーへ伝播してしまう。git:getDiff/stageHunk/
      // unstageHunk と同じ理由で相対パス化する
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', 'src/index.ts')
    })

    it('assertWithinFolder が throw した場合、stageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockStageFile).not.toHaveBeenCalled()
    })

    it('相対パスの filePath を allowedFolder 基準の絶対パスに解決してから assertWithinFolder を呼び、stageFile にはリポジトリ相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageFile).toHaveBeenCalledWith('/project', 'src/index.ts')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから stageFile を相対パスで呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stage')(makeEvent(1), 'deleted.ts')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockStageFile).toHaveBeenCalledWith('/project', 'deleted.ts')
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、assertParentWithinFolder にフォールバックせずエラーを伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
      const assertParentWithinFolder = vi.fn()
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stage')(makeEvent(1), '../outside/deleted.ts')
      ).rejects.toThrow('Access denied')
      expect(assertParentWithinFolder).not.toHaveBeenCalled()
      expect(mockStageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:unstage', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      ).rejects.toThrow('No folder open')
    })

    it('assertWithinFolder を allowedFolder と filePath で呼び、unstageFile にはリポジトリ相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), '/project/src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'src/index.ts', undefined)
    })

    it('assertWithinFolder が throw した場合、unstageFile を呼ばずエラーが伝播する', async () => {
      const assertWithinFolder = vi.fn().mockRejectedValue(new Error('Access denied'))
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '/outside/file.ts')
      ).rejects.toThrow('Access denied')
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })

    it('相対パスの filePath を allowedFolder 基準の絶対パスに解決してから assertWithinFolder を呼び、unstageFile にはリポジトリ相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'src/index.ts', undefined)
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから unstageFile を相対パスで呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'deleted.ts')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'deleted.ts', undefined)
    })

    it('renamedFrom が渡された場合、境界チェックした上で unstageFile の第3引数(旧パス)へリポジトリ相対パスで渡す', async () => {
      // 新パスだけを reset すると、旧パスの削除だけが index に残ったまま
      // (D old.txt / ?? new.txt)になり、アンステージのつもりが壊れた状態を
      // 作ってしまう(実機で再現確認済み)。旧パスも境界チェック・相対パス化
      // した上で unstageFile へ渡す必要がある
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'new.txt', 'old.txt')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/new.txt')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/old.txt')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'new.txt', 'old.txt')
    })

    it('renamedFrom を省略した場合、unstageFile は第3引数無しで呼ばれる', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageFile.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstage')(makeEvent(1), 'src/index.ts')
      expect(mockUnstageFile).toHaveBeenCalledWith('/project', 'src/index.ts', undefined)
    })

    it('assertWithinFolder が ENOENT 以外のエラーで失敗した場合、assertParentWithinFolder にフォールバックせずエラーを伝播する', async () => {
      const assertWithinFolder = vi
        .fn()
        .mockRejectedValue(new Error('Access denied: /outside/deleted.ts'))
      const assertParentWithinFolder = vi.fn()
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:unstage')(makeEvent(1), '../outside/deleted.ts')
      ).rejects.toThrow('Access denied')
      expect(assertParentWithinFolder).not.toHaveBeenCalled()
      expect(mockUnstageFile).not.toHaveBeenCalled()
    })
  })

  describe('git:commit', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と message を引数に commit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:commit')(makeEvent(1), 'feat: 新機能')
      expect(mockCommit).toHaveBeenCalledWith('/project', 'feat: 新機能')
    })

    it('commit が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCommit.mockRejectedValue(new Error('commit failed'))
      await expect(getRegisteredHandler('git:commit')(makeEvent(1), 'msg')).rejects.toThrow(
        'commit failed'
      )
    })
  })

  describe('git:getDiff', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:getDiff')(makeEvent(1), 'src/index.ts', false, false)
      ).rejects.toThrow('No folder open')
    })

    it('対象自体がシンボリックリンクの場合、リンク名を保ったまま相対パス化する(リンク先の実体名に化けさせない)', async () => {
      // git はシンボリックリンクをリンク自体として追跡する(git status は
      // "?? link.txt" を返す)。realpath は最終コンポーネントのリンクまで
      // 解決してしまうため、そのまま使うと相対パスがリンク先の実体名に化け、
      // .gitignore には無関係な実ファイル名が書かれ、diff タブにはリンク先の
      // 内容が表示される。親ディレクトリだけを解決し、最終要素は保つ必要がある
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/proj'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      // /tmp → /private/tmp のリンク解決に加え、link.txt → real.txt も解決される
      mockRealpath.mockImplementation((p: string) => {
        const resolved = p.replace(/^\/tmp\//, '/private/tmp/')
        return Promise.resolve(resolved.replace(/\/link\.txt$/, '/real.txt'))
      })
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/tmp/proj/link.txt', false, false)

      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/proj',
        'link.txt',
        false,
        false,
        undefined
      )
    })

    it('シンボリックリンク経由のパスは realpath 解決後の絶対パスを基準に相対パス化する', async () => {
      // allowedFolder は dialog:openFolder が realpath 済みの値を保持する一方、
      // renderer が持つ node.path は未解決のまま(readDirRecursive が生の
      // folderPath を join するため)。両者がずれると relative() が
      // "../../../tmp/..." のような外へ出るパスを返し、.gitignore には
      // 「何も無視しない壊れた行」が書かれる(macOS の /tmp 配下で実際に再現)。
      // 境界チェック自体は内部で realpath するため通ってしまい、エラーも出ない
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/qtest'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      // /tmp は /private/tmp へのシンボリックリンク(macOS)
      mockRealpath.mockImplementation((p: string) =>
        Promise.resolve(p.replace(/^\/tmp\//, '/private/tmp/'))
      )
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/tmp/qtest/notes.txt', false, false)

      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/qtest',
        'notes.txt',
        false,
        false,
        undefined
      )
    })

    it('staged: false の場合、renamedFrom を渡されても境界チェックしない(gitService 側で使われないため)', async () => {
      // gitService.getDiff は `staged && renamedFrom !== undefined` のときだけ
      // renamedFrom を実際に使う。renderer(useDiffOperations.ts)は staged の
      // 値に関わらず gitStatusFiles の from を常に渡すため、staged: false でも
      // renamedFrom の境界チェックを律儀に行うと、その旧パスの位置にたまたま
      // 許可フォルダ外を指す実体があった場合、gitService 側では使われもしない
      // 値のチェック失敗によって、本来成功するはずの未ステージ diff の取得
      // ごと失敗してしまう
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'new.txt', false, false, 'old.txt')

      // new.txt の境界チェックのみ行われ、old.txt(renamedFrom)は一切解決・
      // 検証されない
      expect(assertWithinFolder).toHaveBeenCalledTimes(1)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/new.txt')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', false, false, undefined)
    })

    it('staged: true の場合は renamedFrom も境界チェックして gitService へ渡す', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'new.txt', true, false, 'old.txt')

      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/new.txt')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/old.txt')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', true, false, 'old.txt')
    })

    it('staged: true の場合、filePath と renamedFrom の境界チェックを並行実行する(逐次待ちで無駄な往復を増やさない)', async () => {
      // filePath(new.txt)と renamedFrom(old.txt)の境界チェックは互いに依存しない
      // 独立した非同期処理のため、await で直列に待つと診断タブを開く/更新する
      // たびに不要な待ち時間が1回分増える。両方が「開始済み」の状態を経てから
      // 解決させることで、並行実行されていることを検証する
      const started: string[] = []
      let resolveNew: (() => void) | undefined
      let resolveOld: (() => void) | undefined
      const assertWithinFolder = vi.fn().mockImplementation((_allowed: string, path: string) => {
        started.push(path)
        return new Promise<void>((resolve) => {
          if (path.endsWith('new.txt')) resolveNew = resolve
          else resolveOld = resolve
        })
      })
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      const promise = getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        'new.txt',
        true,
        false,
        'old.txt'
      )
      // イベントループを1周させ、両方の境界チェックが「開始済み」になっているか確認する。
      // 逐次 await のままだと、この時点では new.txt の境界チェックしか開始していない
      await Promise.resolve()
      await Promise.resolve()
      expect(started).toEqual(expect.arrayContaining(['/project/new.txt', '/project/old.txt']))
      expect(started).toHaveLength(2)

      resolveNew!()
      resolveOld!()
      await promise
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', true, false, 'old.txt')
    })

    it('直近の親だけでなく祖先ディレクトリごと削除されている場合も、実在する祖先まで遡って realpath する', async () => {
      // 直近の親(dirname)だけ realpath を試みてダメなら未解決のまま
      // フォールバックする実装だと、sub/deep ごと削除された場合
      // (dirname である sub/deep 自体が存在しない)、フォールバックした
      // 未解決パスが allowedFolder(realpath 済み)と表記の基準が食い違い、
      // relative() が "../../../tmp/..." のような許可フォルダ外を指す壊れた
      // 相対パスを返す(/tmp → /private/tmp のような symlink 境界をまたぐ
      // 場合に実機で再現確認済み)。fileAccessGuard.assertFileWithinFolder と
      // 同様に、実在する祖先が見つかるまで遡る必要がある
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/proj'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException
      enoent.code = 'ENOENT'
      // sub/deep(削除済み)は ENOENT、その親の /tmp/proj は実在し
      // /private/tmp/proj へ解決できる
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/tmp/proj/sub/deep') return Promise.reject(enoent)
        if (p === '/tmp/proj') return Promise.resolve('/private/tmp/proj')
        return Promise.reject(enoent)
      })
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        '/tmp/proj/sub/deep/file.txt',
        false,
        false
      )

      // 実在する祖先(/private/tmp/proj)を基準に、削除された中間ディレクトリ名を
      // そのまま結合した相対パスになるべき("../../../tmp/proj/..." のような
      // 壊れたパスにならない)
      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/proj',
        'sub/deep/file.txt',
        false,
        false,
        undefined
      )
    })

    it('直近の親が ENOTDIR(ディレクトリだった箇所が同名ファイルに置き換わった)場合も、実在する祖先まで遡って realpath する', async () => {
      // git checkout 等でディレクトリだった箇所が同名ファイルに置き換わった場合、
      // realpath は ENOENT ではなく ENOTDIR を投げる。ENOENT だけを見ていると、
      // このケースが祖先遡りのフォールバックをすり抜けて即座に rethrow され、
      // 意図した「.gitignore が見つかりません」的な変換済みメッセージではなく
      // 未変換の ENOTDIR がそのままユーザーに見えてしまう
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/private/tmp/proj'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      const enotdir = new Error('ENOTDIR') as NodeJS.ErrnoException
      enotdir.code = 'ENOTDIR'
      // sub(ディレクトリだったが同名ファイルに置き換わった)配下への realpath は
      // ENOTDIR、その親の /tmp/proj は実在し /private/tmp/proj へ解決できる
      mockRealpath.mockImplementation((p: string) => {
        if (p === '/tmp/proj/sub') return Promise.reject(enotdir)
        if (p === '/tmp/proj') return Promise.resolve('/private/tmp/proj')
        return Promise.reject(enotdir)
      })
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        '/tmp/proj/sub/file.txt',
        false,
        false
      )

      expect(mockGetDiff).toHaveBeenCalledWith(
        '/private/tmp/proj',
        'sub/file.txt',
        false,
        false,
        undefined
      )
    })

    it('realpath が ENOENT(削除済みファイル)でも、解決前のパスで相対パス化して続行する', async () => {
      // エクスプローラーのツリーが未更新のまま削除済みファイルに対して
      // 呼ばれる経路(assertFileWithinFolder の ENOENT フォールバック)を塞がない
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      const enoent = new Error('ENOENT') as NodeJS.ErrnoException
      enoent.code = 'ENOENT'
      mockRealpath.mockRejectedValue(enoent)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'deleted.txt', false, false)

      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'deleted.txt', false, false, undefined)
    })

    it('境界チェックは解決済みの絶対パスで行うが、getDiff には相対パスで呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      const result = await getRegisteredHandler('git:getDiff')(
        makeEvent(1),
        'src/index.ts',
        true,
        false
      )
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'src/index.ts', true, false, undefined)
      expect(result).toBe('DIFF_TEXT')
    })

    it('絶対パスの filePath が渡っても、getDiff には allowedFolder 基準の相対パスで呼ぶ', async () => {
      // isUntracked は renderer 側の gitStatusFiles(リポジトリルートからの相対パス)
      // 由来のため、filePath 自体も相対パスへ揃えないと main プロセス側(git apply 等)
      // との整合が取れなくなる
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), '/project/src/index.ts', false, true)
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'src/index.ts', false, true, undefined)
    })

    it('ネストした相対パスも allowedFolder 基準の相対パスのまま getDiff に渡る', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'sub/dir/file.ts', true, false)
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/sub/dir/file.ts')
      expect(mockGetDiff).toHaveBeenCalledWith(
        '/project',
        'sub/dir/file.ts',
        true,
        false,
        undefined
      )
    })

    it('folderPath と絶対パスを toGitRelativePath に通してから getDiff に渡す（Windows のバックスラッシュ区切りを正規化するため）', async () => {
      // path.relative は Windows では \ 区切りの文字列を返すが、simple-git の相対パス
      // 表現は常に / 区切りのため、toGitRelativePath による正規化を経由することを
      // 統合的に検証する。正規化関数自体の変換ロジックは pathNormalize.test.ts で
      // 単体テストする(実行環境自体を Windows にできないため、ここでは
      // toGitRelativePath が実際に呼び出され、その戻り値が getDiff に渡ることのみ確認する)
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      mockToGitRelativePath.mockReturnValue('NORMALIZED_PATH')

      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'sub/dir/file.ts', false, false)

      expect(mockToGitRelativePath).toHaveBeenCalledWith('/project', '/project/sub/dir/file.ts')
      expect(mockGetDiff).toHaveBeenCalledWith(
        '/project',
        'NORMALIZED_PATH',
        false,
        false,
        undefined
      )
    })

    it('isUntracked をそのまま getDiff の第4引数として渡す', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'new.txt', false, true)
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'new.txt', false, true, undefined)
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから getDiff を呼ぶ', async () => {
      // assertFileWithinFolder の多段階フォールバック自体は fileAccessGuard.test.ts で
      // 単体テスト済みだが、git:getDiff/stageHunk/unstageHunk がこの関数を正しく
      // 経由しているかは別途確認しないと、呼び出し側の配線ミスを検出できない
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetDiff.mockResolvedValue('DIFF_TEXT')
      await getRegisteredHandler('git:getDiff')(makeEvent(1), 'deleted.ts', false, false)
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockGetDiff).toHaveBeenCalledWith('/project', 'deleted.ts', false, false, undefined)
    })
  })

  describe('git:stageHunk', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      ).rejects.toThrow('No folder open')
    })

    it('境界チェック後、stageHunk をリポジトリ相対パスと patch 引数で呼ぶ', async () => {
      // 絶対パスのまま渡すと、失敗時のエラーメッセージ(gitApply.ts)に
      // OS絶対パス(ローカルファイルシステム構造)が露出してしまう。
      // getDiff と同じくリポジトリ相対パスへ変換してから渡す
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockStageHunk).toHaveBeenCalledWith('/project', 'src/index.ts', 'PATCH')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから stageHunk を呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockStageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:stageHunk')(makeEvent(1), 'deleted.ts', 'PATCH')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockStageHunk).toHaveBeenCalledWith('/project', 'deleted.ts', 'PATCH')
    })
  })

  describe('git:unstageHunk', () => {
    it('境界チェック後、unstageHunk をリポジトリ相対パスと patch 引数で呼ぶ', async () => {
      const assertWithinFolder = vi.fn().mockResolvedValue(undefined)
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstageHunk')(makeEvent(1), 'src/index.ts', 'PATCH')
      expect(assertWithinFolder).toHaveBeenCalledWith('/project', '/project/src/index.ts')
      expect(mockUnstageHunk).toHaveBeenCalledWith('/project', 'src/index.ts', 'PATCH')
    })

    it('assertWithinFolder が ENOENT で失敗した場合（削除済みファイル）、assertParentWithinFolder で親ディレクトリを検証してから unstageHunk を呼ぶ', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file or directory'), {
        code: 'ENOENT'
      })
      const assertWithinFolder = vi.fn().mockRejectedValue(enoent)
      const assertParentWithinFolder = vi.fn().mockResolvedValue('/project')
      const folderAccess = makeFolderAccess({
        get: vi.fn().mockReturnValue('/project'),
        assertWithinFolder,
        assertParentWithinFolder
      })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockUnstageHunk.mockResolvedValue(undefined)
      await getRegisteredHandler('git:unstageHunk')(makeEvent(1), 'deleted.ts', 'PATCH')
      expect(assertParentWithinFolder).toHaveBeenCalledWith('/project', '/project')
      expect(mockUnstageHunk).toHaveBeenCalledWith('/project', 'deleted.ts', 'PATCH')
    })
  })

  describe('git:getLog', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder と limit/skip を引数に getLog を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetLog.mockResolvedValue([])
      await getRegisteredHandler('git:getLog')(makeEvent(1), 20, 0)
      expect(mockGetLog).toHaveBeenCalledWith('/project', 20, 0)
    })
  })

  describe('git:getBranches', () => {
    it('folderAccess の allowedFolder を引数に getBranches を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetBranches.mockResolvedValue([])
      await getRegisteredHandler('git:getBranches')(makeEvent(1))
      expect(mockGetBranches).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:getTags', () => {
    it('folderAccess の allowedFolder を引数に getTags を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockGetTags.mockResolvedValue([])
      await getRegisteredHandler('git:getTags')(makeEvent(1))
      expect(mockGetTags).toHaveBeenCalledWith('/project')
    })
  })

  describe('git:amendCommit', () => {
    it('folderAccess の allowedFolder と message を引数に amendCommit を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockAmendCommit.mockResolvedValue(undefined)
      await getRegisteredHandler('git:amendCommit')(makeEvent(1), 'feat: 修正後')
      expect(mockAmendCommit).toHaveBeenCalledWith('/project', 'feat: 修正後')
    })
  })

  describe('git:push', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:push')(makeEvent(1))).rejects.toThrow('No folder open')
    })

    it('folderAccess の allowedFolder を引数に push を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPush.mockResolvedValue(undefined)
      await getRegisteredHandler('git:push')(makeEvent(1))
      expect(mockPush).toHaveBeenCalledWith('/project')
    })

    it('push が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPush.mockRejectedValue(new Error('push failed'))
      await expect(getRegisteredHandler('git:push')(makeEvent(1))).rejects.toThrow('push failed')
    })
  })

  describe('git:pull', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:pull')(makeEvent(1))).rejects.toThrow('No folder open')
    })

    it('folderAccess の allowedFolder を引数に pull を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPull.mockResolvedValue(undefined)
      await getRegisteredHandler('git:pull')(makeEvent(1))
      expect(mockPull).toHaveBeenCalledWith('/project')
    })

    it('pull が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockPull.mockRejectedValue(new Error('pull failed'))
      await expect(getRegisteredHandler('git:pull')(makeEvent(1))).rejects.toThrow('pull failed')
    })
  })

  describe('git:fetch', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(getRegisteredHandler('git:fetch')(makeEvent(1))).rejects.toThrow(
        'No folder open'
      )
    })

    it('folderAccess の allowedFolder を引数に fetchRemote を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockFetchRemote.mockResolvedValue(undefined)
      await getRegisteredHandler('git:fetch')(makeEvent(1))
      expect(mockFetchRemote).toHaveBeenCalledWith('/project')
    })

    it('fetchRemote が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockFetchRemote.mockRejectedValue(new Error('fetch failed'))
      await expect(getRegisteredHandler('git:fetch')(makeEvent(1))).rejects.toThrow('fetch failed')
    })
  })

  describe('git:checkoutBranch', () => {
    it('folderAccess が未設定のとき "No folder open" エラーをスロー', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue(undefined) })
      registerGitHandlers(mockIpcMain, folderAccess)
      await expect(
        getRegisteredHandler('git:checkoutBranch')(makeEvent(1), 'feature/x')
      ).rejects.toThrow('No folder open')
    })

    it('folderAccess の allowedFolder と branchName を引数に checkoutBranch を呼ぶ', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCheckoutBranch.mockResolvedValue(undefined)
      await getRegisteredHandler('git:checkoutBranch')(makeEvent(1), 'feature/x')
      expect(mockCheckoutBranch).toHaveBeenCalledWith('/project', 'feature/x')
    })

    it('checkoutBranch が throw した場合エラーが伝播する', async () => {
      const folderAccess = makeFolderAccess({ get: vi.fn().mockReturnValue('/project') })
      registerGitHandlers(mockIpcMain, folderAccess)
      mockCheckoutBranch.mockRejectedValue(new Error('checkout failed'))
      await expect(
        getRegisteredHandler('git:checkoutBranch')(makeEvent(1), 'feature/x')
      ).rejects.toThrow('checkout failed')
    })
  })
})
