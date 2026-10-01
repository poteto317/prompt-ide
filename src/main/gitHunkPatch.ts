export const PATCH_MISMATCH_MESSAGE = 'パッチの対象がファイルと一致しません'

class PatchMismatchError extends Error {
  constructor() {
    super(PATCH_MISMATCH_MESSAGE)
  }
}

const SIMPLE_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  '"': 0x22,
  '\\': 0x5c
}

// git が特殊文字・非 ASCII のパスに付ける C 言語風の引用符つき表記(`"a/\346\227\245.txt"`)を
// デコードする。値の全体が引用符で囲まれていること、エスケープが git の出力する形式であることを
// 要求し、解釈できなければ null を返す。8 進エスケープはバイト列として集めて UTF-8 に戻す
function decodeQuoted(token: string): string | null {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) return null
  const inner = token.slice(1, -1)
  const bytes: number[] = []
  for (let i = 0; i < inner.length; ) {
    const ch = inner[i]
    if (ch === '"') return null
    if (ch !== '\\') {
      const cp = inner.codePointAt(i) as number
      const text = String.fromCodePoint(cp)
      bytes.push(...Buffer.from(text, 'utf8'))
      i += text.length
      continue
    }
    const next = inner[i + 1]
    if (next === undefined) return null
    if (next in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[next])
      i += 2
      continue
    }
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1))
    if (octal === null || parseInt(octal[0], 8) > 0xff) return null
    bytes.push(parseInt(octal[0], 8))
    i += 4
  }
  return Buffer.from(bytes).toString('utf8')
}

// ヘッダーのパス表記(引用符つきなら decode)を、期待するパスと比べる
function pathTokenEquals(token: string, expected: string): boolean {
  return token.startsWith('"') ? decodeQuoted(token) === expected : token === expected
}

// `diff --git a/<path> b/<path>` の a 側・b 側が、どちらも filePath であること
function isDiffGitLineFor(rest: string, filePath: string): boolean {
  const a = `a/${filePath}`
  const b = `b/${filePath}`
  if (!rest.startsWith('"')) return rest === `${a} ${b}`
  // 引用符つきのパスは、引用符の閉じ位置(エスケープされていない `"`)で 2 つに分ける
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '\\') {
      i++
    } else if (rest[i] === '"') {
      const first = rest.slice(0, i + 1)
      const second = rest.slice(i + 2)
      return rest[i + 1] === ' ' && pathTokenEquals(first, a) && pathTokenEquals(second, b)
    }
  }
  return false
}

// `--- a/<path>` / `+++ b/<path>` の値。空白を含むパスは git が末尾にタブを足す
function isFileLineFor(value: string, prefix: 'a/' | 'b/', filePath: string): boolean {
  return pathTokenEquals(value.replace(/\t$/, ''), `${prefix}${filePath}`)
}

const INDEX_LINE = /^index [0-9a-f]+\.\.[0-9a-f]+( [0-7]{6})?$/
// 削除の復元に許すのは通常ファイルだけ。120000(シンボリックリンク)や 160000(サブモジュール)を
// 許すと、削除済みのファイルが任意の参照先のリンクとして復元できてしまう
const DELETED_MODE_LINE = /^deleted file mode (100644|100755)$/
// git apply は index 行のモードを old_mode として採用するため、削除では deleted file mode と
// 一致することも要求する(git の実際の削除 diff は `index abc..0000000` でモードを付けない)
const OLD_MODE_LINE = /^old mode [0-7]{6}$/
const NEW_MODE_LINE = /^new mode [0-7]{6}$/
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/

