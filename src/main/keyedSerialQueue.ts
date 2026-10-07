/**
 * キーごとに非同期タスクを直列化する列(WriteQueue のキーつき版)。
 * - 同じキーのタスクは積んだ順に 1 つずつ行う。別のキーのタスクは互いを待たない
 * - 先行タスクが失敗しても後続タスクは進む(失敗はそのタスクの呼び出し元にだけ返す)
 * - 列が空になったキーは消す(所有者が入れ替わり続けても Map が伸びない)
 */
export class KeyedSerialQueue {
  private readonly tails = new Map<number, Promise<unknown>>()

  enqueue<T>(key: number, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const run = previous.then(task)
    const tail = run.catch(() => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      // 後ろに別のタスクが積まれていれば、そのタスクの終わりで消す
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return run
  }

  /** キーの列に、待っているか実行中のタスクがあるか */
  has(key: number): boolean {
    return this.tails.has(key)
  }
}
