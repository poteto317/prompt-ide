import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useDiffOperations } from '../useDiffOperations'
import type { FileOperationLock } from '../useFileOperationLock'
import type { DiffTabKey } from '../useDiffTabs'

const mockGetDiff = vi.mocked(gitApi.getDiff)
const mockStageHunk = vi.mocked(gitApi.stageHunk)
const mockUnstageHunk = vi.mocked(gitApi.unstageHunk)
const mockStageFile = vi.mocked(gitApi.stageFile)
const mockDiscardHunk = vi.mocked(gitApi.discardHunk)

// 各テストが FileOperationLock の一部の挙動だけを差し替えられるよう、
// デフォルト値(何もロックされていない状態)に overrides をマージして返す
const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('diff の取得', () => {
  it('activeDiffTab が設定されると getDiff を呼び、結果を diffContent にセットする', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledWith('src/index.ts', false, false, undefined)
    expect(result.current.diffStaged).toBe(false)
    expect(result.current.diffError).toBeNull()
  })

  it('gitStatusFiles 内の対象ファイルの index が "?"(未追跡)の場合、isUntracked: true で getDiff を呼ぶ', async () => {
    // main プロセス側(gitService.getDiff)は isUntracked を受け取って git.status() の
    // 再実行を省略するため、renderer 側の gitStatusFiles から正しく渡せている必要がある
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'new.txt', staged: false }
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [
        { path: 'new.txt', index: '?', workingDir: '?' }
      ])
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledWith('new.txt', false, true, undefined)
  })

  it('未追跡ファイルの diff を開いたとき、isActiveFileUntracked: true を返す(DiffView が打ち切り時のボタン抑止を無効化する判定に使う)', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'new.txt', staged: false }
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [
        { path: 'new.txt', index: '?', workingDir: '?' }
      ])
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(result.current.isActiveFileUntracked).toBe(true)
  })

  it('追跡済みファイルの diff を開いたとき、isActiveFileUntracked: false を返す', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [
        { path: 'src/index.ts', index: ' ', workingDir: 'M' }
      ])
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(result.current.isActiveFileUntracked).toBe(false)
  })

  it('gitStatusFiles の path が表記違い(大文字小文字)でも同一ファイルとして isUntracked 判定に使う', async () => {
    // f.path === activeDiffTab.path という素の比較のままだと、Windows の
    // ドライブレター大文字小文字違い等で一致しなくなり、activeFileStatus が
    // undefined 扱いになって isUntracked が false に落ちる
    // (「untracked diff が空表示になる」のと同じ原因のバグを再発させる)。
    // isSamePath を使えばこの表記違いを吸収できる
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'C:\\project\\new.txt', staged: false }
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [
        { path: 'c:/project/new.txt', index: '?', workingDir: '?' }
      ])
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledWith('C:\\project\\new.txt', false, true, undefined)
  })

  it('ステージ済みリネームのタブでは、旧パス(from)も getDiff に渡す', async () => {
    // 新パスだけで staged diff を取ると git がリネーム検出をせず
    // 「新規ファイル + 全行追加」になり、それをアンステージすると旧パスの削除が
    // ステージに残ってファイルが消える(実機で再現確認済み)
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'new.txt', staged: true }
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [
        { path: 'new.txt', index: 'R', workingDir: ' ', from: 'old.txt' }
      ])
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledWith('new.txt', true, false, 'old.txt')
  })

  it('index/workingDir が変わらないまま from(リネーム元)だけが変わった場合も、新しい from で diff を再取得する', async () => {
    // 外部(ターミナル等)での git 操作により、同じ index='R' のまま from だけが
    // 変わることは理論上あり得る(例: A→B のリネームをアンステージ→別ファイル
    // C→B のリネームを再ステージ、が同一レンダーサイクル内で観測された場合)。
    // effect の依存配列が activeFileStatusKey(index+workingDir の結合値)だけを
    // 見ていると、from の変化を検知できずクロージャに古い from が残ったままになり、
    // アンステージ操作が誤った旧パスに対して行われてしまう
    mockGetDiff.mockResolvedValueOnce('DIFF_A').mockResolvedValueOnce('DIFF_B')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'new.txt', staged: true }
    const { result, rerender } = renderHook(
      ({
        files
      }: {
        files: Array<{ path: string; index: string; workingDir: string; from: string }>
      }) => useDiffOperations(activeTab, refreshGitStatus, files),
      {
        initialProps: {
          files: [{ path: 'new.txt', index: 'R', workingDir: ' ', from: 'old-a.txt' }]
        }
      }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))
    expect(mockGetDiff).toHaveBeenCalledWith('new.txt', true, false, 'old-a.txt')

    rerender({ files: [{ path: 'new.txt', index: 'R', workingDir: ' ', from: 'old-c.txt' }] })

    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_B'))
    expect(mockGetDiff).toHaveBeenCalledWith('new.txt', true, false, 'old-c.txt')
  })

  it('リネームでないファイルには旧パスを渡さない', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'a.ts', staged: true }
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [
        { path: 'a.ts', index: 'M', workingDir: ' ' }
      ])
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledWith('a.ts', true, false, undefined)
  })

  it('activeDiffTab が null のときは getDiff を呼ばない', () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useDiffOperations(null, refreshGitStatus, []))
    expect(mockGetDiff).not.toHaveBeenCalled()
  })

  it('activeDiffTab が切り替わった時点で、前のタブの diffContent を即座にクリアする', async () => {
    // クリアしないと、取得中の空白期間に前のタブの内容が表示され続ける。
    // その間に「このハンクをステージ」を押すと、古い diffContent から組み立てた
    // patch が新しい activeDiffTab.path 宛てに送られ、誤ったファイルを操作してしまう
    mockGetDiff.mockResolvedValueOnce('DIFF_A')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      {
        initialProps: { tab: tabA }
      }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))

    // b.ts の取得は未解決のまま止める
    mockGetDiff.mockImplementation(() => new Promise<string>(() => {}))
    const tabB = { path: 'b.ts', staged: false }
    rerender({ tab: tabB })

    expect(result.current.diffContent).toBeNull()
  })

  it('activeDiffTab が切り替わった時点で、getDiff の解決を待たず即座に diffStaged が新タブの staged に一致する', async () => {
    // diffStaged は getDiff 成功後にのみ setDiffStaged していたため、取得中
    // (fetch が未解決の間)は前のタブの staged 値が残り続けてしまう。
    // activeDiffTab.staged から直接導出すれば、この同期漏れの余地自体が無くなる
    mockGetDiff.mockResolvedValueOnce('DIFF_A')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      {
        initialProps: { tab: tabA }
      }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))
    expect(result.current.diffStaged).toBe(false)

    // b.ts(staged: true)の取得は未解決のまま止める
    mockGetDiff.mockImplementation(() => new Promise<string>(() => {}))
    const tabB = { path: 'b.ts', staged: true }
    rerender({ tab: tabB })

    expect(result.current.diffStaged).toBe(true)
  })

  it('activeDiffTab は変わらないまま、対象ファイルの git status(index/workingDir)が変わったら diff を再取得する', async () => {
    // ChangesSection/StagedSection からのファイル全体 stage/unstage(useGitOperations
    // 経由)は refreshGitStatus は呼ぶが、diffRefreshSignal(ハンク操作専用のトリガー)は
    // 更新しない。これを無視すると、開いている diff タブの内容が古いまま残り、
    // その後ハンクのステージを押すと既にステージ済みのファイルへ古いパッチを送って
    // git apply が失敗する
    mockGetDiff.mockResolvedValueOnce('DIFF_UNSTAGED')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'a.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ files }: { files: Array<{ path: string; index: string; workingDir: string }> }) =>
        useDiffOperations(activeTab, refreshGitStatus, files),
      { initialProps: { files: [{ path: 'a.ts', index: ' ', workingDir: 'M' }] } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_UNSTAGED'))

    // a.ts がファイル全体ステージされ、index が変わった(workingDir も変わる)
    mockGetDiff.mockResolvedValueOnce('DIFF_STAGED')
    rerender({ files: [{ path: 'a.ts', index: 'M', workingDir: ' ' }] })

    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_STAGED'))
  })

  it('refreshDiff を呼ぶと、activeDiffTab も git status も変わっていなくても diff を取り直す', async () => {
    // エディタでのファイル保存は git status のステータス文字を変えない
    // (既に " M" のファイルを編集・保存しても " M" のまま)ため、
    // activeFileStatusKey 依存の再取得では検知できない。取り直さないと、
    // 保存前の古い diffContent から作った patch を「このハンクをステージ」で
    // 送ってしまい、ユーザーが一度も意図していない内容が index に入る
    mockGetDiff.mockResolvedValue('OLD_DIFF')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('OLD_DIFF'))

    mockGetDiff.mockResolvedValue('NEW_DIFF')
    act(() => {
      result.current.refreshDiff()
    })
    await waitFor(() => expect(result.current.diffContent).toBe('NEW_DIFF'))
  })

  it('getDiff が失敗した場合、unhandled rejection にならず diffError がセットされる', async () => {
    mockGetDiff.mockRejectedValue(new Error('diff failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffError?.message).toBe('diff failed'))
  })
})

