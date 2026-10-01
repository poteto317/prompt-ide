import { createHash } from 'node:crypto'
import type { ConflictChoice, ConflictSegment } from '../shared/types/git'

type Eol = '\n' | '\r\n'
/** 行の末尾の改行。ファイルの最終行で改行が無ければ '' */
type LineEnd = Eol | ''

export type ParsedConflict = {
  segments: ConflictSegment[]
  /** 多数派の改行コード(表示用。書き戻しは lineEnds の行ごとの改行を使う) */
  eol: Eol
  /** 元のファイルが改行で終わっていたか（書き戻しで保つ） */
  endsWithEol: boolean
  /**
   * segments と同じ並びの、セグメントを構成する元の行(マーカー行を含む)ごとの改行。
   * text は lines の順。conflict は 開始マーカー・ours・(基底マーカー・base)・区切り・theirs・
   * 終了マーカー の順。書き戻しで行ごとの改行コードを元のまま保つために使う
   */
  lineEnds: LineEnd[][]
  /** マーカーの長さ(.gitattributes の conflict-marker-size。既定 7)。未選択のブロックの書き戻しに使う */
  markerSize: number
}

/** git の既定のマーカーの長さ */
export const DEFAULT_CONFLICT_MARKER_SIZE = 7

// マーカーは行頭の markerSize 文字ちょうど(既定 7。.gitattributes の conflict-marker-size で変わる)。
// ラベルは半角スペースの後ろ（無い場合もある）。インデント付き・長さの違う行は本文として扱う。
// マーカーの文字列は repeat で作らずに 1 文字ずつ見る(属性の値が巨大でも文字列を確保しない)
const isMarker = (l: string, ch: string, n: number): boolean => {
  if (l.length < n || (l.length > n && l[n] !== ' ')) return false
  for (let i = 0; i < n; i++) if (l[i] !== ch) return false
  return true
}

type Markers = {
  isOpen: (l: string) => boolean
  isBase: (l: string) => boolean
  isSep: (l: string) => boolean
  isClose: (l: string) => boolean
  labelOf: (l: string) => string
}

const markersOf = (n: number): Markers => ({
  isOpen: (l: string): boolean => isMarker(l, '<', n),
  isBase: (l: string): boolean => isMarker(l, '|', n),
  isSep: (l: string): boolean => l.length === n && isMarker(l, '=', n),
  isClose: (l: string): boolean => isMarker(l, '>', n),
  labelOf: (l: string): string => l.slice(n + 1)
})

/**
 * 開始・基底（diff3）・終了のマーカーの行が残っているか。CR は除いて見る。
 * `=======` の単独行は検査しない: Markdown の見出し下線など本文にも現れ、ブロックを解決した後も
 * 残るため、検査すると解決済みにできなくなる（<<<<<<< と >>>>>>> を消して ======= だけ残す手編集は見逃す）
 */
export function hasConflictMarker(
  text: string,
  markerSize: number = DEFAULT_CONFLICT_MARKER_SIZE
): boolean {
  const { isOpen, isBase, isClose } = markersOf(markerSize)
  return text.split(/\r?\n/).some((l) => isOpen(l) || isBase(l) || isClose(l))
}

type State = 'text' | 'ours' | 'base' | 'theirs'

