export interface ParsedHunk {
  header: string
  lines: string[]
}

export interface ParsedDiff {
  headerLines: string[]
  hunks: ParsedHunk[]
}

export function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n')
  // 末尾の空行は split の仕様上の余分な要素なので取り除く
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const headerLines: string[] = []
  const hunks: ParsedHunk[] = []
  let currentHunk: ParsedHunk | null = null

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

  return { headerLines, hunks }
}

export function buildHunkPatch(parsed: ParsedDiff, hunkIndex: number): string {
  const hunk = parsed.hunks[hunkIndex]
  const lines = [...parsed.headerLines, hunk.header, ...hunk.lines]
  return lines.join('\n') + '\n'
}
