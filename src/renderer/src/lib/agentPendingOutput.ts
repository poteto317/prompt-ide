// sessionId が決まるまでに届いたエージェントの出力を溜める(agentTerminalController の部品。React と xterm に依らない)。
// 起動の準備(begin)から sessionId が決まる(take)までの間だけ、セッションごとに届いた順で溜める。溜める量は全セッションの
// 合計で上限を持ち、上限を超えるチャンクが届いたセッションは、その後のチャンクも溜めない(小さいチャンクだけ溜め続けて
// 途中が欠けた出力にしない)

export interface PendingOutputBuffer {
  /** 溜め始める。前に溜めた出力・合計・上限を超えた印を捨てる */
  begin(): void
  /** 溜めている間だけ、セッションの出力を溜める */
  push(sessionId: string, data: string): void
  /** 溜めるのを終え、sessionId の出力を届いた順で返す(ほかは捨てる)。null ならすべて捨てる */
  take(sessionId: string | null): string[]
  isCollecting(): boolean
}

export function createPendingOutputBuffer(maxLength: number): PendingOutputBuffer {
  let collecting = false
  let chunks = new Map<string, string[]>()
  let length = 0
  // 上限を超えるチャンクが届いた(以降は溜めない)セッション
  let overflowed = new Set<string>()

  const clear = (): void => {
    chunks = new Map()
    length = 0
    overflowed = new Set()
  }

  return {
    begin() {
      collecting = true
      clear()
    },
    push(sessionId, data) {
      if (!collecting || overflowed.has(sessionId)) return
      if (length + data.length > maxLength) {
        overflowed.add(sessionId)
        return
      }
      const list = chunks.get(sessionId) ?? []
      list.push(data)
      chunks.set(sessionId, list)
      length += data.length
    },
    take(sessionId) {
      const taken = sessionId === null ? [] : (chunks.get(sessionId) ?? [])
      collecting = false
      clear()
      return taken
    },
    isCollecting: () => collecting
  }
}