describe('stageHunk', () => {
  it('gitApi.stageHunk を activeDiffTab の path と patch で呼び、成功後 refreshGitStatus を呼ぶ', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_TEXT')
    expect(refreshGitStatus).toHaveBeenCalled()
  })

  it('ハンク操作後の diffRefreshSignal は refreshGitStatus の完了を待ってから発火する(gitStatusFiles がまだ古いままだと isUntracked を誤判定するため)', async () => {
    // diffRefreshSignal を refreshGitStatus の解決前に発火させると、その時点で
    // gitStatusFiles(renderer 側のキャッシュ)はまだ古いままのため、effect が
    // 古い isUntracked で getDiff を呼んでしまう。これは「untracked diff が
    // 誤表示される」のと同じ原因のバグを再発させるレース
    mockGetDiff.mockResolvedValueOnce('DIFF_UNTRACKED')
    // 未追跡ファイルのステージは clean フィルタを通すため stageFile(git add)経由
    mockStageFile.mockResolvedValue(undefined)
    let resolveRefreshGitStatus: () => void = () => {}
    const refreshGitStatus = vi.fn(
      () => new Promise<void>((resolve) => (resolveRefreshGitStatus = resolve))
    )
    const activeTab = { path: 'new.txt', staged: false }
    const gitStatusFiles = [{ path: 'new.txt', index: '?', workingDir: '?' }]
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, gitStatusFiles)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_UNTRACKED'))
    expect(mockGetDiff).toHaveBeenCalledTimes(1)

    mockGetDiff.mockResolvedValueOnce('DIFF_STAGED')
    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageHunk('PATCH')
    })
    await waitFor(() => expect(mockStageFile).toHaveBeenCalled())

    // refreshGitStatus がまだ未解決の間は、gitStatusFiles(まだ index:'?' のまま)を
    // 使った再取得(2回目の getDiff)はまだ発火していないはず
    await Promise.resolve()
    await Promise.resolve()
    expect(mockGetDiff).toHaveBeenCalledTimes(1)

    resolveRefreshGitStatus()
    await act(async () => {
      await stagePromise
    })
    expect(mockGetDiff).toHaveBeenCalledTimes(2)
  })

  it('ハンク操作成功後、diffRefreshSignal 起因の再取得(2回目の getDiff)が完了するまで isHunkOperationInProgress は true のまま', async () => {
    // isHunkOperationInProgress を diffRefreshSignal 起因の再取得完了前に false に
    // 戻すと、まだ古い diffContent が表示されたままハンクボタンが再有効化され、
    // その古い行番号/コンテキストに基づくパッチで2つ目のハンク操作を送ってしまい、
    // git apply --cached が失敗・誤適用するおそれがある
    mockGetDiff.mockResolvedValueOnce('DIFF_BEFORE')
    mockStageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_BEFORE'))

    let resolveSecondGetDiff: (value: string) => void = () => {}
    mockGetDiff.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveSecondGetDiff = resolve))
    )
    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageHunk('PATCH')
    })

    // 2回目の getDiff(diffRefreshSignal 起因)が発火するまで待つ
    await waitFor(() => expect(mockGetDiff).toHaveBeenCalledTimes(2))
    // その getDiff がまだ未解決の間は isHunkOperationInProgress は true のまま。
    // diffContent は(タブ切替時と同じロジックで)取得中は null にクリアされるため、
    // 古い内容のまま次のハンク操作のボタンが描画されることも無い
    expect(result.current.isHunkOperationInProgress).toBe(true)
    expect(result.current.diffContent).toBeNull()

    resolveSecondGetDiff('DIFF_AFTER')
    await act(async () => {
      await stagePromise
    })
    expect(result.current.diffContent).toBe('DIFF_AFTER')
    expect(result.current.isHunkOperationInProgress).toBe(false)
  })

  it('外部の fileLock で対象パスが既にロックされている場合、stageHunk(git apply --cached)を呼ばない(ファイル全体 stage との競合防止)', async () => {
    // useGitOperations のファイル全体 stage(git add)が同じファイルに対して実行中の間、
    // ハンク単位の stageHunk まで実行されると、両方が同時に .git/index を
    // 書き換えてしまう
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const fileLock = makeFileLock({ isLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [], fileLock)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageHunk).not.toHaveBeenCalled()
  })

  it('外部の fileLock で別ファイルが実行中(isAnyLocked)の場合、stageHunk(git apply --cached)を呼ばない(useGitOperations 側の全体 stage/commit との競合防止)', async () => {
    // useGitOperations.ts の runStageOperation は stagingPathsRef.size > 0 や
    // lock.isAnyLocked() を見て、無関係な別ファイルへの stage 中でも新規の
    // stage/unstage をブロックしている(cycle 42 で対応済み)。しかし
    // runHunkOperation 側は lock.isLocked(activeDiffTab.path)(対象パス単独)しか
    // 見ておらず、非対称だった。ファイル B の通常 stage(git add)実行中に、
    // 無関係なファイル A のハンクをステージすると、lock.isLocked('A') は false の
    // ためガードを素通りし、git apply --cached が git add と同時に
    // .git/index へ書き込みに行ってしまう
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'a.ts', staged: false }
    const fileLock = makeFileLock({
      isLocked: vi.fn().mockReturnValue(false),
      isAnyLocked: vi.fn().mockReturnValue(true)
    })
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [], fileLock)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageHunk).not.toHaveBeenCalled()
  })

  it('activeDiffTab が null のときは stageHunk を呼ばない', async () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(null, refreshGitStatus, []))
    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })
    expect(mockStageHunk).not.toHaveBeenCalled()
  })

  it('失敗した場合、unhandled rejection にならず diffError がセットされる', async () => {
    mockGetDiff.mockResolvedValueOnce('DIFF_TEXT')
    mockStageHunk.mockRejectedValue(new Error('apply failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    // stageHunk 失敗後は diff の再取得がトリガーされる。ここでも実体がまだ壊れた
    // ままの状況を想定し、その再取得も失敗させることで diffError が残ることを確認する
    mockGetDiff.mockRejectedValueOnce(new Error('apply failed'))
    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(result.current.diffError?.message).toBe('apply failed')
    // 失敗後は古い diffContent(ステージ済みボタン付きのハンク表示)を残さない。
    // 残したままだと、既に実体と食い違っている可能性のある古いハンクに対して
    // ユーザーが誤って再操作を試みてしまう
    expect(result.current.diffContent).toBeNull()
  })

  it('操作実行中に別タブへ切り替え、その後元のタブの操作が失敗しても、切り替え先タブの diffError/diffContent を上書きしない', async () => {
    // runHunkOperation の catch 節は setHunkError/setDiffContent(null) を
    // targetTab が今もアクティブかどうか確認せず無条件に呼んでいた。
    // タブ切り替え自体はブロックされていないため、A でハンク操作の
    // IPC 呼び出しがまだ実行中の間に B のタブへ切り替えることができる。
    // B の diff が正常に読み込まれた後で A の操作が失敗すると、この catch 節が
    // 発火し、無関係な B の diff 表示に A の古いエラーメッセージが乗ってしまう
    mockGetDiff.mockResolvedValueOnce('DIFF_A')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const tabB = { path: 'b.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))

    // A の stageHunk(IPC呼び出し)を保留させたまま実行する
    let rejectStageHunk: (err: Error) => void = () => {}
    mockStageHunk.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectStageHunk = reject))
    )
    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageHunk('PATCH_A')
    })

    // A の操作がまだ実行中の間に、B のタブへ切り替える
    mockGetDiff.mockResolvedValueOnce('DIFF_B')
    rerender({ tab: tabB })
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_B'))
    expect(result.current.diffError).toBeNull()
    expect(mockGetDiff).toHaveBeenCalledTimes(2)

    // ここで A の操作が失敗する
    await act(async () => {
      rejectStageHunk(new Error('apply failed on A'))
      await stagePromise
    })

    // B の表示は A の失敗によって汚染されない。diffRefreshSignal の bump も
    // 起きていないため、無関係な B の diff が誤って再取得されることも無い
    expect(result.current.diffContent).toBe('DIFF_B')
    expect(result.current.diffError).toBeNull()
    expect(mockGetDiff).toHaveBeenCalledTimes(2)
  })

  it('未追跡ファイルのステージは stageHunk ではなく stageFile(git add)を使う', async () => {
    // 未追跡ファイルの diff は main 側が組み立てた疑似diffで、その内容は
    // ワーキングツリーの生バイト列。これを git apply --cached に渡すと
    // git の clean フィルタ(core.autocrlf / .gitattributes の text=auto /
    // git-lfs 等)を通らないため、同じファイルを「+」ボタン(git add)で
    // ステージした場合と index の中身が食い違う(実測: autocrlf=true で
    // git add は LF 正規化、git apply --cached は CRLF のまま)。
    // 疑似diffは常に「全行追加」の 1 ハンクなので、git add に置き換えても
    // ステージされる範囲は変わらない
    mockGetDiff.mockResolvedValue('UNTRACKED_PSEUDO_DIFF')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'new.txt', staged: false }
    const untrackedStatus = [{ path: 'new.txt', index: '?', workingDir: '?' }]
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, untrackedStatus)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('UNTRACKED_PSEUDO_DIFF'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageFile).toHaveBeenCalledWith('new.txt')
    expect(mockStageHunk).not.toHaveBeenCalled()
  })

  it('追跡済みファイルのステージは従来どおり stageHunk(git apply --cached)を使う', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'tracked.ts', staged: false }
    const trackedStatus = [{ path: 'tracked.ts', index: ' ', workingDir: 'M' }]
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, trackedStatus)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageHunk).toHaveBeenCalledWith('tracked.ts', 'PATCH_TEXT')
    expect(mockStageFile).not.toHaveBeenCalled()
  })

  it('git apply は成功し refreshGitStatus だけが失敗した場合、ハンク操作を失敗扱いにしない', async () => {
    // await refreshGitStatus() が try の内側にあると、git apply --cached が
    // 成功した後に git status の再取得だけが reject しても catch へ落ちる。
    // その結果、実際にはステージ済みなのに赤いエラーが出て diffContent も
    // クリアされ、ユーザーには「失敗した」ように見えて再実行を誘発する
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('git status failed'))
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageHunk).toHaveBeenCalled()
    // ハンク操作自体は成功しているのでエラー表示はしない
    expect(result.current.diffError).toBeNull()
  })

  it('失敗後に diff の再取得が成功しても、ハンク操作のエラーは消さずに表示し続ける', async () => {
    // catch で diffError をセットした直後に diffRefreshSignal を bump するため、
    // 再取得 effect の冒頭 setDiffError(null) と、取得成功時の setDiffError(null) で
    // エラーが同じ tick のうちに消えてしまっていた。ファイル自体は読めるので
    // 再取得はほぼ必ず成功し、ユーザーには「ボタンを押したが何も起きなかった」
    // ようにしか見えない(git apply の "patch does not apply" が伝わらない)
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockRejectedValue(new Error('patch does not apply'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    // 再取得は成功して diffContent は戻るが、操作が失敗した事実は残す
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(result.current.diffError?.message).toBe('patch does not apply')
  })

  it('ハンク操作の失敗後、別のタブへ切り替えるとそのエラーは持ち越さない', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockRejectedValue(new Error('patch does not apply'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const tabB = { path: 'b.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })
    await waitFor(() => expect(result.current.diffError).not.toBeNull())

    rerender({ tab: tabB })
    await waitFor(() => expect(result.current.diffError).toBeNull())
  })

  it('失敗後、diff の再取得をトリガーし直す(diffContent が null のまま固まらないようにする)', async () => {
    // catch 節で diffContent を null にクリアするだけで diffRefreshSignal を
    // bump しないと、activeDiffTab/diffRefreshSignal/activeFileStatusKey の
    // いずれも変化しないため再取得の effect が発火せず、タブを閉じて開き直すまで
    // 永久に空白の diff タブが残ってしまう
    mockGetDiff.mockResolvedValueOnce('DIFF_TEXT')
    mockStageHunk.mockRejectedValue(new Error('apply failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    mockGetDiff.mockResolvedValueOnce('DIFF_AFTER_FAILURE')
    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    await waitFor(() => expect(mockGetDiff).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_AFTER_FAILURE'))
  })

  it('実行中は isHunkOperationInProgress が true になり、2回目の呼び出しは stageHunk を呼ばない(多重実行防止)', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    let resolveStage: () => void = () => {}
    mockStageHunk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.stageHunk('PATCH_1')
    })
    expect(result.current.isHunkOperationInProgress).toBe(true)
    act(() => {
      secondCall = result.current.stageHunk('PATCH_2')
    })

    await act(async () => {
      resolveStage()
      await Promise.all([firstCall, secondCall])
    })

    expect(mockStageHunk).toHaveBeenCalledTimes(1)
    expect(mockStageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_1')
    expect(result.current.isHunkOperationInProgress).toBe(false)
  })

  it('タブAでのハンク操作が進行中のまま別タブBへ切り替えても、Bのボタンは無効のまま(押しても無言で捨てられるのを防ぐ)', async () => {
    // runHunkOperation の実際のガードはフック全体で 1 個の
    // isHunkOperationInProgressRef。A で実行中に B へ切り替えると、
    // inProgressTab は A・lock は A のパスのみなので B ではボタンが有効に見えるが、
    // クリックは冒頭のガードで黙って無視される。エラーも表示も出ないため
    // 「押したのに何も起きない」状態になる
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    let resolveStage: () => void = () => {}
    mockStageHunk.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveStage = resolve
      })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const tabB = { path: 'b.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageHunk('PATCH')
    })
    await waitFor(() => expect(mockStageHunk).toHaveBeenCalled())

    // A の操作が未完了のまま B へ切り替える
    rerender({ tab: tabB })
    expect(result.current.isHunkOperationInProgress).toBe(true)

    await act(async () => {
      resolveStage()
      await stagePromise
    })
  })

  it('タブAでのハンク操作が完了していれば、別タブBでは isHunkOperationInProgress が false になる', async () => {
    // A の操作が完了していれば、無関係な B のタブでボタンを disabled に
    // し続けてはいけない(staleTab はタブ単位で判定しているため A の再取得待ちが
    // B へ波及しない)
    mockGetDiff.mockResolvedValue('DIFF_A')
    mockStageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const tabB = { path: 'b.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))

    await act(async () => {
      await result.current.stageHunk('PATCH_A')
    })
    await waitFor(() => expect(result.current.isHunkOperationInProgress).toBe(false))

    mockGetDiff.mockResolvedValueOnce('DIFF_B')
    rerender({ tab: tabB })
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_B'))

    expect(result.current.isHunkOperationInProgress).toBe(false)
  })

  it('ハンク操作の再取得待ち(staleTab)が残っている間にタブが閉じられ(activeDiffTab=null)、後で同じキーのタブを開き直しても、実行中でない操作の disabled 表示を残さない', async () => {
    // ハンク操作成功後、diffRefreshSignal 起因の再取得が完了する前に
    // (例えば useAppState.ts の gitStatus.files effect による自動 closeDiffTab で)
    // activeDiffTab が null になると、取得 effect は `if (activeDiffTab === null) return`
    // で早期リターンし、staleTab をクリアする finally 節に到達しない。
    // staleTab が古いタブを指したまま残ると、後で同じ path/staged の新しい
    // タブオブジェクト(decodeDiffTabPath 等が生成する別参照)を開いた際、
    // isSameKey が構造的に一致してしまい、実際には実行中でない操作の
    // 「実行中」表示(ハンクボタン disabled)が残ってしまう
    mockGetDiff.mockResolvedValueOnce('DIFF_BEFORE')
    mockStageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }: { tab: DiffTabKey | null }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA as DiffTabKey | null } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_BEFORE'))

    // 2回目の getDiff(diffRefreshSignal 起因)を保留させたまま、
    // ハンク操作を実行する
    let resolveSecondGetDiff: (value: string) => void = () => {}
    mockGetDiff.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveSecondGetDiff = resolve))
    )
    act(() => {
      void result.current.stageHunk('PATCH')
    })
    await waitFor(() => expect(mockGetDiff).toHaveBeenCalledTimes(2))
    expect(result.current.isHunkOperationInProgress).toBe(true)

    // 2回目の getDiff がまだ未解決のまま、タブが閉じられる(activeDiffTab=null)
    rerender({ tab: null })

    // 保留していた getDiff を今さら解決させても、cancelled により無視される
    resolveSecondGetDiff('DIFF_STALE')

    // 同じ path/staged だが別オブジェクトのタブを開き直す
    mockGetDiff.mockResolvedValueOnce('DIFF_REOPENED')
    const tabAReopened = { path: 'a.ts', staged: false }
    rerender({ tab: tabAReopened })

    // 新しい取得(3回目の getDiff)がまだ未解決の間、isHunkOperationInProgress は
    // 「操作実行中」ではなく「diff 取得中」を表しているに過ぎない。
    // 実際には誰も操作していないので、取得完了を待たず false になるべき
    expect(result.current.isHunkOperationInProgress).toBe(false)
  })

  it('外部の fileLock で対象パスがロックされている場合、isHunkOperationInProgress は true になる(ファイル全体 stage 中はハンクボタンも disabled にする)', async () => {
    // useGitOperations のファイル全体 stage(git add)が同じファイルに対して実行中の間、
    // このフック自身は「実行中」を認識していない(inProgressTab は null のまま)ため、
    // isHunkOperationInProgress だけを見ると diff タブのハンクボタンが有効に見えて
    // しまい、クリックすると lock.isLocked のガードで黙って無視される
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: false }
    const fileLock = makeFileLock({ isLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [], fileLock)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    expect(result.current.isHunkOperationInProgress).toBe(true)
  })

  it('外部の fileLock で別ファイルが実行中(isAnyLocked)の場合も、isHunkOperationInProgress は true になる(押しても無言で弾かれるだけのボタンを有効に見せない)', async () => {
    // isHunkOperationInProgress の表示判定が lock.isLocked(activeDiffTab.path)
    // (対象パス単独)しか見ていないと、無関係な別ファイル B の stage 実行中でも
    // タブ A のボタンは有効に見えてしまう。runHunkOperation 側は
    // lock.isAnyLocked() で弾くようになったため(上のテスト参照)、表示側も
    // 揃えないと「ボタンは押せそうに見えるのに押しても何も起きない」という、
    // まさにこのファイル冒頭のコメントが警告している状態になる
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'a.ts', staged: false }
    const fileLock = makeFileLock({
      isLocked: vi.fn().mockReturnValue(false),
      isAnyLocked: vi.fn().mockReturnValue(true)
    })
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, [], fileLock)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    expect(result.current.isHunkOperationInProgress).toBe(true)
  })

  it('同じファイルの unstaged タブで操作中に staged タブへ切り替えても isHunkOperationInProgress は true のまま(ロックは path 単位で共有されるため)', async () => {
    // isHunkOperationInProgress の判定を「inProgressTab.path/staged が activeDiffTab と
    // 完全一致するか」だけに頼ると、同じファイルの staged/unstaged 両方のタブが
    // 開かれている場合、片方で操作中でももう片方のタブでは「実行中でない」ように
    // 見えてしまう(クリックすると isHunkOperationInProgressRef のグローバルガードで
    // 黙って無視される)。lock.isLocked は path のみで判定するため、この問題を
    // path 単位のロック共有で解消できているはず
    mockGetDiff.mockResolvedValue('DIFF_UNSTAGED')
    let resolveStage: () => void = () => {}
    mockStageHunk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const unstagedTab = { path: 'src/index.ts', staged: false }
    const stagedTab = { path: 'src/index.ts', staged: true }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: unstagedTab } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_UNSTAGED'))

    act(() => {
      void result.current.stageHunk('PATCH')
    })
    expect(result.current.isHunkOperationInProgress).toBe(true)

    mockGetDiff.mockResolvedValueOnce('DIFF_STAGED')
    rerender({ tab: stagedTab })
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_STAGED'))

    expect(result.current.isHunkOperationInProgress).toBe(true)

    await act(async () => {
      resolveStage()
      await Promise.resolve()
    })
  })

  it('タブAでのハンク操作完了直後(diffRefreshSignal起因の再取得が完了する前)にタブB(別ファイル)へ切り替えても、Bのボタンは無効化されない', async () => {
    // isDiffStale がフック単位のグローバルなブール値のままだと、A の操作完了
    // (isDiffStale=true をセットした直後)にユーザーが無関係なファイル B の
    // タブへ切り替えた場合、B の isHunkOperationInProgress も一時的に true に
    // なってしまい、B のハンクボタンが理由なく disabled に見えてしまう
    mockGetDiff.mockResolvedValueOnce('DIFF_A')
    mockStageHunk.mockResolvedValue(undefined)
    let resolveRefreshGitStatus: () => void = () => {}
    const refreshGitStatus = vi.fn(
      () => new Promise<void>((resolve) => (resolveRefreshGitStatus = resolve))
    )
    const tabA = { path: 'a.ts', staged: false }
    const tabB = { path: 'b.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))

    act(() => {
      void result.current.stageHunk('PATCH_A')
    })
    await waitFor(() => expect(refreshGitStatus).toHaveBeenCalled())

    // A の再取得(diffRefreshSignal 起因)をまだ未解決のまま保留させておく。
    // ここを即座に解決させてしまうと、isDiffStale が false に戻ってから
    // B へ切り替えることになり、再現したいタイミング(A の再取得が終わる
    // 前に B へ切り替える)を検証できない
    let resolveSecondGetDiff: (value: string) => void = () => {}
    mockGetDiff.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveSecondGetDiff = resolve))
    )
    await act(async () => {
      resolveRefreshGitStatus()
      await Promise.resolve()
    })
    // isDiffStale=true がセットされ、A の再取得がまだ未解決の間に、
    // 無関係な B へ切り替える。B 自身の取得もまだ未解決の間に
    // isHunkOperationInProgress を確認しないと、B の effect 完了時点の
    // finally で isDiffStale が false に戻ってしまい、この一瞬だけの
    // 誤った true を見逃してしまう
    let resolveThirdGetDiff: (value: string) => void = () => {}
    mockGetDiff.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolveThirdGetDiff = resolve))
    )
    rerender({ tab: tabB })
    await waitFor(() => expect(mockGetDiff).toHaveBeenCalledTimes(3))

    expect(result.current.isHunkOperationInProgress).toBe(false)

    // 後片付け: A・B それぞれの保留中の getDiff を解決しておく
    resolveSecondGetDiff('DIFF_A_STALE')
    await act(async () => {
      resolveThirdGetDiff('DIFF_B')
      await Promise.resolve()
    })
  })

  it('ハンク操作の実行中に別タブBへ切り替え、その後元のタブAの操作が成功しても、Bの diff を無駄に再取得しない', async () => {
    // catch 節(失敗時)は activeDiffTabRef.current と targetTab が一致する
    // 場合のみ diffRefreshSignal を bump しているのに、try 節(成功時)は
    // このガードが無く常に bump していた。A の操作が完了した時点で既に
    // 無関係な B へ切り替わっていると、B に対して活きている取得 effect が
    // diffRefreshSignal の変化を検知して B の diff を無意味に再取得してしまう
    // (B 自身は何も変わっていないのに IPC 呼び出しが1回無駄になる)
    mockGetDiff.mockResolvedValueOnce('DIFF_A')
    let resolveStageHunk: () => void = () => {}
    mockStageHunk.mockReturnValueOnce(new Promise<void>((resolve) => (resolveStageHunk = resolve)))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const tabA = { path: 'a.ts', staged: false }
    const tabB = { path: 'b.ts', staged: false }
    const { result, rerender } = renderHook(
      ({ tab }) => useDiffOperations(tab, refreshGitStatus, []),
      { initialProps: { tab: tabA } }
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_A'))

    act(() => {
      void result.current.stageHunk('PATCH_A')
    })

    // A の stageHunk がまだ未解決のうちに B へ切り替える(B 自身の取得が1回発生する)
    mockGetDiff.mockResolvedValueOnce('DIFF_B')
    rerender({ tab: tabB })
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_B'))
    expect(mockGetDiff).toHaveBeenCalledTimes(2)

    // ここで A の stageHunk が成功する
    await act(async () => {
      resolveStageHunk()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // B は何も変わっていないので、B 向けの diff 再取得(3回目の呼び出し)は発生しない
    expect(mockGetDiff).toHaveBeenCalledTimes(2)
  })
})

describe('unstageHunk', () => {
  it('gitApi.unstageHunk を activeDiffTab の path と patch で呼ぶ', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockUnstageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: true }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, []))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.unstageHunk('PATCH_TEXT')
    })

    expect(mockUnstageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_TEXT')
    expect(refreshGitStatus).toHaveBeenCalled()
  })
})

