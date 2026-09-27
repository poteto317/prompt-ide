import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitBranch, GitLogEntry } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import { useLatestRef } from './useLatestRef'

const PAGE_SIZE = 20

export interface GitHistoryState {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  /** フォルダ切替による初回取得中のみ true になる。同一フォルダ内の refresh
   *  (commit/amend 成功後の履歴再取得等)では true にならない。CommitSection の
   *  「別フォルダの直前コミットで誤って amend してしまう」防止用リセットの
   *  トリガーに使う値のため、isLoading(refresh 中も true になる)とは別に持つ */
  isLoadingFolder: boolean
  /** getLog が「コミット無し」以外の理由(git 未検出・リポジトリ破損等)で
   *  失敗した場合のエラー。git 管理外フォルダ(getBranches/getTags の失敗)は含まない */
  historyError: Error | null
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

interface HistorySetters {
  setLog: (log: GitLogEntry[]) => void
  setBranches: (branches: GitBranch[]) => void
  setTags: (tags: string[]) => void
  setHasMore: (hasMore: boolean) => void
  setIsLoading: (isLoading: boolean) => void
  setHistoryError: (error: Error | null) => void
  /** 取得済みページ数。loadMore の skip を「ページ数 × PAGE_SIZE」で求めるために持つ。
   *  log.length を skip にすると、取得ページが全件重複だった場合(アプリ外で
   *  PAGE_SIZE 件以上コミットされたとき)に log.length が増えず、以降は同じページを
   *  取り直すだけで前進しなくなる */
  setLoadedPageCount: (count: number) => void
}

// マウント時の初回取得と refresh は「log/branches/tags を最初から取り直す」という
// 同一の処理のため共通化する。フック本体の外に置くことで、setState 呼び出しが
// useEffect 内で定義されたローカル関数由来であることを ESLint の
// react-hooks/set-state-in-effect に認識させる(useCallback でラップした関数を
// 直接 effect から呼ぶと、間接呼び出しでも警告される)。
// isCancelled は呼び出し元が破棄済みかどうかを問う関数で、マウント時の useEffect
// からはクリーンアップと連動した値を渡し、refresh からは常に false を渡す
async function fetchGitHistoryData(
  folderPath: string | null,
  setters: HistorySetters,
  isCancelled: () => boolean
): Promise<void> {
  if (folderPath === null) {
    setters.setLog([])
    setters.setBranches([])
    setters.setTags([])
    setters.setHasMore(false)
    setters.setIsLoading(false)
    setters.setHistoryError(null)
    setters.setLoadedPageCount(0)
    return
  }
  setters.setIsLoading(true)
  try {
    // getLog/getBranches/getTags は互いに依存しない独立した IPC 呼び出しのため、
    // 直列に待たず並行して開始する。git 管理外のフォルダでは getBranches/getTags
    // が throw するが、呼び出し元は isRepo を見て履歴セクションの描画有無を決めるため、
    // ここでは個別に握りつぶし空配列にフォールバックする(getLog の結果まで巻き込んで捨てない)
    const [logResult, branchesResult, tagsResult] = await Promise.all([
      gitApi.getLog(PAGE_SIZE, 0),
      gitApi.getBranches().catch(() => []),
      gitApi.getTags().catch(() => [])
    ])
    if (isCancelled()) return
    setters.setLog(logResult)
    setters.setBranches(branchesResult)
    setters.setTags(tagsResult)
    setters.setHasMore(logResult.length === PAGE_SIZE)
    setters.setHistoryError(null)
    // 先頭 1 ページを取り直したので、次の loadMore は skip=PAGE_SIZE から始める
    setters.setLoadedPageCount(1)
  } catch (err) {
    // ここに到達するのは getLog が「コミット無し」以外の理由(git 未検出・
    // リポジトリ破損等)で失敗した場合のみ。ここで握りつぶすと、getLog 側の
    // 「実際の問題をユーザーに伝える」という修正が無効化されてしまうため、
    // historyError に反映する
    if (isCancelled()) return
    setters.setHistoryError(toError(err))
    // log を前フォルダの値のまま残すと、isLoading が false に戻った時点で
    // CommitSection の amend チェックボックスが「isCommitting=false,
    // lastCommitMessage(log[0]由来)=前フォルダの非null値, isLoadingLog=false」
    // という条件を満たしてしまい、無関係な別リポジトリの直前コミットメッセージで
    // 誤って amend できてしまう
    setters.setLog([])
    setters.setBranches([])
    setters.setTags([])
    setters.setHasMore(false)
    setters.setLoadedPageCount(0)
  } finally {
    if (!isCancelled()) setters.setIsLoading(false)
  }
}

export function useGitHistory(folderPath: string | null): GitHistoryState {
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingFolder, setIsLoadingFolder] = useState(false)
  const [historyError, setHistoryError] = useState<Error | null>(null)
  // 取得済みページ数。loadMore の skip は log.length ではなくこれ × PAGE_SIZE で
  // 求める。log.length だと、取得ページが全件重複(アプリ外で PAGE_SIZE 件以上
  // コミットされた場合)のときに長さが増えず、以降は同じページを取り直すだけで
  // 「もっと見る」が前進しなくなる
  const [loadedPageCount, setLoadedPageCount] = useState(0)
  // loadMore は非同期処理の途中で folderPath が切り替わったかを判定する必要があるが、
  // loadMore 自体は毎レンダー再生成される通常の関数のため、await 後に読む時点では
  // folderPath の最新値を ref 経由で確認する
  const folderPathRef = useLatestRef(folderPath)
  // refresh(commit/amend 成功後の refreshHistory 経由等)が loadMore の取得中に
  // 割り込んで log を丸ごと置き換えた場合を検知するための ref。folderPathRef と
  // 同じ理由で、await 後に読む時点の最新値を参照する
  const logRef = useLatestRef(log)
  // isLoading(state)は loadMore と refresh(fetchGitHistoryData 経由)の両方が
  // 共有する表示用の値のため、これだけで loadMore の多重実行を防ごうとすると、
  // refresh が loadMore より先に完了して isLoading を false へ戻した瞬間、
  // まだ実行中の loadMore を素通りしてもう一度呼べてしまう。即座に判定できる
  // ref を使い、loadMore 自身の排他制御を isLoading(表示用)から切り離す
  const isLoadingMoreRef = useRef(false)
  // マウント時の初回取得(load)と refresh(commit/amend 成功後の refreshHistory 等)は
  // どちらも独立に fetchGitHistoryData を呼び、完了時に log/branches/tags を
  // 丸ごと置き換える。それぞれの isCancelled は「folderPath が変わったか」しか
  // 見ていないため、同一 folderPath のまま refresh が load より先に完了すると、
  // 後から解決した load(古いデータ)が refresh の結果を上書きしてしまう。
  // 呼び出しごとに増分する世代番号を持ち、「自分より新しい呼び出しが
  // 始まっていないか」を isCancelled に含めることで、後勝ちではなく
  // 常に最後に開始した呼び出しが勝つようにする
  const latestRequestIdRef = useRef(0)

