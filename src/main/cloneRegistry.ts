export const CLONE_ALREADY_RUNNING_MESSAGE = '既に clone を実行中です'

// Electron に依存しない純粋なレジストリ。app のイベントの購読(中止の契機)は cloneLifecycle.ts が持つ。
// ウィンドウ(webContents の id)ごとの、実行中の clone の中止の口。1 つのウィンドウで同時に 1 つだけ。
// 保存先の選択(OS のダイアログ)の間も実行中として扱う(その間の中止は、選択の後に clone へ進まない)
export class CloneRegistry {
  private readonly running = new Map<number, AbortController>()

  /** 実行中にする。既に実行中なら、既存の clone に触れずに拒否する */
  begin(ownerId: number): AbortController {
    if (this.running.has(ownerId)) throw new Error(CLONE_ALREADY_RUNNING_MESSAGE)
    const controller = new AbortController()
    this.running.set(ownerId, controller)
    return controller
  }

  /** 実行中を解く。begin が返した controller と一致するときだけ(別の実行の登録を消さない) */
  end(ownerId: number, controller: AbortController): void {
    if (this.running.get(ownerId) === controller) this.running.delete(ownerId)
  }

  /** 実行中の clone を中止する。実行中でなければ何もしない(冪等) */
  cancel(ownerId: number): void {
    this.running.get(ownerId)?.abort()
  }

  isRunning(ownerId: number): boolean {
    return this.running.has(ownerId)
  }
}