/** コンフリクトのマーカーを解析する。解析できない形のときは null */
export function parseConflictFile(
  content: string,
  markerSize: number = DEFAULT_CONFLICT_MARKER_SIZE
): ParsedConflict | null {
  const { isOpen, isBase, isSep, isClose, labelOf } = markersOf(markerSize)
  const crlf = (content.match(/\r\n/g) ?? []).length
  const lf = (content.match(/\n/g) ?? []).length - crlf
  const eol: Eol = crlf > lf ? '\r\n' : '\n'

  // 行と、その行の改行(\r\n / \n / 最終行で無ければ '')を組で持つ
  const parts = content.split(/(\r?\n)/)
  const lines: string[] = []
  const ends: LineEnd[] = []
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i])
    ends.push((parts[i + 1] as Eol | undefined) ?? '')
  }
  const endsWithEol = lines.length > 1 && lines[lines.length - 1] === ''
  if (endsWithEol) {
    lines.pop()
    ends.pop()
  }

  const segments: ConflictSegment[] = []
  const lineEnds: LineEnd[][] = []
  // 今のセグメント(text またはブロック)を構成する元の行の改行
  let segEnds: LineEnd[] = []
  let state: State = 'text'
  let text: string[] = []
  let ours: string[] = []
  let base: string[] | undefined
  let baseLabel = ''
  let theirs: string[] = []
  let oursLabel = ''

  for (const [i, line] of lines.entries()) {
    const end = ends[i]
    if (state === 'text') {
      if (isOpen(line)) {
        if (text.length > 0) {
          segments.push({ kind: 'text', lines: text })
          lineEnds.push(segEnds)
        }
        text = []
        segEnds = [end]
        ours = []
        base = undefined
        theirs = []
        oursLabel = labelOf(line)
        state = 'ours'
      } else if (isBase(line) || isClose(line)) {
        return null
      } else {
        // 区切りの `=======` 単独行はブロックの中にしか現れない。外にあるものは
        // Markdown の setext 見出しの下線などの本文として扱う
        text.push(line)
        segEnds.push(end)
      }
      continue
    }
    if (isOpen(line)) return null
    segEnds.push(end)
    if (state === 'ours') {
      if (isBase(line)) {
        base = []
        baseLabel = labelOf(line)
        state = 'base'
      } else if (isSep(line)) {
        state = 'theirs'
      } else if (isClose(line)) {
        return null
      } else {
        ours.push(line)
      }
    } else if (state === 'base') {
      if (isSep(line)) {
        state = 'theirs'
      } else if (isBase(line) || isClose(line)) {
        return null
      } else {
        base?.push(line)
      }
    } else {
      if (isClose(line)) {
        segments.push({
          kind: 'conflict',
          ours,
          theirs,
          ...(base ? { base, baseLabel } : {}),
          oursLabel,
          theirsLabel: labelOf(line)
        })
        lineEnds.push(segEnds)
        segEnds = []
        state = 'text'
      } else if (isBase(line) || isSep(line)) {
        return null
      } else {
        theirs.push(line)
      }
    }
  }
  if (state !== 'text') return null
  if (text.length > 0) {
    segments.push({ kind: 'text', lines: text })
    lineEnds.push(segEnds)
  }
  return { segments, eol, endsWithEol, lineEnds, markerSize }
}

/**
 * マーカーの長さの候補(長い順)で解析する。ブロックが 1 件以上取れる最初の候補の結果を返す。
 * どの候補でもブロックが無いとき、すべての候補で解析できれば(=どの長さのマーカーも無い)
 * 0 件の結果を、どれかの候補で解析できなければ(壊れたマーカーが残っている)null を返す。
 * 長い順に試すのは、長い conflict-marker-size を設定するファイルは短いマーカー風の行を本文に
 * 含むことが多く、短い候補から試すと本文をブロックと誤認しやすいため
 */
export function parseConflictFileWithSizes(
  content: string,
  markerSizes: readonly number[]
): ParsedConflict | null {
  let empty: ParsedConflict | null = null
  let broken = false
  for (const size of markerSizes) {
    const parsed = parseConflictFile(content, size)
    if (!parsed) {
      broken = true
    } else if (parsed.segments.some((s) => s.kind === 'conflict')) {
      return parsed
    } else {
      empty ??= parsed
    }
  }
  return broken ? null : empty
}

/** マーカーの長さの候補のどれかで、開始・基底・終了のマーカーの行が残っているか */
export function hasConflictMarkerOfSizes(text: string, markerSizes: readonly number[]): boolean {
  return markerSizes.some((size) => hasConflictMarker(text, size))
}

