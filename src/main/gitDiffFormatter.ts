// 未追跡ファイル用の疑似 unified diff テキストを組み立てる。
// git 自体の呼び出し(simple-git)とは無関係な、純粋なテキスト構築の責務のため
// gitService.ts から分離している。
export function buildUntrackedDiff(
  filePath: string,
  content: string,
  isExecutable = false
): string {
  // filePath はこの後 diff --git a/... b/... 等のヘッダ行へそのまま埋め込まれる。
  // POSIX では改行もファイル名に使える文字だが、埋め込むとヘッダ行自体が複数行に
  // 割れ、git apply --cached に渡すと不正なパッチとして拒否される(または意図しない
  // ハンクとして誤解釈されうる)。gitignoreService.ts の addToGitignore が同種の
  // リスクに対して改行を含むパスを拒否しているのと同じ理由で、ヘッダを組み立てる
  // 前に弾く
  if (/[\r\n]/.test(filePath)) {
    return buildInvalidFileNameDiffMessage(filePath)
  }
  const lines = content.split('\n')
  // 末尾が空文字列の要素は、実ファイルが改行で終わっていたことを示す split の仕様上の
  // 余分な要素。改行の有無を判定した上で取り除く(改行が無い場合はマーカーが必要なため)
  const endsWithNewline = lines.length > 0 && lines[lines.length - 1] === ''
  if (endsWithNewline) lines.pop()
  // 100644 固定のままだと、この疑似diffを git apply --cached したとき、実行可能な
  // 新規ファイル(シェルスクリプト等)の実行ビットが index 上で失われてしまう
  const fileMode = isExecutable ? '100755' : '100644'
  const header =
    `diff --git a/${filePath} b/${filePath}\n` +
    `new file mode ${fileMode}\n` +
    `--- /dev/null\n` +
    `+++ b/${filePath}\n`
  // 空ファイル(lines.length === 0)の場合、`@@ -0,0 +1,0 @@` という「0行追加」の
  // ハンクをボディ無しで送ると、git apply が不正なパッチ(corrupt patch)として
  // 拒否してしまう(実際に `git apply --cached` で再現確認済み)。空ファイルの
  // 新規作成はハンク自体を省略した diff で正しく表現できるため、ハンク行を含めない
  if (lines.length === 0) return header
  const hunkHeader = `@@ -0,0 +1,${lines.length} @@\n`
  const addedLines = lines.map((line) => `+${line}`).join('\n')
  if (endsWithNewline) return `${header}${hunkHeader}${addedLines}\n`
  // 改行が無いことを明示しないと、この疑似diffを git apply --cached したとき
  // index 側の blob に実ファイルには無い改行が混入し、working tree と乖離する
  return `${header}${hunkHeader}${addedLines}\n\\ No newline at end of file\n`
}

// git 自体が採用しているバイナリ判定と同じヒューリスティック: 先頭 8000 バイト以内に
// NUL バイトが含まれるかどうかで判定する(全文をスキャンしないのは巨大ファイルでの
// パフォーマンス劣化を避けるため)
const BINARY_DETECTION_SCAN_BYTES = 8000

export function isBinaryContent(buffer: Buffer): boolean {
  const scanLength = Math.min(buffer.length, BINARY_DETECTION_SCAN_BYTES)
  return buffer.subarray(0, scanLength).includes(0)
}

