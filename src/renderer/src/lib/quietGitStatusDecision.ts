import type { GitStatusResult } from '@shared/types'
import { toError } from './errorUtils'
import { isSameGitStatus } from './gitStatusEquality'

// 静かな git status の取得(監視の通知・フォーカスの復帰。設計書 2026-11-08)の結果を、どう反映するかの判定(React・IPC に依らない)。
// 取得と setState は useGitStatus の fetchGitStatusQuietly が受け持ち、ここは決めるだけ

/** 静かな取得の結果(成功と失敗を 1 つの値にする) */
export type QuietFetchOutcome =
  | { ok: true; result: GitStatusResult }
  | { ok: false; error: unknown }

export type QuietGitStatusDecision =
  /**
   * 受け入れる。replace が false なら内容が同じなので置き換えない(前の失敗の表示は消す)。
   * quiet が false なら通常の取得として置く(通常の取得を引き継いだとき)
   */
  | { accepted: true; status: GitStatusResult; replace: boolean; quiet: boolean }
  /** 受け入れない。error が null でなければ表示する(通常の取得の役目を引き継いだ失敗だけ) */
  | { accepted: false; error: Error | null }

export interface QuietGitStatusContext {
  /** 最後に置いた status(await の前のクロージャではなく完了の時点の値) */
  latestStatus: GitStatusResult | null
  /** 通常の取得の途中に始まり、その役目(失敗を出す)を引き継いだか */
  inheritsLoud: boolean
  /** 完了の時点でフォルダの走査中か */
  scanPending: boolean
}

export function decideQuietGitStatus(
  outcome: QuietFetchOutcome,
  { latestStatus, inheritsLoud, scanPending }: QuietGitStatusContext
): QuietGitStatusDecision {
  // 取得の間に走査が始まったら、main の許可は新しいフォルダで画面は前のフォルダのまま。結果も失敗も出さない(L-037)
  if (scanPending) return { accepted: false, error: null }
  if (outcome.ok) {
    // 同じなら置き換えない(参照を保ち、エージェントの変更の一覧・diff の連鎖を起こさない)。
    // ただし通常の取得を引き継いだら、同じでも通常の取得として置く(追い越した通常の取得が新しい参照を置いて
    // エージェントの変更の一覧を取り直させる合図を失わないため)
    return {
      accepted: true,
      status: outcome.result,
      replace: inheritsLoud || !isSameGitStatus(latestStatus, outcome.result),
      quiet: !inheritsLoud
    }
  }
  // 静かな失敗は出さない(前の status と表示を残す。L-002)。通常の取得を引き継いだときだけ出す
  return { accepted: false, error: inheritsLoud ? toError(outcome.error) : null }
}
