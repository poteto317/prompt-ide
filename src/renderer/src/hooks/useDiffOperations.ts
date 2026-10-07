import { useEffect, useMemo, useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { fetchDiffForTab } from '../lib/diffTabSource'
import type { GitFileStatus } from '@shared/types'
import { isSameKey } from './useDiffTabs'
import type { DiffTabKey } from './useDiffTabs'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { isSamePath } from '../lib/pathUtils'
import { toError } from '../lib/errorUtils'
import { isUntrackedFile } from '../lib/gitUtils'
import { canDiscardHunkFor } from '../lib/discardTarget'
import { useLatestRef } from './useLatestRef'

export interface DiffOperationsState {
  diffContent: string | null
  diffStaged: boolean
  /** diff の取得・ハンク操作で発生したエラー。ユーザーに見せるための状態 */
  diffError: Error | null
  /** ハンクのステージ/アンステージが実行中か。多重実行防止のガードにも使う */
  isHunkOperationInProgress: boolean
  stageHunk: (patch: string) => Promise<void>
  unstageHunk: (patch: string) => Promise<void>
  /** ハンクを取り消す(作業ツリーを index の内容へ戻す)。確認は呼び出し元(useDiscardHunk)が
   *  行う。戻り値は実際に実行され成功したか(排他で弾かれた・失敗は false)。useAppState は
   *  確認・タブ同期つきの同名の関数で差し替えて公開する */
  discardHunk: (patch: string) => Promise<boolean>
  /** 開いている diff が未ステージで、対象が追跡済みの変更ファイル(未追跡・intent-to-add・
   *  コンフリクトでない)か。ハンクの取り消しボタンを出してよいかの判定に使う */
  canDiscardHunk: boolean
  /** activeDiffTab も git status も変わらないまま diff を取り直す。
   *  エディタでのファイル保存は git status のステータス文字を変えない
   *  (既に " M" のファイルを編集・保存しても " M" のまま)ため、
   *  activeFileStatusKey 依存の自動再取得では検知できない。取り直さないと、
   *  保存前の古い diffContent から作った patch を「このハンクをステージ」で
   *  送ってしまい、ユーザーが一度も意図していない内容が index に入る */
  refreshDiff: () => void
  /** 現在開いている diff タブが未追跡ファイルの diff か。DiffView が「表示の打ち切り時に
   *  ハンク操作ボタンを隠す」判定を無効化するために使う(未追跡ファイルの
   *  stageHunk は patch を使わずファイル全体を git add するだけのため)。
   *  エージェントの変更の diff(kind: 'agent')では常に false */
  isActiveFileUntracked: boolean
}

/**
 * diff タブの内容取得と、ハンク単位のステージ/アンステージを担う。
 * activeDiffTab が変わるたびに diff を再取得し、ハンク操作後は明示的な
 * トリガー(diffRefreshSignal)で同じタブのまま再取得する。
 */
export function useDiffOperations(
  activeDiffTab: DiffTabKey | null,
  refreshGitStatus: () => Promise<void>,
  gitStatusFiles: GitFileStatus[],
  fileLock?: FileOperationLock
): DiffOperationsState {
  // fileLock が渡されなければ(単体テスト等)このフック内だけで完結するローカルな
  // ロックにフォールバックする。useAppState.ts から注入されると、useGitOperations の
  // ファイル全体 stage/unstage と同じロックを共有し、同一ファイルへの
  // git.index 書き込み(git add/reset と git apply --cached)が競合しない
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  // runHunkOperation は非同期処理の途中で activeDiffTab が別タブへ切り替わったかを
  // 判定する必要があるが、runHunkOperation 自体は毎レンダー再生成される通常の
  // 関数のため、await 後に読む時点では activeDiffTab の最新値を ref 経由で確認する
  const activeDiffTabRef = useLatestRef(activeDiffTab)
  const [diffContent, setDiffContent] = useState<string | null>(null)
  // diffStaged は activeDiffTab.kind から常に導出できる値のため、専用の state で
  // 二重管理しない。state のままだと getDiff の解決後にのみ同期していたため、
  // 取得中(fetch が未解決の間)は前のタブの staged 値が残り続けてしまっていた
  // エージェントの変更の diff(kind: 'agent')は index と無関係のため false(ステージ・アンステージの操作は出さない)
  const diffStaged = activeDiffTab?.kind === 'staged'
  // diff の取得エラー。タブ切替・再取得のたびにリセットされる
  const [fetchError, setFetchError] = useState<Error | null>(null)
  // ハンク操作(git apply --cached)の失敗。取得エラーと分けているのは、
  // 操作失敗の直後に diff の再取得をトリガーしている(古い diffContent を
  // 残さないため)関係で、同じスロットに入れると再取得 effect 冒頭の
  // クリアと取得成功時のクリアで同じ tick のうちに消えてしまい、
  // ユーザーには「ボタンを押したが何も起きなかった」ようにしか見えないため。
  // ファイル自体は読めるので再取得はほぼ必ず成功し、ほぼ確実に消えていた
  const [hunkError, setHunkError] = useState<Error | null>(null)
  // 直近のユーザー操作の結果であるハンク操作エラーを優先して見せる
  const diffError = hunkError ?? fetchError
  // ハンク操作の対象タブ(実行中のみ非 null)。フック自体は1操作しか同時に走らせない
  // (git apply --cached の並行実行によるインデックス競合を避けるため)が、
  // 「どのタブのボタンを disabled にするか」は対象タブと activeDiffTab が一致する
  // 場合のみに絞る。絞らないと、A で実行中のハンク操作が無関係な B のタブへ切り替えた
  // 後もそのボタンを disabled にし続けてしまう
  const [inProgressTab, setInProgressTab] = useState<DiffTabKey | null>(null)
  // 即座に判定できるガード用。state 更新は非同期のため、連打を防ぐには ref が必要
  const isHunkOperationInProgressRef = useRef(false)
  // runHunkOperation が diffRefreshSignal をトリガーしてから、それによって発火する
  // 下の effect が実際に diffContent を更新し終えるまでの間、対象タブを保持する。
  // isHunkOperationInProgress の計算に含めることで、まだ古い diffContent が
  // 表示されたままハンクボタンが再有効化されるのを防ぐ(その古い行番号/コンテキストで
  // 2つ目のハンク操作を送ると git apply --cached が失敗・誤適用するおそれがある)。
  // 単純なブール値ではなく対象タブ(DiffTabKey)を保持するのは、A の操作完了直後
  // (このフラグが立った直後)に無関係な B のタブへ切り替えた場合、B の
  // isHunkOperationInProgress まで一時的に true になってしまうのを防ぐため
  // (inProgressTab と同じ理由でタブスコープにしている)。
  // runHunkOperation 内で Promise を使って effect の完了を直接 await する設計は、
  // act() でラップされたテスト環境でデッドロックした(setState 後の再レンダーと
  // useEffect の実行が、await で中断された関数の続きを待つ act() 自身に
  // ブロックされてしまう)ため、素直な state フラグに変更している
  const [staleTab, setStaleTab] = useState<DiffTabKey | null>(null)
  // useGitOperations のファイル全体 stage/unstage が同じファイルに対して実行中の間、
  // このフック自身は「実行中」を認識していない(inProgressTab は null のまま)ため、
  // lock.isLocked も合わせて見ないと、diff タブのハンクボタンが有効に見えてしまい、
  // クリックすると runHunkOperation 冒頭の lock.isLocked ガードで黙って無視される
  // inProgressTab は「タブが一致するか」を見ずに非 null かどうかだけで判定する。
  // runHunkOperation の実際のガードはフック全体で 1 個の
  // isHunkOperationInProgressRef であり、A で実行中は B のクリックも冒頭の
  // ガードで捨てられる。タブが一致する場合だけ disabled にすると、B では
  // ボタンが有効に見えるのに押しても何も起きない(エラーも出ない)状態になる。
  // 一方 staleTab(操作後の再取得待ち)はタブごとに独立しているため、
  // 引き続きタブ一致で判定する
  const isHunkOperationInProgress =
    activeDiffTab !== null &&
    (inProgressTab !== null ||
      lock.isLocked(activeDiffTab.path) ||
      // runHunkOperation 側は無関係な別ファイルの stage/unstage 実行中も
      // lock.isAnyLocked() で弾くようになった。表示側もこれに揃えないと、
      // ボタンが有効に見えるのに押すと無言で弾かれる状態になる
      lock.isAnyLocked() ||
      (staleTab !== null && isSameKey(staleTab, activeDiffTab)))
  // ハンクのステージ/アンステージ後に同じ activeDiffTab のまま diff を再取得させるための
  // 明示的なトリガー。activeDiffTab 自体は変わらないため、依存配列に activeDiffTab だけを
  // 置いた effect では変化を検知できない
  const [diffRefreshSignal, setDiffRefreshSignal] = useState(0)
  // ChangesSection/StagedSection からのファイル全体 stage/unstage(useGitOperations
  // 経由)は refreshGitStatus は呼ぶが、diffRefreshSignal(ハンク操作専用のトリガー)は
  // 更新しない。それを無視すると、開いている diff タブの内容が古いまま残り、その後
  // ハンクのステージを押すと既にステージ済みのファイルへ古いパッチを送ってしまう。
  // 対象ファイルの index/workingDir を effect の依存に含めることで、操作の種類を
  // 問わず git status の変化を検知して diff を再取得する
  // useDiffOperations は useAppState 経由でエディタの1キー入力ごとに
  // 再レンダーされる(useFileEditing.ts の isDirty/content state 変化のため)。
  // gitStatusFiles・activeDiffTab のどちらも変わっていないのに毎レンダー
  // O(n) の再スキャンが走らないよう memo 化する
  const activeFileStatus = useMemo(
    () =>
      activeDiffTab === null
        ? undefined
        : gitStatusFiles.find((f) => isSamePath(f.path, activeDiffTab.path)),
    [gitStatusFiles, activeDiffTab]
  )
  const activeFileStatusKey =
    activeFileStatus === undefined
      ? undefined
      : `${activeFileStatus.index}${activeFileStatus.workingDir}`

  // ハンク操作エラーは取得 effect のクリア対象から外している(同じ tick で
  // 消えてしまうため)ので、タブが変わったときだけここで明示的に落とす。
  // diffRefreshSignal や activeFileStatusKey では発火させない(ハンク操作の
  // 直後は必ず再取得が走るため、それらに反応させると結局同じ問題に戻る)
  useEffect(() => {
    const clearHunkError = (): void => {
      setHunkError(null)
    }
    clearHunkError()
  }, [activeDiffTab])

  useEffect(() => {
    if (activeDiffTab === null) {
      // activeDiffTab が null になった(タブが閉じられた等)場合、そのタブに
      // 対して立てていた staleTab をクリアする。この分岐に入ると下のフローの
      // finally 節(取得完了時に staleTab をクリアする箇所)を通らないため、
      // クリアしないと、後で同じ path/staged の新しいタブオブジェクト
      // (decodeDiffTabPath 等が生成する別参照)を開いた際、isSameKey が
      // 構造的に一致してしまい、実際には実行中でない操作の「実行中」表示
      // (ハンクボタン disabled)が残ってしまう
      const clearStaleTabForClosedDiffTab = (): void => {
        setStaleTab(null)
      }
      clearStaleTabForClosedDiffTab()
      return
    }
    // タブ切替中に古い fetch が後から解決しても、現在のタブの表示を上書きしないよう
    // cancelled フラグで無効化する
    let cancelled = false
    void (async (): Promise<void> => {
      // 前のタブの内容を残したままにすると、取得中の空白期間にユーザーが「この
      // ハンクをステージ」を押した場合、古い diffContent から組み立てた patch が
      // 新しい activeDiffTab 宛てに送られ、誤ったファイルを操作してしまう。
      // 即座にクリアする
      setDiffContent(null)
      setFetchError(null)
      try {
        // 未追跡かどうかは、main プロセス側で改めて git status を取り直さず、
        // renderer が既に持っている gitStatusFiles(activeFileStatus)から渡す。
        // diff タブを開くたびにリポジトリ全体を再スキャンする無駄を避けるため
        const isUntracked = activeFileStatus !== undefined && isUntrackedFile(activeFileStatus)
        // 取得元の選択(agent は記録との比較、ほかは git の index・HEAD との比較。
        // ステージ済みリネームは旧パスも渡す)は lib/diffTabSource.ts にある
        const content = await fetchDiffForTab(activeDiffTab, {
          isUntracked,
          renamedFrom: activeFileStatus?.from
        })
        if (cancelled) return
        setDiffContent(content)
        setFetchError(null)
      } catch (err) {
        if (cancelled) return
        setFetchError(toError(err))
      } finally {
        // このタブが表示している内容は最新化された(取得が成功・失敗いずれでも
        // diffContent/diffError は現在の状態を反映している)。runHunkOperation が
        // このタブに対して立てた staleTab をここで下ろす。functional update で
        // 「今の staleTab がこのタブを指している場合のみ」クリアするのは、
        // A の操作完了後(staleTab=A)に B へ切り替わった場合、B に対するこの
        // effect の完了で無関係な A の staleTab を誤って消してしまわないため。
        // cancelled(タブ切替等でこの effect 自体が破棄された)場合は、次に
        // マウントされる effect 側で改めて最新化されるため、ここで下ろす必要はない
        if (!cancelled) {
          setStaleTab((current) =>
            current !== null && isSameKey(current, activeDiffTab) ? null : current
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // activeFileStatus?.index は activeFileStatusKey(index+workingDir の結合値)に
    // 含まれており、index が変われば必ず activeFileStatusKey も変わるため、
    // 依存配列に activeFileStatus?.index を別途加える必要は無い。ただし
    // activeFileStatus?.from(リネーム元)は index='R' のままでも変わりうる
    // (外部の git 操作で A→B のリネームが C→B のリネームに置き換わる等)ため、
    // activeFileStatusKey とは別に依存として追う必要がある。追わないと、effect が
    // 再実行されずクロージャに古い from が残ったまま、アンステージ操作が
    // 誤った旧パスに対して行われてしまう
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDiffTab, diffRefreshSignal, activeFileStatusKey, activeFileStatus?.from])

  const runHunkOperation = async (
    operation: (path: string, patch: string) => Promise<void>,
    patch: string
  ): Promise<boolean> => {
    if (
      activeDiffTab === null ||
      isHunkOperationInProgressRef.current ||
      lock.isLocked(activeDiffTab.path) ||
      // useGitOperations.ts のファイル全体 stage/unstage(git add/reset)は、
      // 対象パスに関わらず lock.isAnyLocked()/stagingPathsRef.size > 0 を見て
      // 他ファイルへの stage 中でも新規の stage/unstage をブロックしている
      // (同じ .git/index を書き換えるため)。ここも同じロックを共有する以上
      // 対称に扱う必要があり、lock.isLocked(activeDiffTab.path)(対象パス単独)
      // だけでは、無関係な別ファイルの stage 実行中に git apply --cached を
      // 同時に走らせてしまう
      lock.isAnyLocked()
    ) {
      return false
    }
    const targetTab = activeDiffTab
    isHunkOperationInProgressRef.current = true
    setInProgressTab(targetTab)
    lock.lock(targetTab.path)
    try {
      await operation(targetTab.path, patch)
      setHunkError(null)
      // diffRefreshSignal は refreshGitStatus の完了を待ってから発火させる。
      // refreshGitStatus 未解決の間は gitStatusFiles(renderer 側のキャッシュ)が
      // まだ古いままのため、先に発火させると effect が古い isUntracked で
      // getDiff を呼んでしまう(「untracked diff が誤表示される」のと同じ
      // 原因のバグを再発させるレース)。
      // ただし refreshGitStatus の失敗を下の catch へ流してはいけない。
      // git apply --cached 自体は既に成功しているのに「失敗」として赤いエラーを
      // 出し diffContent もクリアすると、実際にはステージ済みなのにユーザーには
      // 失敗に見え、再実行を誘発してしまう。git status の取得エラーは
      // useGitStatus 側が自前の gitError として扱うため、ここでは握りつぶす
      try {
        await refreshGitStatus()
      } catch {
        // 意図的に無視(上記コメント参照)
      }
      // targetTab を staleTab として立てておくことで、diffRefreshSignal によって
      // 発火する上の effect が実際に diffContent を更新し終えるまで、この
      // targetTab に対する isHunkOperationInProgress を true に保つ。ここで
      // 直接 Promise を使って effect の完了を await する設計は、act() でラップ
      // されたテスト環境でデッドロックした(setState 後の再レンダーと
      // useEffect の実行が、await で中断された関数の続きを待つ act() 自身に
      // ブロックされる)ため、effect 側が完了時に自分で staleTab を下ろす
      // 一方向の同期にしている。
      // targetTab が既に現在の activeDiffTab でなくなっていたら(操作中に別タブへ
      // 切り替えられていたら)bump しない。catch 節と同じガードで、切り替え先の
      // 無関係なタブの diff を無駄に再取得するのを防ぐ(取得 effect は
      // activeDiffTab 自体の変化で既に切り替え先の diff を取得済みのため、
      // targetTab を再度開いたときは通常の取得 effect が最新の diff を取り直す)
      if (activeDiffTabRef.current !== null && isSameKey(activeDiffTabRef.current, targetTab)) {
        setStaleTab(targetTab)
        setDiffRefreshSignal((n) => n + 1)
      }
      return true
    } catch (err) {
      // タブ切り替え自体は操作の実行中でもブロックされないため、targetTab の
      // IPC 呼び出しが実行中の間に別タブへ切り替えることができる。ここで
      // targetTab が現在のアクティブタブかどうかを確認せず無条件に反映すると、
      // 既に切り替え先の無関係なタブに表示されている diffContent/diffError を
      // targetTab の失敗結果で上書きしてしまう。targetTab を再度開いたときは
      // 通常の取得 effect が最新の diff を取り直すため、ここで何もしなくても
      // 正しい状態になる
      if (activeDiffTabRef.current !== null && isSameKey(activeDiffTabRef.current, targetTab)) {
        setHunkError(toError(err))
        // 古い diffContent(ステージ済みボタン付きのハンク表示)を残さない。残したままだと、
        // 既に実体と食い違っている可能性のある古いハンクに対してユーザーが誤って
        // 再操作を試みてしまう
        setDiffContent(null)
        // ここで diffRefreshSignal を bump しないと、activeDiffTab/diffRefreshSignal/
        // activeFileStatusKey のいずれも変化しないため再取得の effect が発火せず、
        // タブを閉じて開き直すまで永久に空白の diff タブが残ってしまう
        setDiffRefreshSignal((n) => n + 1)
      }
      setStaleTab(targetTab)
      return false
    } finally {
      isHunkOperationInProgressRef.current = false
      setInProgressTab(null)
      lock.unlock(targetTab.path)
    }
  }

  // 未追跡ファイルの diff は main 側が組み立てた疑似diffで、その内容はワーキング
  // ツリーの生バイト列。これを git apply --cached に渡すと git の clean フィルタ
  // (core.autocrlf / .gitattributes の text=auto / git-lfs 等)を通らないため、
  // 同じファイルを「+」ボタン(git add)でステージした場合と index の中身が
  // 食い違ってしまう(実測: autocrlf=true のとき git add は LF へ正規化するが、
  // git apply --cached は CRLF のまま記録する)。疑似diffは常に「全行追加」の
  // 1 ハンクなので、git add に置き換えてもステージされる範囲は変わらない
  // エージェントの変更の diff(kind: 'agent')は記録の時点との比較で、git status の未追跡と無関係
  // (未追跡として扱うと、DiffView が打ち切ったハンクも戻すパッチに含めてしまう)。
  // activeFileStatus は agent のタブでも diff を取り直す契機に使うため、ここで打ち消す
  const isActiveFileUntracked =
    activeDiffTab?.kind !== 'agent' &&
    activeFileStatus !== undefined &&
    isUntrackedFile(activeFileStatus)

  // stageHunk / unstageHunk の公開型は従来どおり Promise<void>(runHunkOperation の戻り値は捨てる)
  const stageHunk = async (patch: string): Promise<void> => {
    await runHunkOperation(
      isActiveFileUntracked ? (path) => gitApi.stageFile(path) : gitApi.stageHunk,
      patch
    )
  }
  const unstageHunk = async (patch: string): Promise<void> => {
    await runHunkOperation(gitApi.unstageHunk, patch)
  }

  // 未ステージの diff で、追跡済みの変更ファイルだけが対象。未追跡・intent-to-add はゴミ箱へ
  // 移す対象でハンクでは取り消せず、コンフリクト中は取り消せない(main 側でも弾く)。
  // エージェントの変更の diff(kind: 'agent')は対象外(実行前に戻す操作は DiffView の agentActions が出す)
  const canDiscardHunk =
    activeDiffTab !== null &&
    activeDiffTab.kind === 'unstaged' &&
    activeFileStatus !== undefined &&
    canDiscardHunkFor(activeFileStatus)
  const discardHunk = (patch: string): Promise<boolean> =>
    runHunkOperation(gitApi.discardHunk, patch)

  // ハンク操作後の再取得と同じトリガーを使う。diff タブが開いていない場合は
  // 上の effect が activeDiffTab === null で即 return するため、呼んでも無害
  const refreshDiff = (): void => {
    setDiffRefreshSignal((n) => n + 1)
  }

  return {
    diffContent,
    diffStaged,
    diffError,
    isHunkOperationInProgress,
    stageHunk,
    unstageHunk,
    discardHunk,
    canDiscardHunk,
    refreshDiff,
    isActiveFileUntracked
  }
}