/** コンフリクトのブロックごとの内容ダイジェスト（ブロックの順）。内容が変われば値が変わる */
export function digestConflictBlocks(segments: ConflictSegment[]): string[] {
  const digests: string[] = []
  for (const seg of segments) {
    if (seg.kind !== 'conflict') continue
    // 行の並びを JSON にして、側の境界・行の境界が曖昧にならないようにする
    const payload = JSON.stringify([seg.ours, seg.theirs, seg.base ?? null])
    digests.push(createHash('sha1').update(payload).digest('hex'))
  }
  return digests
}

/**
 * 選択に従ってブロックを解決した本文を作る。choices のキーはコンフリクトのブロックの
 * 0 始まりの番号。未指定のブロックは元のマーカー付きで書き戻す。
 * 改行コードは行ごとに元のまま保つ(本文の行・選んだ側の行・残すマーカー行のいずれも、
 * parseConflictFile が記録した元の改行で出力する)。選んだ側の行は直後にマーカー行が続くため
 * 必ず改行を持ち、both の境界で改行が欠けたり重なったりしない。
 * ファイル末尾の改行の有無は元のとおりに保つ: 元が改行なしで終わる(最終行が終了マーカーで
 * 改行なしの場合を含む)なら、出力の最後の行の改行を除く
 */
export function applyConflictChoices(
  parsed: ParsedConflict,
  choices: Record<number, ConflictChoice>
): string {
  const { segments, lineEnds, endsWithEol, markerSize } = parsed
  // 未選択のブロックのマーカー。マーカーが残っている(=ファイルに markerSize 文字の行がある)
  // ときだけ作る
  const marker = (ch: string, label = ''): string =>
    ch.repeat(markerSize) + (label ? ` ${label}` : '')
  const blockCount = segments.filter((s) => s.kind === 'conflict').length
  // キーは 0 始まりの正規の 10 進表記だけ受け付ける（'' や '01' は Number では有効な番号になるが、
  // choices[index] の参照で見つからず、黙って未選択として扱われてしまう）
  for (const key of Object.keys(choices)) {
    const n = Number(key)
    if (!Number.isInteger(n) || n < 0 || n >= blockCount || String(n) !== key) {
      throw new Error('ブロックの番号が範囲外です')
    }
  }

  // [行の内容, 改行] の組の並び
  const out: [string, LineEnd][] = []
  const emit = (lines: string[], ends: LineEnd[]): void => {
    lines.forEach((l, i) => out.push([l, ends[i]]))
  }
  let index = 0
  segments.forEach((seg, segIndex) => {
    const ends = lineEnds[segIndex]
    if (seg.kind === 'text') {
      emit(seg.lines, ends)
      return
    }
    // ends の並び: 開始マーカー・ours・(基底マーカー・base)・区切り・theirs・終了マーカー
    const oursEnds = ends.slice(1, 1 + seg.ours.length)
    const baseStart = 1 + seg.ours.length
    const sepIndex = seg.base ? baseStart + 1 + seg.base.length : baseStart
    const theirsEnds = ends.slice(sepIndex + 1, sepIndex + 1 + seg.theirs.length)
    const closeEnd = ends[ends.length - 1]
    const choice = choices[index]
    index++
    if (choice === 'ours') emit(seg.ours, oursEnds)
    else if (choice === 'theirs') emit(seg.theirs, theirsEnds)
    else if (choice === 'both') {
      emit(seg.ours, oursEnds)
      emit(seg.theirs, theirsEnds)
    } else {
      out.push([marker('<', seg.oursLabel), ends[0]])
      emit(seg.ours, oursEnds)
      if (seg.base) {
        out.push([marker('|', seg.baseLabel), ends[baseStart]])
        emit(seg.base, ends.slice(baseStart + 1, sepIndex))
      }
      out.push([marker('='), ends[sepIndex]])
      emit(seg.theirs, theirsEnds)
      out.push([marker('>', seg.theirsLabel), closeEnd])
    }
  })
  if (out.length === 0) return ''
  if (!endsWithEol) out[out.length - 1] = [out[out.length - 1][0], '']
  return out.map(([line, end]) => line + end).join('')
}
