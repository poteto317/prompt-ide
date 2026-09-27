import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitOperations } from '../useGitOperations'
import type { FileOperationLock } from '../useFileOperationLock'

const mockStageFile = vi.mocked(gitApi.stageFile)
const mockUnstageFile = vi.mocked(gitApi.unstageFile)
const mockCommitChanges = vi.mocked(gitApi.commitChanges)
const mockAmendCommit = vi.mocked(gitApi.amendCommit)

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

describe('stageFile', () => {
  it('gitApi.stageFile を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockStageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(mockStageFile).toHaveBeenCalledWith('src/index.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('実行中は stagingPaths にそのパスを含む', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageFile('src/index.ts')
    })
    expect(result.current.stagingPaths.has('src/index.ts')).toBe(true)

    await act(async () => {
      resolveStage()
      await stagePromise
    })
    expect(result.current.stagingPaths.has('src/index.ts')).toBe(false)
  })

  it('同じパスへの多重呼び出しは stageFile を1回しか呼ばない', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.stageFile('src/index.ts')
      secondCall = result.current.stageFile('src/index.ts')
    })

    await act(async () => {
      resolveStage()
      await Promise.all([firstCall, secondCall])
    })
    expect(mockStageFile).toHaveBeenCalledTimes(1)
  })

  it('異なるパスへの stageFile 呼び出しも直列化する(同時に git add を2つ走らせて index.lock 競合を起こさない)', async () => {
    // stagingPathsRef.has(path)/lock.isLocked(path) はパス単位の判定のため、
    // 異なるパス A/B への stageFile はガードをすり抜けて同時に実行されていた。
    // git add/reset はどちらも同じ .git/index を書き換えるため、同時に走らせると
    // 片方が「Unable to create '.git/index.lock': File exists.」のような
    // 無関係なエラーで失敗する(コミット実行中の排他制御と同じ理由)
    let resolveFirstStage: () => void = () => {}
    mockStageFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.stageFile('a.ts')
      secondCall = result.current.stageFile('b.ts')
    })
    expect(mockStageFile).toHaveBeenCalledTimes(1)
    expect(mockStageFile).toHaveBeenCalledWith('a.ts')

    await act(async () => {
      resolveFirstStage()
      await Promise.all([firstCall, secondCall])
    })
    // B は A の完了後に別途呼び出せば実行される(直列化であって永久ブロックではない)
    mockStageFile.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.stageFile('b.ts')
    })
    expect(mockStageFile).toHaveBeenCalledWith('b.ts')
  })

  it('失敗した場合 operationError がセットされ、refreshGitStatus も呼ばれる', async () => {
    mockStageFile.mockRejectedValue(new Error('add failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(result.current.operationError?.message).toBe('add failed')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('stageFile 自体が失敗し、その後の refreshGitStatus も失敗した場合、本来の stage 失敗理由を refresh 失敗のエラーで上書きしない', async () => {
    // finally 節の catch にガードが無いと、stageFile(git add)の本当の失敗理由
    // (権限エラー等)が、無関係な refreshGitStatus 失敗のメッセージで
    // 無条件に上書きされてしまう
    mockStageFile.mockRejectedValue(new Error('add failed: permission denied'))
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('status failed'))
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(result.current.operationError?.message).toBe('add failed: permission denied')
  })

  it('外部の fileLock で既にロックされているパスは stageFile を呼ばない(ハンク操作との競合防止)', async () => {
    // useDiffOperations のハンク操作(git apply --cached)が同じファイルに対して
    // 実行中の間、ChangesSection からの stageFile(git add)まで実行されると、
    // 両方が同時に .git/index を書き換えてしまう
    mockStageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const fileLock = makeFileLock({ isLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() => useGitOperations(refreshGitStatus, fileLock))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(mockStageFile).not.toHaveBeenCalled()
  })

  it('refreshGitStatus が失敗しても、stagingPaths とロックは必ず解除される', async () => {
    // finally 節内で await した refreshGitStatus が reject すると、その直後に
    // 続くクリーンアップ(stagingPathsRef の削除・lock.unlock)が実行されないまま
    // 関数全体が reject して終了してしまう。これが起きると、このファイルは
    // 永久に「実行中」のまま残り、共有ロック(useDiffOperations と共有)を通じて
    // ハンク操作側のボタンまで無期限に disabled になってしまう
    mockStageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('status failed'))
    const fileLock = makeFileLock()
    const { result } = renderHook(() => useGitOperations(refreshGitStatus, fileLock))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(result.current.stagingPaths.has('src/index.ts')).toBe(false)
    expect(fileLock.unlock).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('unstageFile', () => {
  it('gitApi.unstageFile を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockUnstageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.unstageFile('src/index.ts')
    })

    expect(mockUnstageFile).toHaveBeenCalledWith('src/index.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('renamedFrom を渡すと gitApi.unstageFile の第2引数にそのまま渡す(リネームを片方だけ取り消さないように)', async () => {
    // 新パスだけをアンステージすると、旧パスの削除だけが index に残ったまま
    // (D old.txt / ?? new.txt)になり、壊れた状態を作ってしまう
    // (main/gitService.ts で実機再現確認済み)。旧パスを呼び出し元まで通す
    mockUnstageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.unstageFile('new.txt', 'old.txt')
    })

    expect(mockUnstageFile).toHaveBeenCalledWith('new.txt', 'old.txt')
  })
})

