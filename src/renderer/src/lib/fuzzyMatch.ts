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
const isWordBoundary = (points: CodePoint[], index: number): boolean => {
  if (index === 0) return true
  const prev = points[index - 1].char
  const current = points[index].char
  if (SEPARATOR_PATTERN.test(prev)) return true
  return isLowerAlpha(prev) && isUpperAlpha(current)
}

/** コードポイント 1 文字と、元の文字列における UTF-16 上の開始位置 */
type CodePoint = { char: string; offset: number }

/**
 * 文字列をコードポイント単位に分解する。
 *
 * コードユニット単位で照合すると、異なるサロゲートペアの片側同士を
 * 1 文字として拾ってしまう(例: 😀 が 😁 の前半と 🨀 の後半から成立する)。
 * 元の添字は offset として保持し、ハイライト用の indices へ戻すときに使う。
 */
const toCodePoints = (text: string): CodePoint[] => {
  const points: CodePoint[] = []
  let offset = 0
  for (const char of text) {
    points.push({ char, offset })
    offset += char.length
  }
  return points
}

/**
 * 1 文字を比較用に小文字化する。
 * `'İ'.toLowerCase()` のように 1 文字が複数の文字へ展開されるケースがあるため、
 * 先頭の 1 文字だけを使って 1 対 1 の対応を保つ。
 */
const foldChar = (char: string): string => {
  const lowered = char.toLowerCase()
  return [...lowered][0] ?? lowered
}

/**
 * DP を走らせるセル数(クエリ長 × ターゲット長)の上限。
 * これを超える組み合わせでは貪欲法の結果をそのまま使う。長いクエリが多数の
 * 長いパスの部分列になり得る場合に、1 打鍵あたりの計算量が跳ね上がるのを防ぐ。
 */
const MAX_DP_CELLS = 8192

/**
 * query を target の部分列として前から詰めた位置を O(target.length) で求める。
 * 部分列として存在しなければ null。大半のファイルはここで落ちるため、
 * コストの高い DP を走らせる件数を減らせる。
 * 添字は DP と揃えてコードポイント単位で返す。
 */
const greedySubsequence = (query: string[], target: string[]): number[] | null => {
  const indices: number[] = []
  let searchFrom = 0
  for (let i = 0; i < query.length; i++) {
    const found = target.indexOf(query[i], searchFrom)
    if (found === -1) return null
    indices.push(found)
    searchFrom = found + 1
  }
  return indices
}

/** 与えられたマッチ位置のスコアを DP と同じ配点で求める(貪欲法の結果用) */
const scoreOfIndices = (query: CodePoint[], target: CodePoint[], indices: number[]): number => {
  let score = 0
  for (let k = 0; k < indices.length; k++) {
    const j = indices[k]
    let cellScore = MATCH_SCORE
    if (isWordBoundary(target, j)) cellScore += BONUS_BOUNDARY
    if (target[j].char === query[k].char) cellScore += BONUS_CASE_EXACT
    if (k === 0) {
      score += cellScore - j * PENALTY_GAP
      continue
    }
    const gap = j - indices[k - 1] - 1
    score += cellScore - gap * PENALTY_GAP + (gap === 0 ? BONUS_CONSECUTIVE : 0)
  }
  return score
}

/**
 * コードポイント単位の添字を、元の文字列の UTF-16 添字へ展開する。
 * サロゲートペアは 2 つの添字に開き、ハイライトが文字を分断しないようにする。
 */
const toUtf16Indices = (target: CodePoint[], indices: number[]): number[] => {
  const expanded: number[] = []
  for (const index of indices) {
    const { char, offset } = target[index]
    for (let unit = 0; unit < char.length; unit++) expanded.push(offset + unit)
  }
  return expanded
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
  const queryPoints = toCodePoints(query)
  const targetPoints = toCodePoints(target)
  if (queryPoints.length === 0 || queryPoints.length > targetPoints.length) return null

  const loweredQuery = queryPoints.map((point) => foldChar(point.char))
  const loweredTarget = targetPoints.map((point) => foldChar(point.char))
  const greedyIndices = greedySubsequence(loweredQuery, loweredTarget)
  if (greedyIndices === null) return null

  const queryLength = loweredQuery.length
  const targetLength = loweredTarget.length

  // 計算量の上限を超える組み合わせでは DP を諦め、貪欲法の位置をそのまま使う。
  // 最適な位置ではなくなり得るが、一致判定と indices の整合は保たれる
  if (queryLength * targetLength > MAX_DP_CELLS) {
    return {
      score: scoreOfIndices(queryPoints, targetPoints, greedyIndices),
      indices: toUtf16Indices(targetPoints, greedyIndices)
    }
  }

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
      if (isWordBoundary(targetPoints, j)) cellScore += BONUS_BOUNDARY
      if (targetPoints[j].char === queryPoints[i].char) cellScore += BONUS_CASE_EXACT

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

  return { score: bestScore, indices: toUtf16Indices(targetPoints, indices) }
}