// ハンクの取り消しに渡されたパッチの構造を、許可リストで検証する(IPC の境界で届く任意の文字列を
// 信用しない)。許可するのは「filePath 1 件の通常のハンク(または作業ツリーでの削除)」だけで、
// それ以外の行が @@ より前にあれば拒否する。リネーム・コピー・モード変更・新規作成・バイナリ等は
// すべて拒否される。ブラックリストにしないのは、git apply が古い形式(`rename old` / `rename new`)
// や a/b 不一致のパッチも解釈し、--reverse では適用先が入れ替わって別のファイルを書き換える
// ことを実機で確認したため(--numstat は順方向の新パスしか返さず検査できない)
export function assertHunkPatchTargets(patch: string, filePath: string): void {
  // .. や . のセグメント・絶対パスは、ヘッダーと一致していても受け付けない
  if (filePath.startsWith('/') || filePath.split('/').some((s) => s === '..' || s === '.')) {
    throw new PatchMismatchError()
  }
  const lines = patch.split('\n')
  // 末尾の改行による最後の空要素だけは許す
  if (lines[lines.length - 1] === '') lines.pop()
  let i = 0
  if (!lines[i]?.startsWith('diff --git ')) throw new PatchMismatchError()
  if (!isDiffGitLineFor(lines[i].slice('diff --git '.length), filePath)) {
    throw new PatchMismatchError()
  }
  i++
  let deleted = false
  let deletedMode: string | null = null
  const deletedMatch = lines[i] === undefined ? null : DELETED_MODE_LINE.exec(lines[i])
  if (deletedMatch !== null) {
    deleted = true
    deletedMode = deletedMatch[1]
    i++
  } else if (
    lines[i] !== undefined &&
    OLD_MODE_LINE.test(lines[i]) &&
    lines[i + 1] !== undefined &&
    NEW_MODE_LINE.test(lines[i + 1])
  ) {
    // chmod を伴う変更。old mode → new mode の 1 組だけ許可する(適用前に stripModeChangeLines で
    // 取り除く。取り除かないと git apply --reverse がモードも戻そうとして失敗する)
    i += 2
  }
  const indexMatch = lines[i] === undefined ? null : INDEX_LINE.exec(lines[i])
  if (indexMatch !== null) {
    // 削除では、index 行にモードが付くなら deleted file mode と一致すること
    if (deleted && indexMatch[1] !== undefined && indexMatch[1].trim() !== deletedMode) {
      throw new PatchMismatchError()
    }
    i++
  }
  if (lines[i]?.startsWith('--- ') !== true || !isFileLineFor(lines[i].slice(4), 'a/', filePath)) {
    throw new PatchMismatchError()
  }
  i++
  if (lines[i]?.startsWith('+++ ') !== true) throw new PatchMismatchError()
  const newSide = lines[i].slice(4)
  const newSideOk = deleted ? newSide === '/dev/null' : isFileLineFor(newSide, 'b/', filePath)
  if (!newSideOk) throw new PatchMismatchError()
  i++
  if (lines[i] === undefined || !HUNK_HEADER.test(lines[i])) throw new PatchMismatchError()
  // 各ハンクの本文が見出しの行数と一致することを確かめる。一致しないと、git apply は
  // ハンクの後ろに紛れた `--- a/other` / `+++ b/other` を次のファイルのヘッダーとして解釈する
  let remainingOld = 0
  let remainingNew = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    const header = HUNK_HEADER.exec(line)
    if (header !== null) {
      if (remainingOld !== 0 || remainingNew !== 0) throw new PatchMismatchError()
      remainingOld = header[1] === undefined ? 1 : Number(header[1])
      remainingNew = header[2] === undefined ? 1 : Number(header[2])
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" は行数に数えない
    } else if (line.startsWith(' ')) {
      remainingOld--
      remainingNew--
    } else if (line.startsWith('-')) {
      remainingOld--
    } else if (line.startsWith('+')) {
      remainingNew--
    } else {
      throw new PatchMismatchError()
    }
    if (remainingOld < 0 || remainingNew < 0) throw new PatchMismatchError()
  }
  if (remainingOld !== 0 || remainingNew !== 0) throw new PatchMismatchError()
}

// 検証済みのパッチから、ヘッダーの old mode / new mode を取り除く。内容の変更だけを逆適用し、
// ユーザーが chmod した実行権限は残す(実 git で確認済み)。@@ より後ろ(ハンク本文)は触らない
export function stripModeChangeLines(patch: string): string {
  const lines = patch.split('\n')
  const firstHunk = lines.findIndex((line) => HUNK_HEADER.test(line))
  const headerEnd = firstHunk === -1 ? lines.length : firstHunk
  return lines
    .filter(
      (line, index) => index >= headerEnd || !(OLD_MODE_LINE.test(line) || NEW_MODE_LINE.test(line))
    )
    .join('\n')
}
