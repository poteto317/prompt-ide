import type { ViewportLine } from './agentViewport'
import { lineText } from './agentViewport'
import { locateInputBox } from './agentInputBox'

// 画面の末尾から、claude の活動の状態を判定する純粋関数(設計書「状態」)。claude 2.1.288 の画面で記録した
// (agentScreens.json)。判定は上から順に、最初に当てはまったもの。例外は投げない

export type AgentActivity = 'working' | 'idle' | 'permission' | 'confirm' | 'unknown'

const PERMISSION_QUESTION = /^\s*Do you want to /
/** カーソルのある番号付きの選択肢の行(` ❯ 1. Yes`)。字下げを必須にする(履歴に残る `❯ 1. fix the parser` のプロンプトに当てないため)。1 つ目の組は番号の桁 */
const PERMISSION_CURSOR_OPTION = /^(\s+❯\s*)\d+\./
/** 番号で始まる行(`   1. Yes`)。番号の桁がカーソルの行と同じ行だけを選択肢の行とみなす(折り返した問いの `2.md?` を除くため) */
const NUMBERED_LINE = /^\s*\d+\./
/**
 * 選択肢の行。字下げを必須にする(会話の履歴に残る利用者のプロンプトは 1 桁目から `❯ hello` と描かれ、
 * 入力欄が見つからない画面でこれを選択肢とみなすと確認待ちと誤って知らせるため)
 */
const CHOICE_LINE = /^\s+❯ \S/
const CONFIRM_HINT = 'Enter to confirm'
/** スピナーの記号(行の 1 桁目)。スピナーの行と要約の行で同じ集まりを使う(片方だけ直すと、新しい記号の要約の行を作業中と取り違える) */
const SPINNER_GLYPH = '[·✢✳✶✻✽*]'
/** スピナーの行。1 桁目だけを見る(字下げのある箇条書き `  · …` には当たらない) */
const SPINNER_LINE = new RegExp(`^${SPINNER_GLYPH} \\S`)
/** 作業を終えた後の要約の行(`✻ Worked for 1m 3s`)。経過時間で行が終わるものだけ。スピナーの行とはみなさない */
const SUMMARY_LINE = new RegExp(`^${SPINNER_GLYPH} \\S+ for (?:\\d+h )?(?:\\d+m )?\\d+[hms]\\s*$`)
/** `/compact` の後に履歴の先頭へ出る圧縮の行(`✻ Conversation compacted · ctrl+o for history`)。要約の行と同じくスピナーの行とみなさない */
const COMPACTED_LINE = new RegExp(`^${SPINNER_GLYPH} Conversation compacted`)
const INTERRUPT_HINT = 'esc to interrupt'

const isSpinnerLine = (text: string): boolean =>
  SPINNER_LINE.test(text) && !SUMMARY_LINE.test(text) && !COMPACTED_LINE.test(text)

const indentOf = (text: string): number => /^\s*/.exec(text)?.[0].length ?? 0

/** 1 桁目が空白の行(空行・字下げの行)。スピナーと入力欄の間に描かれる TodoWrite の一覧 `  ⎿  ☐ …`・tip `  ⎿  Tip: …` など */
const isBlankOrIndented = (text: string): boolean => text === '' || /^\s/.test(text)

/**
 * スピナーと入力欄の間にだけ描かれる行: TodoWrite の一覧の項目の行(1 行目の `  ⎿  ☐ Step 1` も 2 行目以降の `     ☐ Step 2` も)と
 * tip の行(`  ⎿  Tip: …`)。ツールの結果・`!` のシェルのモードの出力・スラッシュコマンドの出力の `⎿` の行は含めない(ローカルレビュー第 20 周)。
 * todo の項目の記号(☐☒◻◼)は claude 2.1.288 で記録した画面が無い手書きの推測で、claude の版で外れうる。
 * `✔` はテストランナー(node:test・mocha)の出力でよく使われるので含めない(ローカルレビュー第 21 周)。
 * todo の一覧が出る作業中の画面を agentScreens.json に記録できたら記号を確かめる
 */
const TODO_ITEM_LINE = /^\s*(?:⎿\s+)?[☐☒◻◼]\s/
const TIP_LINE = /^\s*⎿\s+Tip:/
const isBetweenSpinnerAndInputLine = (text: string): boolean =>
  TODO_ITEM_LINE.test(text) || TIP_LINE.test(text)
/** todo の項目の記号の桁(`  ⎿  ☐ …`・`     ☐ …` の `☐`)。tip の本文(`  ⎿  Tip: …` の `T`)も同じ桁から始まる */
const ITEM_TEXT_COLUMN = 5
/**
 * 折り返しの継続行: todo の項目・tip の本文が画面の幅を超えたときの 2 行目以降(`       configuration format`・`     CLAUDE.md files`)。
 * 字下げが項目の記号の桁以上で、それ自体は todo の項目の行でない行(`⎿` の行は 2 桁の字下げなので当たらない。ローカルレビュー第 22 周)
 */
const isWrappedContinuationLine = (text: string): boolean =>
  text.trim() !== '' && indentOf(text) >= ITEM_TEXT_COLUMN && !TODO_ITEM_LINE.test(text)

