// 全ウィンドウで共有するエージェント CLI の会話の ID の予約(設計書「同じ ID の二重の起動」。種類をまたいで 1 つ)。同じ会話を 2 つの CLI が同時に書くと
// 会話のファイルが壊れうるため、starter が spawn の直前に同期で予約し、予約済みの ID の再開を session-in-use で拒む。
// main に 1 つ作って starter に注入する。Electron に依存しない

export interface CliSessionReservations {
  /** 予約できたら解除の関数(2 回目以降は何もしない)、すでに予約されていれば null。判定と予約は同期で 1 度に行う */
  tryReserve(cliSessionId: string): (() => void) | null
  /** 予約されているか */
  has(cliSessionId: string): boolean
}

export function createCliSessionReservations(): CliSessionReservations {
  const reserved = new Set<string>()
  return {
    tryReserve(cliSessionId) {
      if (reserved.has(cliSessionId)) return null
      reserved.add(cliSessionId)
      let released = false
      return () => {
        // 2 回目の呼び出しで、外した後に別の起動が取り直した同じ ID の予約を外さない
        if (released) return
        released = true
        reserved.delete(cliSessionId)
      }
    },
    has: (cliSessionId) => reserved.has(cliSessionId)
  }
}
