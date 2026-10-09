// sessionId が決まるまでに届いたエージェントの出力を溜める(agentTerminalController の部品。React と xterm に依らない)。
// 起動の準備(begin)から sessionId が決まる(take)までの間だけ、セッションごとに届いた順で溜める。溜める量はセッションごとに
// 上限を持ち(動いているほかのタブの大量の出力が、起動中のタブ自身の出力の分を使い切らないため)、上限を超えるチャンクが
// 届いたセッションは、その後のチャンクも溜めない(小さいチャンクだけ溜め続けて途中が欠けた出力にしない)

export interface PendingOutputBuffer {
  /** 溜め始める。前に溜めた出力・セッションごとの量・上限を超えた印を捨てる */
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
  // セッションごとに溜めた量(UTF-16 の単位)
  let lengths = new Map<string, number>()
  // 上限を超えるチャンクが届いた(以降は溜めない)セッション
  let overflowed = new Set<string>()

  const clear = (): void => {
    chunks = new Map()
    lengths = new Map()
    overflowed = new Set()
  }

  return {
    begin() {
      collecting = true
      clear()
    },
    push(sessionId, data) {
      if (!collecting || overflowed.has(sessionId)) return
      const length = lengths.get(sessionId) ?? 0
      if (length + data.length > maxLength) {
        overflowed.add(sessionId)
        return
      }
      const list = chunks.get(sessionId) ?? []
      list.push(data)
      chunks.set(sessionId, list)
      lengths.set(sessionId, length + data.length)
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