/**
 * 作業中の根拠になる行。入力欄のある画面では、スピナーの行は上の罫線から上へ空行と字下げのある行(1 桁目が空白の行)を
 * 飛ばした最初の行だけ(スピナーは入力欄の上に描かれ、その間には todo の一覧・tip などの字下げの行だけが入る)、
 * `esc to interrupt` は下の罫線より下の案内の行だけで見る。会話の履歴に残る同じ形の行
 * (`/compact` の後の `✻ Conversation compacted · ctrl+o for history`・本文中の語)で作業中としないため。
 * 入力欄の無い画面(描き直しの途中など)は画面全体を見る。
 * 上へたどって字下げの行だけで画面の上端に達したとき、上の罫線の上(空行を除いて最も近い)の字下げの行から上へ、折り返しの
 * 継続行(字下げが todo の項目の記号の桁〈5 桁〉以上で、todo の項目の行でない行)を飛ばした最初の行(項目の先頭の行)が
 * todo の項目の行か tip の行なら、スピナーの行が画面の外にあり得るので根拠なし(`no-evidence`。ローカルレビュー第 18・20・21・22 周)。
 * そうでなければ画面より長い応答の継続行・箇条書き・ツールの結果・`!` やスラッシュコマンドの出力なので入力待ち(`not-working`。
 * ローカルレビュー第 19・20 周)。todo の一覧・tip は入力欄の直上に描かれるが、`!` の出力の途中の行(テストランナーの `✔ …` など)は
 * 入力欄の直上に来るとは限らないので、直上の項目だけを見る(ローカルレビュー第 21 周)。最後の項目が画面の幅で折り返されても
 * 項目の先頭の行で判定できるよう、継続行は飛ばす(ローカルレビュー第 22 周)
 */
type WorkingEvidence = 'working' | 'not-working' | 'no-evidence'

function judgeWorking(
  texts: readonly string[],
  top: number | null,
  bottom: number | null
): WorkingEvidence {
  if (bottom === null) {
    return texts.some((text) => isSpinnerLine(text) || text.includes(INTERRUPT_HINT))
      ? 'working'
      : 'not-working'
  }
  if (texts.slice(bottom + 1).some((text) => text.includes(INTERRUPT_HINT))) return 'working'
  if (top === null) return 'not-working'
  let nearestIndented: number | null = null
  for (let y = top - 1; y >= 0; y--) {
    if (!isBlankOrIndented(texts[y])) return isSpinnerLine(texts[y]) ? 'working' : 'not-working'
    if (nearestIndented === null && texts[y].trim() !== '') nearestIndented = y
  }
  if (nearestIndented === null) return 'not-working'
  let head = nearestIndented
  while (head >= 0 && isWrappedContinuationLine(texts[head])) head--
  return head >= 0 && isBetweenSpinnerAndInputLine(texts[head]) ? 'no-evidence' : 'not-working'
}

/** 罫線だけの行(許可の画面の `────` の枠・`╌╌╌╌` の区切り)。問いの段落の区切りにする */
const RULE_LINE = /^[\s─━═╌╍┄┅┈┉]+$/

/**
 * 許可の確認の並び: カーソルのある番号付きの選択肢の行から上へ、空行・番号付きの選択肢の行(番号がカーソルの行と同じ桁から始まる行。問いの折り返しの `2.md?` を除くため。
 * ローカルレビュー第 14 周)とその折り返しの行(番号の桁より深く字下げされた行)を飛ばした先の段落が問い。段落は、最初に当たった空でない行から上へ、番号の桁と同じかそれより浅い字下げの
 * 空でない行(罫線の行を除く)が続く間で、問いが画面の幅を超えると claude が 1 行目と同じ字下げで折り返すため(ローカルレビュー
 * 第 12 周)。段落の先頭の行が `Do you want to ` で始まり、最後の行(選択肢の直上)が `?` で終わるときだけ許可待ちとする。
 * 問いの行と選択肢の行を画面全体から別々に探すと、履歴に残る `❯ 1. …` のプロンプトや応答の継続行の `  Do you want to …` で
 * 許可待ちと誤るため(ローカルレビュー第 11 周)
 */
function isPermissionPrompt(texts: readonly string[]): boolean {
  return texts.some((text, y) => {
    const cursor = PERMISSION_CURSOR_OPTION.exec(text)
    if (cursor === null) return false
    const numberColumn = cursor[1].length
    const inParagraph = (line: string): boolean =>
      line.trim() !== '' && !RULE_LINE.test(line) && indentOf(line) <= numberColumn
    let last = y - 1
    while (
      last >= 0 &&
      (texts[last].trim() === '' ||
        (NUMBERED_LINE.test(texts[last]) && indentOf(texts[last]) === numberColumn) ||
        indentOf(texts[last]) > numberColumn)
    ) {
      last--
    }
    if (last < 0 || !inParagraph(texts[last])) return false
    let first = last
    while (first > 0 && inParagraph(texts[first - 1])) first--
    return PERMISSION_QUESTION.test(texts[first]) && texts[last].trimEnd().endsWith('?')
  })
}

export function classifyAgentScreen(lines: readonly ViewportLine[]): AgentActivity {
  const texts = lines.map(lineText)
  const located = locateInputBox(lines)
  const hasInputBox = located !== null
  if (!hasInputBox && isPermissionPrompt(texts)) return 'permission'
  if (!hasInputBox && texts.some((text) => CHOICE_LINE.test(text) || text.includes(CONFIRM_HINT))) {
    return 'confirm'
  }
  const evidence = judgeWorking(texts, located?.top ?? null, located?.bottom ?? null)
  if (evidence === 'working') return 'working'
  if (evidence === 'no-evidence') return 'unknown'
  // 入力欄が画面の高さを超えて上の罫線が見えない画面は、スピナーの行が画面の外にあり、書きかけがあると esc to interrupt も消える。
  // 作業中か入力待ちかを見分ける根拠が無いので、入力待ちと言い切らず unknown にする(ローカルレビュー第 15 周)
  if (located !== null && located.top === null) return 'unknown'
  return hasInputBox ? 'idle' : 'unknown'
}
