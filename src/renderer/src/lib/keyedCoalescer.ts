// キーごとの非同期の実行の合流。同じキーを実行している最中に届いた依頼は、終わった後の 1 回にまとめる。React に依らない

export interface KeyedCoalescerOptions<T> {
  /** 比較用のキー(同じキーの依頼をまとめる) */
  toKey: (item: T) => string
  /** 実行する処理。まとめた後の実行も、最初に届いた item で呼ぶ */
  run: (item: T) => Promise<void>
  /** run が reject したときの扱い(記録するかどうかの方針は呼び出し側が決める)。reject したらキーを解放し、まとめた次の実行はしない */
  onError: (error: unknown) => void
  /** 破棄された後は、まとめた次の実行をしない */
  isDisposed: () => boolean
}

export interface KeyedCoalescer<T> {
  schedule: (item: T) => void
}

export function createKeyedCoalescer<T>({
  toKey,
  run,
  onError,
  isDisposed
}: KeyedCoalescerOptions<T>): KeyedCoalescer<T> {
  // 実行中のキー → 実行している間に依頼がまた届いたか
  const running = new Map<string, boolean>()
  return {
    schedule: (item) => {
      const key = toKey(item)
      if (running.has(key)) {
        running.set(key, true)
        return
      }
      running.set(key, false)
      void (async () => {
        try {
          do {
            running.set(key, false)
            await run(item)
          } while (running.get(key) === true && !isDisposed())
        } catch (error) {
          // 実行できなかったときは呼び出し側へ知らせる(次の依頼で実行し直す)
          onError(error)
        } finally {
          running.delete(key)
        }
      })()
    }
  }
}
