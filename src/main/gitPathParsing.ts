// -z(NUL 区切り)で出力されたパスの一覧。ls-files -u の行は「mode sha stage<TAB>path」の
// 形式のため、withStageInfo のときは最初の TAB より後ろをパスとして取り出す
export function parseNulSeparatedPaths(output: string, withStageInfo = false): string[] {
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => (withStageInfo ? entry.slice(entry.indexOf('\t') + 1) : entry))
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

// git status --porcelain -z --untracked-files=all の出力から、作業ツリー側に変更がある
// (workingDir が ' ' 以外。コンフリクトも含む)か未追跡('??')のエントリのパスを、出力の順に返す。
// renderer の「変更」セクションの件数(isUnstagedFile)と定義を揃えること。
// リネーム・コピー(ステージ済み、または intent-to-add の ' R')は「XY 新\0旧\0」と元のパスが続くため、別のエントリとして
// 読まないよう読み飛ばす。ネストした git リポジトリは末尾が '/' で出るため削る
export function parseUnstagedStatusPaths(output: string): string[] {
  const tokens = output.split('\0')
  const paths: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.length < 4) continue
    const index = token[0]
    const workingDir = token[1]
    // ' R'(git add -N した新パスのリネーム)のように workingDir 側が R / C の場合も旧パスが続く
    if (index === 'R' || index === 'C' || workingDir === 'R' || workingDir === 'C') i++
    if (workingDir === ' ' && index !== '?') continue
    paths.push(token.slice(3).replace(/\/$/, ''))
  }
  return paths
}
