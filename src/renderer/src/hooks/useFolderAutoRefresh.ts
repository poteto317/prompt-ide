import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import * as fileSystemApi from '../lib/fileSystemApi'
import { createRefreshScheduler } from '../lib/refreshScheduler'
import type { RefreshScheduler } from '../lib/refreshScheduler'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

// 開いているフォルダの自動の取り直し(設計書 2026-11-08「自動の取り直し」)。契機は main の監視の通知(fs:folderChange)と、
// ウィンドウの focus・visibilitychange(visible のときだけ。監視の取りこぼし・Linux の補い)。同じ瞬間に重なる契機を短い待ちで
// 1 回にまとめ(上限あり。L-399)、実行中の契機は終わった後の 1 回にまとめる。ツリー・git status・アクティブな diff タブを静かに取り直す
// (読み込み中の表示を出さず、内容が同じなら置き換えない)。走査中は git status と diff を取らない(ツリーは走査中かを
// refreshTreeQuietly の中の beginTreeWrite が見て、読まずに走査の後のやり直しへ回す。ここでは止めない)。読み上げない(L-249)。
// 開いているタブの中身(useExternalFileChanges)・記録中のエージェントの変更(useAgentChangesAutoRefresh)の購読は別に残す

/** 最後の契機からの待ち(同じ瞬間に重なる契機をまとめるだけの短い待ち) */
export const FOLDER_AUTO_REFRESH_WAIT_MS = 50
/** 最初の未処理の契機からの上限 */
export const FOLDER_AUTO_REFRESH_MAX_WAIT_MS = 300

export interface FolderAutoRefreshOptions {
  /** 開いているフォルダ(null の間は契機を捨てる。変わったら予約を捨てる) */
  folderPath: string | null
  /** useFileSystem.refreshTreeQuietly */
  refreshTreeQuietly: () => Promise<void>
  /** useGitStatus.refreshGitStatusQuietly(受け入れたら true) */
  refreshGitStatusQuietly: () => Promise<boolean>
  /** アクティブな diff タブを静かに取り直す(useDiffOperations.refreshDiff({ quiet: true })) */
  refreshDiffQuietly: () => void
  /** useFileSystem.isFolderScanPending */
  isFolderScanPending: () => boolean
}

interface FolderAutoRefreshRequest {
  /** ツリーも読み直すか(false なら git status と diff だけ) */
  tree: boolean
}

// git status を取り、受け入れられたときだけ diff を取る(取得の間に走査が始まって捨てたときは diff も取らない)。
// 走査中かは 2 段で見る(設計書 2 章「始めるときに走査中なら始めず、完了したときに走査中なら結果を捨てる」): ここは始める前で、
// 走査中なら取得を始めない(取得の番号を進めず、main の新しいフォルダの status を取りに行かない)。完了の時点の判定は
// decideQuietGitStatus の scanPending。どちらかを外すと、もう片方だけでは防げない時点が残る。
// agent の diff タブは、エージェントの変更の一覧の静かな取り直しの後に wiring も取り直す(重なっても静かで、同じ内容なら置き換えない)
async function refreshGitAndDiff(options: RefObject<FolderAutoRefreshOptions>): Promise<void> {
  if (options.current.isFolderScanPending()) return
  if (await options.current.refreshGitStatusQuietly()) options.current.refreshDiffQuietly()
}

// ツリーと git status は並べて走らせ、allSettled で待つ(どちらも静かで、失敗は中で捨てる。配列に直接渡す。L-701)
async function runFolderAutoRefresh(
  { tree }: FolderAutoRefreshRequest,
  options: RefObject<FolderAutoRefreshOptions>
): Promise<void> {
  await Promise.allSettled([
    tree ? options.current.refreshTreeQuietly() : Promise.resolve(),
    refreshGitAndDiff(options)
  ])
}

// 最初に使う effect の中で作る(描画の中で ref を読まない。useExternalFileChanges の coalescerRef と同じ)
function ensureScheduler(
  schedulerRef: RefObject<RefreshScheduler<FolderAutoRefreshRequest> | null>,
  options: RefObject<FolderAutoRefreshOptions>
): RefreshScheduler<FolderAutoRefreshRequest> {
  schedulerRef.current ??= createRefreshScheduler<FolderAutoRefreshRequest>({
    waitMs: FOLDER_AUTO_REFRESH_WAIT_MS,
    maxWaitMs: FOLDER_AUTO_REFRESH_MAX_WAIT_MS,
    merge: (a, b) => ({ tree: a.tree || b.tree }),
    run: (request) => runFolderAutoRefresh(request, options),
    accepts: () => options.current.folderPath !== null
  })
  return schedulerRef.current
}

export function useFolderAutoRefresh(options: FolderAutoRefreshOptions): void {
  const optionsRef = useLatestRef(options)
  const schedulerRef = useRef<RefreshScheduler<FolderAutoRefreshRequest> | null>(null)

  // 監視を張るかだけを main へ送る(どのフォルダかは main が決め、フォルダの切り替えで張り直す)。
  // 毎回登録して毎回外す(「初回だけ」の ref を使わない。StrictMode の true → false → true は到着の順に処理される。L-469)
  useEffect(() => {
    void fileSystemApi.setFolderWatch(true).catch(() => undefined)
    return () => {
      void fileSystemApi.setFolderWatch(false).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const scheduler = ensureScheduler(schedulerRef, optionsRef)
    const unsubscribe = fileSystemApi.onFolderChange(({ treeChanged }) =>
      scheduler.schedule({ tree: treeChanged })
    )
    const onFocus = (): void => scheduler.schedule({ tree: true })
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') scheduler.schedule({ tree: true })
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      scheduler.reset()
    }
  }, [optionsRef])

  // 前のフォルダの予約を新しいフォルダで走らせない(フォルダを開いた直後は、ツリーの走査と git status の取得が今の経路で走る)
  useOnChange(options.folderPath, () => schedulerRef.current?.reset())
}