describe('commit', () => {
  it('gitApi.commitChanges を呼び、成功時に true を返し refreshGitStatus を呼ぶ', async () => {
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = false
    await act(async () => {
      commitResult = await result.current.commit('feat: 新機能')
    })

    expect(mockCommitChanges).toHaveBeenCalledWith('feat: 新機能')
    expect(commitResult).toBe(true)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗時は false を返し operationError をセットする', async () => {
    mockCommitChanges.mockRejectedValue(new Error('commit failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = true
    await act(async () => {
      commitResult = await result.current.commit('msg')
    })

    expect(commitResult).toBe(false)
    expect(result.current.operationError?.message).toBe('commit failed')
  })

  it('commit 自体が失敗し、その後の refreshGitStatus も失敗した場合、本来の commit 失敗理由を refresh 失敗のエラーで上書きしない', async () => {
    // finally 節の「committed のときだけ上書きしない」という条件が反転していると、
    // commit が失敗した場合(committed=false)にこそ setOperationError(refresh失敗) が
    // 実行され、pre-commit hook のエラー等ユーザーが本来見るべき失敗理由が
    // 無関係な refresh 失敗のメッセージで消されてしまう
    mockCommitChanges.mockRejectedValue(new Error('pre-commit hook failed'))
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('status failed'))
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = true
    await act(async () => {
      commitResult = await result.current.commit('msg')
    })

    expect(commitResult).toBe(false)
    expect(result.current.operationError?.message).toBe('pre-commit hook failed')
  })

  it('実行中は isCommitting が true になる', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg')
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveCommit()
      await commitPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('isCommitting が false に戻るのは refreshGitStatus 完了後(commit() 自体が解決するのと同じタイミング)', async () => {
    // isCommitting を refreshGitStatus 完了前に false へ戻すと、呼び出し元(App.tsx)が
    // 「commit() 完了後に別のフラグ(isHistoryRefreshing)で保護する」という設計でも、
    // isCommitting=false かつ isHistoryRefreshing=false になる隙間が生まれ、
    // その間の再クリックで同じメッセージのコミットが二重実行されてしまう
    mockCommitChanges.mockResolvedValue(undefined)
    let resolveRefresh: () => void = () => {}
    const refreshGitStatus = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let settled = false
    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg').then((v) => {
        settled = true
        return v
      })
    })

    // commitChanges 自体はすぐ解決するが、refreshGitStatus がまだ未解決の間は
    // commit() も isCommitting も「実行中」のままのはず
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(settled).toBe(false)
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveRefresh()
      await commitPromise
    })
    expect(settled).toBe(true)
    expect(result.current.isCommitting).toBe(false)
  })

  it('extraRefresh を渡すと refreshGitStatus と並列に実行され、両方完了するまで isCommitting は true のまま', async () => {
    // App.tsx の runCommitLike は commit()/amend() 完了後に refreshHistory() を
    // 直列で待っていたため、refreshGitStatus(git status)と refreshHistory(git log 等)
    // という独立した2つの IPC 呼び出しが直列化され、無駄にコミットボタンの
    // 無効化時間が延びていた。extraRefresh として refreshHistory 相当の処理を
    // commit()/amend() に渡せるようにし、refreshGitStatus と Promise.all で
    // 並列実行することで、どちらか遅い方の時間だけで済むようにする
    mockCommitChanges.mockResolvedValue(undefined)
    let resolveGitStatus: () => void = () => {}
    const refreshGitStatus = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveGitStatus = resolve
        })
    )
    let resolveHistory: () => void = () => {}
    const extraRefresh = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveHistory = resolve
        })
    )
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg', extraRefresh)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    // 両方とも呼ばれているはず(直列ではなく並列に開始されている)
    expect(refreshGitStatus).toHaveBeenCalledTimes(1)
    expect(extraRefresh).toHaveBeenCalledTimes(1)
    expect(result.current.isCommitting).toBe(true)

    // refreshGitStatus だけ解決してもまだ isCommitting は true のまま
    // (extraRefresh がまだ未解決)
    await act(async () => {
      resolveGitStatus()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveHistory()
      await commitPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('コミット中の多重呼び出しは commitChanges を1回しか呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(false)
    act(() => {
      first = result.current.commit('msg1')
      second = result.current.commit('msg2')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([first, second])
    })
    expect(mockCommitChanges).toHaveBeenCalledTimes(1)
  })

  it('refreshGitStatus が失敗しても、isCommitting は必ず false に戻る', async () => {
    // finally 節内で await した Promise.all(refreshGitStatus, extraRefresh)が
    // reject すると、その直後の isCommittingRef 解除が実行されないまま関数全体が
    // reject してしまい、コミットボタンが永久に「実行中」表示のまま残る
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('status failed'))
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.commit('msg')
    })

    expect(result.current.isCommitting).toBe(false)
  })

  it('コミット自体は成功したのに、その後の refreshGitStatus 失敗で operationError がセットされ、コミットが失敗したかのように見えてしまわない', async () => {
    // commit()/amend() は git commit 成功時点で setOperationError(null) を呼ぶが、
    // 直後の finally 内で refreshGitStatus が失敗すると無条件に
    // setOperationError(toError(err)) で上書きしていた。SourceControlPanel は
    // operationError.message をそのままエラー表示するため、コミット自体は
    // 成功しているのに「コミットに失敗した」かのようなエラーがユーザーに
    // 見えてしまう。git commit の成否と、事後の状態再取得の成否は独立して
    // 扱う必要がある
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('status failed'))
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = false
    await act(async () => {
      commitResult = await result.current.commit('msg')
    })

    expect(commitResult).toBe(true)
    expect(result.current.operationError).toBe(null)
  })
})

