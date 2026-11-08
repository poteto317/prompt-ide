// 取り直しの合流(React に依らない。設計書 2026-11-08「合流」)。待ち(最後の依頼から)と上限(最初の未処理の依頼から)の早い方で
// 1 回にまとめて走らせる(L-399)。実行中に届いた依頼は「もう 1 回」の印を立てて、終わった後に 1 回だけ、たまった依頼で走らせる。
// reset は世代を進め、予約・未処理・実行中・印を下ろす(使う側の対象の切り替え・アンマウントなど。古い完了がやり直しを起こさない。L-108)
// main の監視の通知の合流(src/main/folderChangeCoalescer.ts の FolderChangeCoalescer)と、待ちと上限の 2 本のタイマーの張り方が同じ
// (片方のタイマーの扱いを直すときはもう片方も確かめる)。こちらは走らせるのが非同期なので、実行中のもう 1 回・世代を持つ

export interface RefreshSchedulerOptions<T> {
  waitMs: number
  maxWaitMs: number
  /** 未処理の依頼どうしを 1 つにまとめる */
  merge: (a: T, b: T) => T
  run: (request: T) => Promise<void>
  /** 受け付けるか。予約の時と走らせる時の両方で呼ぶ(false なら捨てる) */
  accepts: () => boolean
}

export interface RefreshScheduler<T> {
  /** 待ちを張り直し、上限は最初の未処理の依頼で張る */
  schedule: (request: T) => void
  /** 予約と未処理を捨て、実行中の完了を古いものにする(使う側の対象の切り替え・アンマウントなど) */
  reset: () => void
}

export function createRefreshScheduler<T>({
  waitMs,
  maxWaitMs,
  merge,
  run,
  accepts
}: RefreshSchedulerOptions<T>): RefreshScheduler<T> {
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  // 未処理の依頼(T が偽になりうる値でも「無い」と区別するため包む)
  let pending: { request: T } | null = null
  let running = false
  let rerun = false
  let generation = 0

  const cancelTimers = (): void => {
    if (waitTimer !== null) clearTimeout(waitTimer)
    if (maxTimer !== null) clearTimeout(maxTimer)
    waitTimer = null
    maxTimer = null
  }

  // 同期で投げても reject として扱う(タイマーのコールバックから投げない)
  const runSafely = (request: T): Promise<void> => {
    try {
      return run(request)
    } catch (err) {
      return Promise.reject(err)
    }
  }

  // 待ちと上限のどちらで呼ばれても両方を取り消す
  const fire = (): void => {
    cancelTimers()
    if (pending === null) return
    if (!accepts()) {
      pending = null
      return
    }
    if (running) {
      rerun = true
      return
    }
    const { request } = pending
    pending = null
    running = true
    const startedGeneration = generation
    void runSafely(request)
      .catch(() => undefined)
      .finally(() => {
        if (generation !== startedGeneration) return
        running = false
        if (!rerun) return
        rerun = false
        fire()
      })
  }

  return {
    schedule: (request) => {
      if (!accepts()) return
      pending = pending === null ? { request } : { request: merge(pending.request, request) }
      if (waitTimer !== null) clearTimeout(waitTimer)
      waitTimer = setTimeout(fire, waitMs)
      if (maxTimer === null) maxTimer = setTimeout(fire, maxWaitMs)
    },
    reset: () => {
      generation += 1
      cancelTimers()
      pending = null
      running = false
      rerun = false
    }
  }
}
