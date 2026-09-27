export interface ParsedHunk {
  header: string
  lines: string[]
}

export interface ParsedDiff {
  headerLines: string[]
  hunks: ParsedHunk[]
  /** 未解決コンフリクト(UU)のファイルで git が返す combined diff かどうか。
   *  combined diff は `git apply --cached` が必ず "No valid patches in input" で
   *  失敗する(実機で再現確認済み)ため、ハンク操作を出してはいけない。
   *  ステータス列も 2 桁になるため、通常 diff 前提の行の色分けも当てにならない */
  isCombined: boolean
}

export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n')
  // 末尾の空行は split の仕様上の余分な要素なので取り除く
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const headerLines: string[] = []
  const hunks: ParsedHunk[] = []
  let currentHunk: ParsedHunk | null = null
  // combined diff は "diff --cc <path>"(マージ元が2つなら --cc、3つ以上なら
  // --combined)で始まり、ハンクヘッダも @@ の数が親の数+1 になる
  const isCombined = lines.some(
    (line) => line.startsWith('diff --cc ') || line.startsWith('diff --combined ')
  )

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (currentHunk !== null) hunks.push(currentHunk)
      currentHunk = { header: line, lines: [] }
    } else if (currentHunk !== null) {
      currentHunk.lines.push(line)
    } else {
      headerLines.push(line)
    }
  }
  if (currentHunk !== null) hunks.push(currentHunk)

  return { headerLines, hunks, isCombined }
}

// rename from/rename to/similarity index/dissimilarity index ヘッダーを含めた
// まま1ハンクだけのパッチを組み立てて git apply --cached --reverse に渡すと、
// そのハンクの内容変更だけでなくリネーム自体まで取り消されてしまう
// (実機で再現確認済み: リネーム後に2箇所編集してステージし、1ハンクだけ
// アンステージすると RM old.txt -> new.txt であるべきところが
// MD old.txt / ?? new.txt という壊れた状態になる)。
// 新パスに対する自己diff(a/newpath b/newpath、rename ヘッダー無し)に書き換える
// ことで、リネーム自体は維持したまま該当ハンクの内容変更だけを取り消せる
// (実機で正しく動作することを確認済み)
function isRenameMetadataHeader(line: string): boolean {
  return (
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('dissimilarity index ')
  )
}

// "+++ " の後ろのトークンは通常 `b/path` だが、パスが literal な " や \ を
// 含む場合、core.quotePath=false(gitService.ts)を設定していても git は
// 常にそのパスをダブルクォートで囲み C 形式でエスケープする
// (実機で再現確認済み: `diff --git "a/file\"quote.txt" "b/file\"quote.txt"`)。
// クォート・エスケープの中身をデコードして再構築すると、エスケープの解釈を
// 誤ったときにパッチが壊れる。ここでは中身を一切解釈せず、git が出力した
// 表記(クォートされていればクォートごと)に対して先頭の "b/"/`"b/` を
// "a/"/`"a/` に置き換えるだけにする
function toAPathToken(bPathToken: string): string {
  if (bPathToken.startsWith('"b/')) return `"a/${bPathToken.slice('"b/'.length)}`
  if (bPathToken.startsWith('b/')) return `a/${bPathToken.slice('b/'.length)}`
  return bPathToken
}

function toSelfDiffHeaderLines(headerLines: string[]): string[] {
  const newPathLine = headerLines.find((line) => line.startsWith('+++ '))
  if (newPathLine === undefined) return headerLines
  const bPathToken = newPathLine.slice('+++ '.length)
  const aPathToken = toAPathToken(bPathToken)
  return headerLines
    .filter((line) => !isRenameMetadataHeader(line))
    .map((line) => {
      if (line.startsWith('diff --git ')) return `diff --git ${aPathToken} ${bPathToken}`
      if (line.startsWith('--- ')) return `--- ${aPathToken}`
      return line
    })
}

export function buildHunkPatch(parsed: ParsedDiff, hunkIndex: number): string {
  const hunk = parsed.hunks[hunkIndex]
  const isRename = parsed.headerLines.some((line) => line.startsWith('rename from '))
  const headerLines = isRename ? toSelfDiffHeaderLines(parsed.headerLines) : parsed.headerLines
  const lines = [...headerLines, hunk.header, ...hunk.lines]
  return lines.join('\n') + '\n'
}
