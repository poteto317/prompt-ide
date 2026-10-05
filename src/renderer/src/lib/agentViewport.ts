// xterm の表示中の画面を、入力欄の判定(agentInputBox)が読む行の配列にする。xterm の型に依らない最小の
// インターフェースで受ける(テストでは @xterm/headless の実物のバッファを渡せる。パターン 128)

export interface ViewportCell {
  /** セルの文字。空のセルは ' ' */
  char: string
  dim: boolean
  inverse: boolean
}

/** 画面の 1 行。幅 0 のセル(全角の文字の右半分)を除いたセルの並び */
export type ViewportLine = readonly ViewportCell[]

export interface BufferCellLike {
  getChars(): string
  getWidth(): number
  isDim(): number
  isInverse(): number
}

export interface BufferLineLike {
  readonly length: number
  getCell(x: number): BufferCellLike | undefined
}

export interface ViewportBufferLike {
  readonly viewportY: number
  getLine(y: number): BufferLineLike | undefined
}

/** 表示中の rows 行を読む(スクロールで戻していても、画面に見えている範囲) */
export function readViewportLines(buffer: ViewportBufferLike, rows: number): ViewportLine[] {
  const lines: ViewportLine[] = []
  for (let y = 0; y < rows; y++) {
    const line = buffer.getLine(buffer.viewportY + y)
    const cells: ViewportCell[] = []
    if (line !== undefined) {
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x)
        if (cell === undefined) break
        if (cell.getWidth() === 0) continue
        cells.push({
          char: cell.getChars() || ' ',
          dim: cell.isDim() !== 0,
          inverse: cell.isInverse() !== 0
        })
      }
    }
    lines.push(cells)
  }
  return lines
}

/** 行の文字列(セルの文字を連結したもの。末尾の空白も残す) */
export function lineText(line: ViewportLine): string {
  return line.map((cell) => cell.char).join('')
}
