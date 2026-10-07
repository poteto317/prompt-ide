import type { DiscardAllResult } from '@shared/types'

// 一括の操作(「変更」セクションの「すべて取り消す」と、エージェントの変更の「すべて戻す」)に共通の手順。
// どちらもデータを失いうるため、確認のときに見せた一覧との完全一致の照合(パターン 62)と、
// 途中で失敗したときの partial の扱い(パターン 52)を 1 か所に置き、片方だけがずれないようにする。
// 対象の取得・1 件ごとの判定・文言は呼び出し側が持つ

const MAX_LISTED_PATHS = 5

// 照合キー。パスは NUL を含められない(-z の区切り)ため、NUL で区切れば衝突しない
const toMatchKey = (entry: { status: string; path: string }): string =>
  `${entry.status}\0${entry.path}`

/** 拒否したファイルの列挙(最大 5 件。超えた分は「ほか n 件」) */
export function listPathsForMessage(paths: string[]): string {
  const shown = paths.slice(0, MAX_LISTED_PATHS).join('、')
  const rest = paths.length - MAX_LISTED_PATHS
  return rest > 0 ? `${shown}、ほか ${rest} 件` : shown
}

/**
 * status と path の組の多重集合が一致しなければ mismatchMessage で例外を投げる。順序は問わず、重複の数は区別する。
 * 件数だけを比べると、確認の後に中身が入れ替わっても通り、確認していないファイルを変えてしまう。status も含めるのは、
 * 同じパスで ?? → AM のように「ゴミ箱へ移す」から「restore で消す」へ変わるのを止めるため
 */
export function assertSameEntries(
  actual: { status: string; path: string }[],
  expected: { status: string; path: string }[],
  mismatchMessage: string
): void {
  const actualKeys = actual.map(toMatchKey).sort()
  const expectedKeys = expected.map(toMatchKey).sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, i) => key !== expectedKeys[i])
  ) {
    throw new Error(mismatchMessage)
  }
}

/**
 * targets を順に apply する。実行中の失敗は元に戻せないため、そこで中断し、済んだ件数を formatFailure で文言に含める。
 * 1 件以上済んでいれば作業ツリーが変わっているので、例外ではなく partial で返す(renderer がタブ・ツリーを
 * 再読込できるように)。1 件目で失敗したなら何も変わっていないので、元のエラーを cause に持つ例外にする
 */
export async function applyInOrder<T>(
  targets: T[],
  apply: (target: T) => Promise<void>,
  formatFailure: (done: number, total: number, reason: string) => string
): Promise<DiscardAllResult> {
  let done = 0
  for (const target of targets) {
    try {
      await apply(target)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const message = formatFailure(done, targets.length, reason)
      if (done > 0) return { status: 'partial', message }
      throw new Error(message, { cause: error })
    }
    done++
  }
  return { status: 'done' }
}