// NUL バイトを含まない非UTF-8テキスト(Shift_JIS 等)は isBinaryContent では
// バイナリと判定されないが、buffer.toString('utf-8') は不正なバイト列を
// 気づかず U+FFFD に置換してしまう。それを疑似diff化して git apply --cached すると、
// 元のバイト列と異なる(破損した)内容がそのままインデックスにステージされる。
// fatal: true により、デコードできないバイト列があれば null を返す。
// バリデーションのみ行い呼び出し元が buffer.toString('utf-8') で改めて
// デコードし直す設計だと、大きな未追跡ファイルで同じ内容を2回デコードする
// 無駄が生じるため、デコード結果自体を返して1回のデコードで済ませる。
// ignoreBOM: true を指定しないと、先頭の UTF-8 BOM がデフォルトで検出・除去
// されてしまう。BOM 付きファイルでこれを疑似diff化して git apply --cached すると、
// index 側の内容から BOM が失われ、BOM 付きのまま残る working tree の実ファイルと
// 食い違い、staging 後も diff が消えなくなる
export function decodeUtf8OrNull(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    return null
  }
}

// バイナリファイルは buildUntrackedDiff のような疑似テキストdiffを組み立てられない
// (UTF-8として読むとバイト列が破壊され、それを git apply --cached すると index に
// 破損した内容がステージされてしまう)。git 標準の "Binary files ... differ" 形式の
// メッセージのみを返す。このメッセージには @@ ハンクヘッダが無いため、
// DiffView 側でステージ可能なハンクとして扱われない(誤ってステージされるのを防ぐ)
export function buildBinaryDiffMessage(filePath: string): string {
  return `Binary files /dev/null and b/${filePath} differ\n`
}

// シンボリックリンクを readFile で読むとリンク先の実体の内容を読んでしまい、
// それを buildUntrackedDiff のような疑似テキストdiffにして git apply --cached すると、
// 実体の内容がコピーされた通常ファイルとしてステージされてしまう(シンボリックリンク
// としての git 上の表現(mode 120000、リンク先パスそのものが blob 内容)にならない)。
// 疑似diff を組み立てず、ステージできないことを明示する。このメッセージには
// @@ ハンクヘッダが無いため、buildBinaryDiffMessage と同様 DiffView 側で
// ステージ可能なハンクとして扱われない(誤ってステージされるのを防ぐ)
export function buildSymlinkDiffMessage(filePath: string): string {
  return `シンボリックリンクの差分表示・ステージには対応していません: ${filePath}\n`
}

// 巨大な未追跡ファイル(ビルド成果物等を .gitignore 設定前に誤って開いた場合)を
// 無条件に全文読み込んで疑似diff化すると、Electron のメインプロセス(全ウィンドウで
// 共有)でメモリ/CPU が同期的にスパイクし、アプリ全体がフリーズしてしまう。
// このメッセージには @@ ハンクヘッダが無いため、buildBinaryDiffMessage と同様
// DiffView 側でステージ可能なハンクとして扱われない
// 空ファイルはハンク(@@)を持てない(`@@ -0,0 +1,0 @@` という 0 行追加のハンクを
// ボディ無しで送ると git apply が corrupt patch として拒否する)。ハンクを省いた
// ヘッダのみの diff を返すこともできるが、DiffView はハンクが無い diff の
// ヘッダ行をそのまま画面に描画するため、"diff --git a/x b/x" などの内部表現が
// ユーザーに露出してしまう。バイナリ/シンボリックリンク/サイズ超過と同じく
// 1 行のメッセージにする(ファイル全体のステージは ChangesSection から可能)
export function buildEmptyFileDiffMessage(filePath: string): string {
  return `空のファイルのため表示する差分はありません: ${filePath}\n`
}

export function buildTooLargeDiffMessage(filePath: string): string {
  return `ファイルサイズが大きすぎるため差分を表示できません: ${filePath}\n`
}

// このメッセージには @@ ハンクヘッダが無いため、buildBinaryDiffMessage と同様
// DiffView 側でステージ可能なハンクとして扱われない。JSON.stringify で改行を
// \n として可視化する(生の改行のまま埋め込むと、このメッセージ自体も
// DiffView の1行ずつの描画で崩れて見える)
export function buildInvalidFileNameDiffMessage(filePath: string): string {
  return `ファイル名に改行を含むため差分を表示できません: ${JSON.stringify(filePath)}\n`
}
