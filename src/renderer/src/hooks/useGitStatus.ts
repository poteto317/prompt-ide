import { useState, useEffect, useCallback, useRef } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { toError } from '../lib/errorUtils'
import { decideQuietGitStatus } from '../lib/quietGitStatusDecision'
import type { QuietFetchOutcome, QuietGitStatusDecision } from '../lib/quietGitStatusDecision'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'

export interface GitStatusOptions {
  /** フォルダの走査中か(useFileSystem.isFolderScanPending)。走査中に完了した静かな取得は反映しない */
  isFolderScanPending: () => boolean
}

interface GitStatusState {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  refreshGitStatus: () => Promise<void>
  /**
   * 静かに取り直す(監視の通知・フォーカスの復帰。設計書 2026-11-08)。gitLoading を立てず、gitError を消さず、内容が同じなら置き換えない(通常の取得を引き継いだ成功は、同じでも通常の取得として置く)。
   * 受け入れた(完了の時点で最新で、走査中でなく、成功した。同じで置き換えなかった場合も含む)なら true。投げない
   */
  refreshGitStatusQuietly: () => Promise<boolean>
  /** 今の gitStatus を静かな取得が置いたか(エージェントの変更の一覧を静かに取り直すかの判断に使う) */
  wasGitStatusSetQuietly: () => boolean
}

interface GitStatusSetters {
  setGitStatus: (status: GitStatusResult | null) => void
  setGitLoading: (loading: boolean) => void
  setGitError: (error: Error | null) => void
}

// 描画をまたいで保つ控え(取得の番号は通常と静かで共有し、後から始まった取得が勝つ。L-040)
interface GitStatusTracking {
  latestRequestId: number
  /** 最後に setGitStatus へ渡した値(静かな取得は、await の前のクロージャではなく完了の時点のこの値と比べる) */
  latestStatus: GitStatusResult | null
  /** 今の gitStatus を静かな取得が置いたか */
  statusSetQuietly: boolean
  /** 通常の取得の途中か(gitLoading を下ろす役目が残っているか) */
  loudPending: boolean
}

function applyStatus(
  setters: GitStatusSetters,
  tracking: GitStatusTracking,
  status: GitStatusResult | null,
  quiet: boolean
): void {
  tracking.statusSetQuietly = quiet
  tracking.latestStatus = status
  setters.setGitStatus(status)
}

// 通常の取得の途中か(控えの loudPending)と、その表示(gitLoading)を一緒に書く(片方だけ変わらないよう、書くのはここだけ)
function setLoudPending(
  setters: GitStatusSetters,
  tracking: GitStatusTracking,
  pending: boolean
): void {
  tracking.loudPending = pending
  setters.setGitLoading(pending)
}

// status を取り直す。後から始まった取得があれば、古い取得の結果・失敗・読み込み中の解除は反映しない
// (latestRequestId で判定する)。useGitHistory の fetchGitHistoryData と同じく、setState を呼ぶ処理を
// フック本体の外に置く(react-hooks/set-state-in-effect に、effect 内から呼ぶ関数を正しく認識させる)
async function fetchGitStatus(
  folderPath: string | null,
  setters: GitStatusSetters,
  tracking: GitStatusTracking
): Promise<void> {
  const requestId = ++tracking.latestRequestId
  if (folderPath === null) {
    applyStatus(setters, tracking, null, false)
    setLoudPending(setters, tracking, false)
    setters.setGitError(null)
    return
  }
  setLoudPending(setters, tracking, true)
  setters.setGitError(null)
  try {
    const result = await gitApi.getGitStatus()
    if (requestId === tracking.latestRequestId) applyStatus(setters, tracking, result, false)
  } catch (err) {
    if (requestId === tracking.latestRequestId) setters.setGitError(toError(err))
  } finally {
    if (requestId === tracking.latestRequestId) setLoudPending(setters, tracking, false)
  }
}

async function settleGitStatus(): Promise<QuietFetchOutcome> {
  try {
    return { ok: true, result: await gitApi.getGitStatus() }
  } catch (error) {
    return { ok: false, error }
  }
}

