export type HighlightSegment = {
  text: string
  matched: boolean
}

/**
 * マッチ位置(昇順)をもとに、テキストを「一致 / 不一致」の連続した区間へ分割する。
 * 1 文字ずつ要素を出すと 'us' のような連続一致が細切れになり読みづらいため、
 * 描画側が区間単位でハイライトできる形にまとめる。
 */
export const toHighlightSegments = (text: string, indices: number[]): HighlightSegment[] => {
  if (text.length === 0) return []
  if (indices.length === 0) return [{ text, matched: false }]

  const matchedSet = new Set(indices)
  const segments: HighlightSegment[] = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    const isBoundary = i === text.length || matchedSet.has(i) !== matchedSet.has(i - 1)
    if (!isBoundary) continue
    segments.push({ text: text.slice(start, i), matched: matchedSet.has(start) })
    start = i
  }
  return segments
}
