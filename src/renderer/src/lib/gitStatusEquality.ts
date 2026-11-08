import type { GitStatusResult } from '@shared/types'
import { isSamePlainData } from './plainDataEquality'

// 静かな取り直しで、内容が同じ git status を置き換えない(エージェントの変更の一覧・diff の連鎖を起こさない)ための比べ
// (設計書 2026-11-08)。status は IPC で届いた素のデータなので、全部の欄を構造で比べる(isSamePlainData。欄を足しても比べ忘れない)。
// files は並びの順のまま比べ、from は無いとき(undefined)どうしで同じ(main は値があるときだけ from を入れる)

/** どちらかが null なら、両方 null のときだけ同じ */
export function isSameGitStatus(a: GitStatusResult | null, b: GitStatusResult | null): boolean {
  return isSamePlainData(a, b)
}
