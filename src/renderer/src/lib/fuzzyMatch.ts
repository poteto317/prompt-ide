export type FuzzyMatchResult = {
  /** スコアが高いほど良いマッチ。絶対値に意味はなく、同一クエリ内の比較にのみ使う */
  score: number
  /** マッチした target 上のインデックス(昇順)。ハイライト描画に使う */
  indices: number[]
}

const MATCH_SCORE = 16
const BONUS_CONSECUTIVE = 8
const BONUS_BOUNDARY = 8
const BONUS_CASE_EXACT = 2
/** マッチ間で読み飛ばした 1 文字あたりの減点 */
const PENALTY_GAP = 1

const SEPARATOR_PATTERN = /[/\\\-_. ]/

const isUpperAlpha = (char: string): boolean =>
  char !== char.toLowerCase() && char === char.toUpperCase()

const isLowerAlpha = (char: string): boolean =>
  char !== char.toUpperCase() && char === char.toLowerCase()

/**
 * 単語の先頭とみなせる位置か判定する。
 * 先頭 / 区切り文字の直後 / camelCase の大文字の 3 種を境界として扱う。
 */
const isWordBoundary = (target: string, index: number): boolean => {
  if (index === 0) return true
  const prev = target[index - 1]
  const current = target[index]
  if (SEPARATOR_PATTERN.test(prev)) return true
  return isLowerAlpha(prev) && isUpperAlpha(current)
}

/**
 * 元の文字列と同じ長さを保ったまま小文字化する。
 * `'İ'.toLowerCase()` のように 1 文字が 2 コードユニットへ展開されるケースがあり、
 * 文字列全体を `toLowerCase()` すると以降のインデックスがずれる。indices は
 * 元の target の添字としてハイライト描画に使うため、長さは必ず一致させる。
 */
const foldCase = (text: string): string => {
  let folded = ''
  for (let i = 0; i < text.length; i++) {
    const lowered = text[i].toLowerCase()
    folded += lowered.length === 1 ? lowered : lowered[0]
  }
  return folded
}

/**
 * query が target の部分列として存在するかを O(target.length) で先に判定する。
 * 大半のファイルはここで落ちるため、コストの高い DP を走らせる件数を減らせる。
 * DP と走査単位を揃えるため、コードポイントではなくコードユニット単位で見る。
 */
const containsSubsequence = (query: string, target: string): boolean => {
  let searchFrom = 0
  for (let i = 0; i < query.length; i++) {
    const found = target.indexOf(query[i], searchFrom)
    if (found === -1) return false
    searchFrom = found + 1
  }
  return true
}

/**
 * query を target の部分列としてあいまい一致させ、最良のマッチ位置とスコアを返す。
 * マッチしない場合は null。
 *
 * 貪欲に前から詰めるのではなく DP で全候補の最大スコアを求める。貪欲だと
 * 'fs' × 'useFileSystem.ts' で最初に見つかる 's'(index 9) を選んでしまい、
 * 単語境界の 'S'(index 7) を取り逃がすため。
 */
export const fuzzyMatch = (query: string, target: string): FuzzyMatchResult | null => {
  if (query.length === 0 || query.length > target.length) return null

  const loweredQuery = foldCase(query)
  const loweredTarget = foldCase(target)
  if (!containsSubsequence(loweredQuery, loweredTarget)) return null

  const queryLength = loweredQuery.length
  const targetLength = loweredTarget.length

  // scores[i][j]: query[0..i] を「query[i] が target[j] にマッチする形」で
  // 消費したときの最大スコア。到達不能な組み合わせは null で表す。
  const scores: (number | null)[][] = []
  // 直前の query 文字がマッチした target 上の位置(backtrack 用)
  const previousIndex: number[][] = []

  for (let i = 0; i < queryLength; i++) {
    scores.push(new Array<number | null>(targetLength).fill(null))
    previousIndex.push(new Array<number>(targetLength).fill(-1))
  }

  for (let i = 0; i < queryLength; i++) {
    // carry は「これまでに見た k(<j) のうち scores[i-1][k] + k * PENALTY_GAP の最大値」。
    // ギャップ減点が距離に比例するため、この形で持てば内側ループを回さずに
    // 非連続マッチの最良候補を O(1) で引ける(全体で O(query * target))。
    let carry: number | null = null
    let carryIndex = -1

    for (let j = 0; j < targetLength; j++) {
      if (i > 0 && j > 0) {
        const candidate = scores[i - 1][j - 1]
        if (candidate !== null) {
          const normalized = candidate + (j - 1) * PENALTY_GAP
          if (carry === null || normalized > carry) {
            carry = normalized
            carryIndex = j - 1
          }
        }
      }

      // query[i] を成立させるには target 側に少なくとも i 文字の前置きが要る。
      // ここで打ち切らないと j=0 のときに scores[i - 1][-1] を読んで undefined になり、
      // 算術が NaN に化けて carry 経由で後続のセルまで汚染する。
      if (j < i) continue
      if (loweredTarget[j] !== loweredQuery[i]) continue

      let cellScore = MATCH_SCORE
      if (isWordBoundary(target, j)) cellScore += BONUS_BOUNDARY
      if (target[j] === query[i]) cellScore += BONUS_CASE_EXACT

      if (i === 0) {
        // 先頭文字は target の先頭から離れているほど減点し、前方のマッチを優先する
        scores[i][j] = cellScore - j * PENALTY_GAP
        continue
      }

      const previousScore = scores[i - 1][j - 1]
      const consecutive =
        previousScore === null ? null : previousScore + BONUS_CONSECUTIVE + cellScore
      const gapped = carry === null ? null : carry - (j - 1) * PENALTY_GAP + cellScore

      if (consecutive !== null && (gapped === null || consecutive >= gapped)) {
        scores[i][j] = consecutive
        previousIndex[i][j] = j - 1
      } else if (gapped !== null) {
        scores[i][j] = gapped
        previousIndex[i][j] = carryIndex
      }
    }
  }

  const lastRow = scores[queryLength - 1]
  let bestIndex = -1
  let bestScore = -Infinity
  for (let j = 0; j < targetLength; j++) {
    const score = lastRow[j]
    if (score !== null && score > bestScore) {
      bestScore = score
      bestIndex = j
    }
  }
  if (bestIndex === -1) return null

  const indices = new Array<number>(queryLength)
  let cursor = bestIndex
  for (let i = queryLength - 1; i >= 0; i--) {
    indices[i] = cursor
    cursor = previousIndex[i][cursor]
  }

  return { score: bestScore, indices }
}
