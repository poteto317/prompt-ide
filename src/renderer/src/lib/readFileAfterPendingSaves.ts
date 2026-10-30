// ファイルを開くときの読み込み(useFileSystem の selectFile)から、保存との競合の制御だけを切り出したもの。
// React の状態には触れず、依存はすべて引数で受け取る

/** 読み込み中に保存が完了したときに読み直す回数の上限 */
export const MAX_READ_RETRIES = 5

export interface ReadFileAfterPendingSavesDeps {
  /** その path の進行中の保存(無ければ null) */
  pendingSaveFor: (path: string) => Promise<void> | null
  /** その path の保存が完了した回数 */
  saveCompletionsFor: (path: string) => number
  /** ディスクから読む(失敗は投げる。そのまま呼び出し側へ伝える) */
  readFileContent: (path: string) => Promise<string>
  /** 読み込みの結果がもう要らないか(別のファイルへ切り替わった等)。読むたびに確かめる */
  isStale: () => boolean
}

export type ReadFileAfterPendingSavesResult =
  | { kind: 'read'; content: string }
  /** 途中で isStale が真になった(結果は捨てる) */
  | { kind: 'stale' }
  /** 上限まで保存との競合が続いた(古いと分かっている内容は返さない) */
  | { kind: 'conflict' }

/**
 * 同じ path の保存が進行中なら、その完了を待ってから読む。待たないと write 完了前の旧内容を読み取り、
 * ディスクとエディタが食い違う。読み込み中に始まって完了した保存も取りこぼさない: 完了した保存は pendingSaveFor から
 * 消えるため、完了回数を読み込みの前後で比べ、変化していれば(または解決時点でまだ進行中の保存が残っていれば)読み直す。
 * 保存は利用者の操作なので通常は 1 回で収束するが、連打された場合に回り続けないよう読み直しは maxRetries 回までにする
 * (最初の 1 回を含めて maxRetries + 1 回読む)
 */
export async function readFileAfterPendingSaves(
  path: string,
  deps: ReadFileAfterPendingSavesDeps,
  maxRetries: number = MAX_READ_RETRIES
): Promise<ReadFileAfterPendingSavesResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (
      let pendingSave = deps.pendingSaveFor(path);
      pendingSave !== null;
      pendingSave = deps.pendingSaveFor(path)
    ) {
      await pendingSave
    }
    const completionsBeforeRead = deps.saveCompletionsFor(path)
    const content = await deps.readFileContent(path)
    if (deps.isStale()) return { kind: 'stale' }
    if (
      deps.saveCompletionsFor(path) === completionsBeforeRead &&
      deps.pendingSaveFor(path) === null
    ) {
      return { kind: 'read', content }
    }
  }
  return { kind: 'conflict' }
}
