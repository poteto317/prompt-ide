import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { toError } from '../lib/errorUtils'

export interface GitOperationsState {
  stagingPaths: ReadonlySet<string>
  stageFile: (path: string) => Promise<void>
  unstageFile: (path: string, renamedFrom?: string) => Promise<void>
  isCommitting: boolean
  commit: (message: string, extraRefresh?: () => Promise<void>) => Promise<boolean>
  amend: (message: string, extraRefresh?: () => Promise<void>) => Promise<boolean>
  operationError: Error | null
}

export function useGitOperations(
  refreshGitStatus: () => Promise<void>,
  fileLock?: FileOperationLock
): GitOperationsState {
  // useFileEditing.ts の savingPaths と同じパターン。即座に判定できる ref と、
  // 再レンダーを起こすための state を両方持つ
  const [stagingPaths, setStagingPaths] = useState<ReadonlySet<string>>(() => new Set())
  const stagingPathsRef = useRef<Set<string>>(new Set())
  const [isCommitting, setIsCommitting] = useState(false)
  const isCommittingRef = useRef(false)
  const [operationError, setOperationError] = useState<Error | null>(null)
  // fileLock が渡されなければ(単体テスト等)このフック内だけで完結するローカルな
  // ロックにフォールバックする。useAppState.ts から注入されると、useDiffOperations の
  // ハンク操作と同じロックを共有し、同一ファイルへの git.index 書き込みが競合しない
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock

  const runStageOperation = async (
    path: string,
    operation: (path: string, renamedFrom?: string) => Promise<void>,
    renamedFrom?: string
  ): Promise<void> => {
    // commit(git commit)と stageFile/unstageFile(git add/reset)はどちらも
    // .git/index を書き換える。git 自体は .git/index.lock で排他するためデータ
    // 破損はしないが、同時に走らせると片方が「Unable to create
    // '.git/index.lock': File exists.」のような無関係なエラーで失敗し、
    // ユーザーには理由の分からない失敗に見えてしまう。
    // stagingPathsRef.current.has(path)/lock.isLocked(path) はパス単位の判定のため、
    // 異なるパス A・B への stageFile/unstageFile 呼び出しはこのガードをすり抜けて
    // 同時に実行できてしまっていた。stagingPathsRef.current.size > 0(他の
    // stage/unstage が実行中)と lock.isAnyLocked()(他のパスでハンク操作が
    // 実行中)を見ることで、対象パスに関わらず git.index への書き込みを
    // 1 つずつに直列化する(commit 側の isAnyLocked チェックと同じ理由)
    if (
      stagingPathsRef.current.size > 0 ||
      lock.isAnyLocked() ||
      lock.isLocked(path) ||
      isCommittingRef.current
    ) {
      return
    }
    stagingPathsRef.current.add(path)
    setStagingPaths(new Set(stagingPathsRef.current))
    lock.lock(path)
    try {
      // renamedFrom が undefined のときも第2引数として明示的に渡すと、
      // stageFile(gitApi.stageFile はそもそも renamedFrom という概念を持たない)
      // の呼び出しにまで無関係な undefined が渡ってしまう
      if (renamedFrom === undefined) {
        await operation(path)
      } else {
        await operation(path, renamedFrom)
      }
      setOperationError(null)
    } catch (err) {
      setOperationError(toError(err))
    } finally {
      // refreshGitStatus 完了前にガードを解除すると、ステータス再取得中に
      // 同じファイルへの再クリックが可能になり、その file がまだ「実行中」で
      // あるかのように見せている refreshGitStatus の完了前に stageFile/unstageFile が
      // 再度呼ばれてしまう。stageFile/unstageFile の Promise が解決するタイミングと
      // stagingPaths からの解除タイミングを一致させる。
      // refreshGitStatus が reject した場合に内側の try/catch が無いと、
      // 直後の stagingPathsRef 解除・lock.unlock が実行されないまま関数全体が
      // reject してしまい、このファイルが永久に「実行中」のまま残る
      // (共有ロック経由でハンク操作側のボタンも無期限に disabled になる)
      try {
        await refreshGitStatus()
      } catch {
        // refreshGitStatus 自体の失敗理由でここを無条件に上書きすると、
        // stageFile/unstageFile 自体が失敗していた場合、上の catch で既に
        // セットした本当の失敗理由(権限エラー等)が、無関係な refresh 失敗の
        // メッセージで消えてしまう。stageFile/unstageFile が成功していた
        // 場合も、操作自体は成功しているのに失敗したかのように見えてしまう
        // (runCommitOperation 側と同じ理由)。git status の取得エラーは
        // useGitStatus 側が自前の gitError として扱うため、ここでは握りつぶす
      } finally {
        stagingPathsRef.current.delete(path)
        setStagingPaths(new Set(stagingPathsRef.current))
        lock.unlock(path)
      }
    }
  }

  const stageFile = (path: string): Promise<void> => runStageOperation(path, gitApi.stageFile)
  const unstageFile = (path: string, renamedFrom?: string): Promise<void> =>
    runStageOperation(path, gitApi.unstageFile, renamedFrom)

  const runCommitOperation = async (
    message: string,
    operation: (message: string) => Promise<void>,
    extraRefresh?: () => Promise<void>
  ): Promise<boolean> => {
    // stageFile/unstageFile と同じ理由で、進行中の stage/unstage 操作がある間は
    // commit/amend も実行しない(runStageOperation 側のコメント参照)。
    // lock.isAnyLocked() は useDiffOperations のハンク単位操作(git apply --cached)
    // が同じ共有ロックを通じて実行中かどうかを見る。stagingPathsRef はこのフック
    // 自身の stageFile/unstageFile しか記録しないため、これだけでは検知できない
    if (isCommittingRef.current || stagingPathsRef.current.size > 0 || lock.isAnyLocked()) {
      return false
    }
    isCommittingRef.current = true
    setIsCommitting(true)
    // commit(git commit)実行中は git.index 全体が書き換わるため、対象パスを
    // 問わずハンク操作を弾く必要がある。個別パスの lock/unlock ではなく
    // 全体ロックを使う(runHunkOperation 側の lock.isLocked(path) が
    // 対象パスに関わらず true を返すようになる)
    lock.lockGlobal()
    try {
      await operation(message)
      setOperationError(null)
      return true
    } catch (err) {
      setOperationError(toError(err))
      return false
    } finally {
      // refreshGitStatus 完了前に isCommitting を false へ戻すと、呼び出し元(App.tsx)が
      // 「commit()/amend() 完了後に別のフラグ(isHistoryRefreshing)で保護する」という
      // 設計であっても、isCommitting=false かつ isHistoryRefreshing=false になる隙間が
      // 生まれ、その間の再クリックで同じメッセージのコミットが二重実行されてしまう。
      // commit()/amend() の Promise が解決するタイミングと isCommitting が false に
      // 戻るタイミングを一致させる。
      // extraRefresh(App.tsx から渡される refreshHistory)は refreshGitStatus とは
      // 独立した IPC 呼び出しのため、直列で待つと無駄にコミットボタンの無効化時間が
      // 延びる。Promise.all で並列実行し、遅い方の完了を待つ。
      // どちらかが reject した場合に内側の try/catch が無いと、直後の
      // isCommittingRef 解除が実行されないまま関数全体が reject してしまい、
      // コミットボタンが永久に「実行中」表示のまま残る
      try {
        await Promise.all([refreshGitStatus(), extraRefresh?.() ?? Promise.resolve()])
      } catch {
        // ここでの失敗(状態の再取得に失敗しただけ)を無条件に operationError へ
        // セットすると、SourceControlPanel の単純な表示(operationError.message を
        // そのまま出す)では「コミットに失敗した」かのようにユーザーへ見えてしまう。
        // commit 自体が成功している場合はもちろん、commit 自体が失敗していた
        // 場合もその本当の理由(pre-commit hook のエラー等、上の catch で既に
        // セット済み)を refresh 失敗のメッセージで上書きしてはならない。
        // git status の取得エラーは useGitStatus 側が自前の gitError として
        // 扱うため、ここでは握りつぶす
      } finally {
        isCommittingRef.current = false
        setIsCommitting(false)
        lock.unlockGlobal()
      }
    }
  }

  const commit = (message: string, extraRefresh?: () => Promise<void>): Promise<boolean> =>
    runCommitOperation(message, gitApi.commitChanges, extraRefresh)
  const amend = (message: string, extraRefresh?: () => Promise<void>): Promise<boolean> =>
    runCommitOperation(message, gitApi.amendCommit, extraRefresh)

  return { stagingPaths, stageFile, unstageFile, isCommitting, commit, amend, operationError }
}