  // setLog 等の setState 関数自体は参照安定なため、このオブジェクトは実質
  // 再生成されない。安定させることで下の useEffect/useCallback の依存配列に
  // そのまま含められる
  const setters = useMemo<HistorySetters>(
    () => ({
      setLog,
      setBranches,
      setTags,
      setHasMore,
      setIsLoading,
      setHistoryError,
      setLoadedPageCount
    }),
    [setLog, setBranches, setTags, setHasMore, setIsLoading, setHistoryError, setLoadedPageCount]
  )

  useEffect(() => {
    let cancelled = false
    const requestId = ++latestRequestIdRef.current
    const load = (): void => {
      setIsLoadingFolder(true)
      void fetchGitHistoryData(
        folderPath,
        setters,
        () => cancelled || latestRequestIdRef.current !== requestId
      ).finally(() => {
        if (!cancelled) setIsLoadingFolder(false)
      })
    }
    load()
    return () => {
      cancelled = true
    }
  }, [folderPath, setters])

  const refresh = useCallback(async (): Promise<void> => {
    const requestedFolderPath = folderPath
    const requestId = ++latestRequestIdRef.current
    // 取得中に folderPath が切り替わっていたら、古いフォルダの再取得結果で
    // 現在のフォルダの状態を上書きしないよう破棄する(loadMore と同じ理由)。
    // folderPath が変わっていなくても、この呼び出しより後にマウント時の
    // load またはさらに新しい refresh が始まっていたら、そちらを優先する
    await fetchGitHistoryData(
      folderPath,
      setters,
      () =>
        folderPathRef.current !== requestedFolderPath || latestRequestIdRef.current !== requestId
    )
  }, [folderPath, setters, folderPathRef])