// 判定(decideQuietGitStatus)の結果を反映する。受け入れたら true
function applyQuietDecision(
  decision: QuietGitStatusDecision,
  setters: GitStatusSetters,
  tracking: GitStatusTracking
): boolean {
  if (decision.accepted) {
    if (decision.replace) applyStatus(setters, tracking, decision.status, decision.quiet)
    // 取れたので、前の失敗の表示は古い
    setters.setGitError(null)
    return true
  }
  if (decision.error !== null) setters.setGitError(decision.error)
  return false
}

// 静かに取り直す。通常の取得の途中に始まったら、その役目(gitLoading を下ろす・失敗を出す・成功を通常の取得として置く)を引き継ぐ(inheritsLoud)
async function fetchGitStatusQuietly(
  folderPath: string | null,
  setters: GitStatusSetters,
  tracking: GitStatusTracking,
  isFolderScanPending: () => boolean
): Promise<boolean> {
  // フォルダの切り替えは今の effect が扱う
  if (folderPath === null) return false
  const requestId = ++tracking.latestRequestId
  const inheritsLoud = tracking.loudPending
  const outcome = await settleGitStatus()
  // 後から始まった取得が勝つ(gitLoading もその取得が下ろす)
  if (requestId !== tracking.latestRequestId) return false
  const decision = decideQuietGitStatus(outcome, {
    latestStatus: tracking.latestStatus,
    inheritsLoud,
    scanPending: isFolderScanPending()
  })
  const accepted = applyQuietDecision(decision, setters, tracking)
  if (inheritsLoud) setLoudPending(setters, tracking, false)
  return accepted
}

export function useGitStatus(
  folderPath: string | null,
  { isFolderScanPending }: GitStatusOptions
): GitStatusState {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<Error | null>(null)
  const trackingRef = useRef<GitStatusTracking>({
    latestRequestId: 0,
    latestStatus: null,
    statusSetQuietly: false,
    loudPending: false
  })
  const isFolderScanPendingRef = useLatestRef(isFolderScanPending)

  const refreshGitStatus = useCallback(
    (): Promise<void> =>
      fetchGitStatus(folderPath, { setGitStatus, setGitLoading, setGitError }, trackingRef.current),
    [folderPath]
  )

  const refreshGitStatusQuietly = useCallback(
    (): Promise<boolean> =>
      fetchGitStatusQuietly(
        folderPath,
        { setGitStatus, setGitLoading, setGitError },
        trackingRef.current,
        () => isFolderScanPendingRef.current()
      ),
    [folderPath, isFolderScanPendingRef]
  )

  const wasGitStatusSetQuietly = useCallback(
    (): boolean => trackingRef.current.statusSetQuietly,
    []
  )

  // フォルダが切り替わった時点で、前のフォルダの status を捨てる。
  // 残したままにすると、新しいフォルダの取得が終わるまでの間、ソース管理パネルに
  // 前のフォルダのブランチ名とファイル一覧が「操作可能な状態で」表示される。
  // その間に「+」を押すと、前のフォルダのファイルパスが新しい allowedFolder に
  // 対して解決され、切替先の同名ファイルをステージしてしまう。
  // refreshGitStatus 内でクリアしないのは、同一フォルダの再取得
  // (stage/unstage/保存のたびに走る)まで巻き込むと、SourceControlPanel が
  // GitRepoView をアンマウントし、入力中のコミットメッセージが失われるため
  useOnChange(folderPath, () => {
    applyStatus({ setGitStatus, setGitLoading, setGitError }, trackingRef.current, null, false)
  })

  // フォルダが変わるたび(初回を含む)に取り直す。refreshGitStatus と同じ取得を、effect からは直接呼ぶ
  useEffect(() => {
    void fetchGitStatus(
      folderPath,
      { setGitStatus, setGitLoading, setGitError },
      trackingRef.current
    )
  }, [folderPath])

  return {
    gitStatus,
    gitLoading,
    gitError,
    refreshGitStatus,
    refreshGitStatusQuietly,
    wasGitStatusSetQuietly
  }
}
