// -z(NUL 区切り)で出力されたパスの一覧。ls-files -u の行は「mode sha stage<TAB>path」の
// 形式のため、withStageInfo のときは最初の TAB より後ろをパスとして取り出す
export function parseNulSeparatedPaths(output: string, withStageInfo = false): string[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => (withStageInfo ? entry.slice(entry.indexOf('\t') + 1) : entry))
}

// git の出力の末尾の改行だけを除く(rev-parse --show-toplevel・--git-path のパスなど)。パスの末尾・先頭の空白は意味を持つため
// trim しない
export function stripTrailingNewline(output: string): string {
  return output.replace(/\r?\n$/, '')
}

// pathspec のグロブ展開を止めて、パスを文字列そのものとして扱わせる。
// git は `--` の後ろでも [ ] * ? を pathspec magic として解釈するため
// (`--` はオプション解析を止めるだけ)、"a[1].txt" を指定すると別ファイルの
// "a1.txt" が対象になる。diff なら別ファイルの差分が表示され、
// add/reset ならユーザーが選んでいないファイルがステージ/アンステージされる
// (いずれも実機で再現確認済み)
export function toLiteralPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

export interface UnstagedStatusEntry {
  /** 実行に使うパス(ネストした git リポジトリの末尾 '/' を削った値) */
  path: string
  /** porcelain の生のパス(末尾 '/' も空白もそのまま)。確認時の一覧との照合に使う */
  rawPath: string
  /** index + workingDir の 2 文字 */
  status: string
}

// git status --porcelain -z --untracked-files=all の出力から、作業ツリー側に変更がある
// (workingDir が ' ' 以外。コンフリクトも含む)か未追跡('??')のエントリを、出力の順に返す。
// renderer の「変更」セクションの件数(isUnstagedFile)と定義を揃えること。
// リネーム・コピー(ステージ済み、または intent-to-add の ' R')は「XY 新\0旧\0」と元のパスが続くため、別のエントリとして
// 読まないよう読み飛ばす。ネストした git リポジトリは末尾が '/' で出るため path からは削る
export function parseUnstagedStatusEntries(output: string): UnstagedStatusEntry[] {
  const tokens = output.split('\0')
  const entries: UnstagedStatusEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    const index = token[0]
    const workingDir = token[1]
    // ' R'(git add -N した新パスのリネーム)のように workingDir 側が R / C の場合も旧パスが続く
    if (index === 'R' || index === 'C' || workingDir === 'R' || workingDir === 'C') i++
    if (workingDir === ' ' && index !== '?') continue
    const rawPath = token.slice(3)
    entries.push({ path: rawPath.replace(/\/$/, ''), rawPath, status: index + workingDir })
  }
  return entries
}

export function parseUnstagedStatusPaths(output: string): string[] {
  return parseUnstagedStatusEntries(output).map((entry) => entry.path)
}