describe('amend', () => {
  it('gitApi.amendCommit を呼び、成功時に true を返し refreshGitStatus を呼ぶ', async () => {
    mockAmendCommit.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendResult = false
    await act(async () => {
      amendResult = await result.current.amend('feat: 修正後')
    })

    expect(mockAmendCommit).toHaveBeenCalledWith('feat: 修正後')
    expect(amendResult).toBe(true)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗時は false を返し operationError をセットする', async () => {
    mockAmendCommit.mockRejectedValue(new Error('amend failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendResult = true
    await act(async () => {
      amendResult = await result.current.amend('msg')
    })

    expect(amendResult).toBe(false)
    expect(result.current.operationError?.message).toBe('amend failed')
  })

  it('実行中は isCommitting が true になる', async () => {
    let resolveAmend: () => void = () => {}
    mockAmendCommit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAmend = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      amendPromise = result.current.amend('msg')
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveAmend()
      await amendPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('commit 実行中の amend 呼び出しは amendCommit を呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    let amendPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg1')
      amendPromise = result.current.amend('msg2')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([commitPromise, amendPromise])
    })
    expect(mockAmendCommit).not.toHaveBeenCalled()
  })
})

describe('commit と stageFile/unstageFile の排他制御', () => {
  // commit(git commit)と stageFile/unstageFile(git add/reset)はどちらも
  // .git/index を書き換える。git 自体は .git/index.lock で排他するため
  // データ破損はしないが、同時に走らせると片方が「Unable to create
  // '.git/index.lock': File exists.」のような無関係なエラーで失敗し、
  // ユーザーには理由の分からない失敗に見える。isCommitting/stagingPaths の
  // 両方をロックとして扱い、UI 側の disabled 漏れに関わらず内部で弾く
  it('コミット実行中は stageFile を呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    mockStageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      commitPromise = result.current.commit('msg')
      stagePromise = result.current.stageFile('src/index.ts')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([commitPromise, stagePromise])
    })
    expect(mockStageFile).not.toHaveBeenCalled()
  })

  it('コミット実行中は unstageFile を呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    mockUnstageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    let unstagePromise: Promise<void> = Promise.resolve()
    act(() => {
      commitPromise = result.current.commit('msg')
      unstagePromise = result.current.unstageFile('src/index.ts')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([commitPromise, unstagePromise])
    })
    expect(mockUnstageFile).not.toHaveBeenCalled()
  })

  it('stageFile 実行中は commit を呼ばない', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let stagePromise: Promise<void> = Promise.resolve()
    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      stagePromise = result.current.stageFile('src/index.ts')
      commitPromise = result.current.commit('msg')
    })

    await act(async () => {
      resolveStage()
      await Promise.all([stagePromise, commitPromise])
    })
    expect(mockCommitChanges).not.toHaveBeenCalled()
  })
})