describe('discardHunk', () => {
  const activeTab = { path: 'src/index.ts', staged: false }
  const modified = [{ path: 'src/index.ts', index: ' ', workingDir: 'M' }]

  it('gitApi.discardHunk を path と patch で呼び、成功で true を返して diff を取り直す', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockDiscardHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, modified))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledTimes(1)

    let ok = false
    await act(async () => {
      ok = await result.current.discardHunk('PATCH_TEXT')
    })

    expect(ok).toBe(true)
    expect(mockDiscardHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_TEXT')
    expect(refreshGitStatus).toHaveBeenCalled()
    await waitFor(() => expect(mockGetDiff).toHaveBeenCalledTimes(2))
  })

  it('失敗すると false を返し、diffError に入り、diff を取り直す', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockDiscardHunk.mockRejectedValue(new Error('取り消せませんでした'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, modified))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let ok = true
    await act(async () => {
      ok = await result.current.discardHunk('PATCH_TEXT')
    })

    expect(ok).toBe(false)
    expect(result.current.diffError?.message).toBe('取り消せませんでした')
    await waitFor(() => expect(mockGetDiff).toHaveBeenCalledTimes(2))
  })

  it('実行中の 2 回目は false を返し、gitApi.discardHunk は 1 回だけ呼ぶ', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    let resolveDiscard: () => void = () => {}
    mockDiscardHunk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDiscard = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, modified))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(true)
    act(() => {
      first = result.current.discardHunk('PATCH_1')
    })
    act(() => {
      second = result.current.discardHunk('PATCH_2')
    })
    let results: boolean[] = []
    await act(async () => {
      resolveDiscard()
      results = await Promise.all([first, second])
    })

    expect(results).toEqual([true, false])
    expect(mockDiscardHunk).toHaveBeenCalledTimes(1)
  })

  it('他のパスがロック中(isAnyLocked)は false を返し、gitApi.discardHunk を呼ばない', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useDiffOperations(activeTab, refreshGitStatus, modified, lock)
    )
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let ok = true
    await act(async () => {
      ok = await result.current.discardHunk('PATCH_TEXT')
    })

    expect(ok).toBe(false)
    expect(mockDiscardHunk).not.toHaveBeenCalled()
  })

  it('stageHunk / unstageHunk は従来どおり void を返す(boolean を公開しない)', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockResolvedValue(undefined)
    mockUnstageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus, modified))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let staged: unknown = 'x'
    let unstaged: unknown = 'x'
    await act(async () => {
      staged = await result.current.stageHunk('P')
      unstaged = await result.current.unstageHunk('P')
    })

    expect(staged).toBeUndefined()
    expect(unstaged).toBeUndefined()
  })
})