  const loadMore = async (): Promise<void> => {
    // isLoading(表示用 state)だけで多重実行を防ぐと、refresh が loadMore より
    // 先に完了して isLoading を false へ戻した隙に、まだ実行中の loadMore を
    // もう一度呼べてしまう(同じオフセットへの getLog が多重発行される)。
    // isLoadingMoreRef で loadMore 自身の排他制御を独立させる
    if (folderPath === null || isLoadingMoreRef.current) return
    const requestedFolderPath = folderPath
    // isLoading による多重実行防止は loadMore 同士の重複しか防げない。
    // refresh(commit/amend 成功後の refreshHistory 経由等)は isLoading を見ずに
    // 割り込んで実行され、log を新しい先頭ページで丸ごと置き換える。その後で
    // この loadMore が「古いオフセットのページ」を単純連結すると、新しいコミットを
    // 挟んでログが重複・欠落するため、開始時点の log(参照)を覚えておき、
    // 連結時にまだ同じ参照のままか確認する
    const logAtStart = log
    isLoadingMoreRef.current = true
    setIsLoading(true)
    try {
      const nextPage = await gitApi.getLog(PAGE_SIZE, loadedPageCount * PAGE_SIZE)
      // 取得中に folderPath が切り替わっていたら、古いフォルダのページを
      // 現在のフォルダの log に連結してしまわないよう破棄する
      if (folderPathRef.current !== requestedFolderPath) return
      // refresh が割り込んで log を置き換えていたら、このページはもう無関係な
      // オフセットに基づくものなので、log だけでなく hasMore/historyError も
      // 一切反映しない。hasMore だけこのチェックを素通りさせると、refresh が
      // 確定させた「今の log に続きがあるか」を、無関係な古いページの件数で
      // 上書きしてしまう(「もっと見る」ボタンが誤って消える/残る)
      if (logRef.current !== logAtStart) return
      // オフセット方式のページングは、アプリ外(ターミナル等)でコミットが増えると
      // ずれる。20 件表示中に外部で 1 件コミットされると skip=20 は「既に表示済みの
      // 20 件目」を返し、同じコミットが二重表示されて HistorySection の
      // key={entry.hash} が重複する。アプリ内の refresh 割り込みは上の logRef で
      // 検知できるが、外部のコミットは検知できないため、ハッシュで取り除く
      const existingHashes = new Set(logAtStart.map((entry) => entry.hash))
      const appended = nextPage.filter((entry) => !existingHashes.has(entry.hash))
      setLog((prev) => (prev === logAtStart ? [...prev, ...appended] : prev))
      // 重複除去で 0 件になっても「1 ページ読み進めた」ことに変わりはないので、
      // 必ず進める。log.length を skip にしていた頃は、ここが進まないために
      // 次回も同じページを取り直し、「もっと見る」が永久に前進しなかった
      setLoadedPageCount((count) => count + 1)
      // hasMore は「次のページがまだあるか」の判定なので、重複除去後の件数ではなく
      // git が返したページの件数で見る(重複を除いた結果 0 件でも、その先に
      // 未取得のコミットが残っていることはある)
      setHasMore(nextPage.length === PAGE_SIZE)
      setHistoryError(null)
    } catch (err) {
      // getLog が「コミット無し」以外の理由で失敗した場合。fetchGitHistoryData の
      // catch と同じ理由で historyError に反映する
      if (folderPathRef.current === requestedFolderPath) {
        setHistoryError(toError(err))
      }
    } finally {
      isLoadingMoreRef.current = false
      // folderPath が切り替わっていたら、新しいフォルダ向けの fetch(マウント effect)が
      // 別途 isLoading を管理している。ここで無条件に false へ戻すと、その進行中の
      // fetch の isLoading 表示を誤って隠してしまう
      if (folderPathRef.current === requestedFolderPath) setIsLoading(false)
    }
  }

  return {
    log,
    branches,
    tags,
    hasMore,
    isLoading,
    isLoadingFolder,
    historyError,
    loadMore,
    refresh
  }
}