describe('commit と共有 fileLock(ハンク操作)の排他制御', () => {
  // useDiffOperations.ts のハンク単位ステージ/アンステージ(git apply --cached)は
  // useGitOperations.ts とは別関数で、同じ path を stagingPathsRef には
  // 記録しない(共有 fileLock だけに記録する)。commit 側が fileLock を
  // 見ていないと、ハンク操作の実行中でも commit が git commit を発行でき、
  // 両方が同時に .git/index を書き換えてしまう
  it('共有 fileLock がいずれかのパスをロックしている間は commit を呼ばない', async () => {
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const fileLock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() => useGitOperations(refreshGitStatus, fileLock))

    let commitResult = true
    await act(async () => {
      commitResult = await result.current.commit('msg')
    })

    expect(mockCommitChanges).not.toHaveBeenCalled()
    expect(commitResult).toBe(false)
  })

  it('commit 実行中は共有 fileLock を全体ロックし、完了後に解除する', async () => {
    // 全体ロックにより、ハンク操作側(useDiffOperations の runHunkOperation)の
    // lock.isLocked(path) チェックが対象パスを問わず true になり、
    // commit 実行中の git apply --cached を弾ける
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const fileLock = makeFileLock()
    const { result } = renderHook(() => useGitOperations(refreshGitStatus, fileLock))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg')
    })
    expect(fileLock.lockGlobal).toHaveBeenCalledOnce()
    expect(fileLock.unlockGlobal).not.toHaveBeenCalled()

    await act(async () => {
      resolveCommit()
      await commitPromise
    })
    expect(fileLock.unlockGlobal).toHaveBeenCalledOnce()
  })
})
