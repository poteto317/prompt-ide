/**
 * 非同期タスクを直列化するキュー。
 * - 先行タスクが完了するまで後続タスクは待機する
 * - 先行タスクが失敗しても後続タスクはブロックされない
 */
export class WriteQueue {
  private queue: Promise<void> = Promise.resolve()

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn)
    this.queue = p.then(
      () => {},
      () => {}
    )
    return p
  }
}