describe('canDiscardHunk', () => {
  const unstagedTab = { path: 'a.ts', staged: false }
  const compute = (
    tab: DiffTabKey | null,
    files: { path: string; index: string; workingDir: string }[]
  ): boolean => {
    mockGetDiff.mockResolvedValue('DIFF')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(tab, refreshGitStatus, files))
    return result.current.canDiscardHunk
  }

  it('未ステージの diff で追跡済みの変更ファイルなら true', () => {
    expect(compute(unstagedTab, [{ path: 'a.ts', index: ' ', workingDir: 'M' }])).toBe(true)
  })

  it('ステージ済み diff は false', () => {
    expect(
      compute({ path: 'a.ts', staged: true }, [{ path: 'a.ts', index: 'M', workingDir: 'M' }])
    ).toBe(false)
  })

  it('未追跡(??)は false', () => {
    expect(compute(unstagedTab, [{ path: 'a.ts', index: '?', workingDir: '?' }])).toBe(false)
  })

  it('intent-to-add( A)は false', () => {
    expect(compute(unstagedTab, [{ path: 'a.ts', index: ' ', workingDir: 'A' }])).toBe(false)
  })

  it('コンフリクト(UU)は false', () => {
    expect(compute(unstagedTab, [{ path: 'a.ts', index: 'U', workingDir: 'U' }])).toBe(false)
  })

  it('git status に対象ファイルが無ければ false', () => {
    expect(compute(unstagedTab, [])).toBe(false)
  })

  it('activeDiffTab が null なら false', () => {
    expect(compute(null, [{ path: 'a.ts', index: ' ', workingDir: 'M' }])).toBe(false)
  })
})
