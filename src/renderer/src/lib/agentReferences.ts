import { isPathInside, normalizePathSeparators, stripTrailingSeparators } from './pathUtils'

// エージェントへ送るプロンプトに添える参照(claude の `@相対パス`)の組み立て(設計書「参照の書式」)。純粋な関数だけを置く

/** エディタの選択の範囲(Monaco の Selection・IRange はこの形を満たす。開始は終わりより前) */
export interface LineSelection {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** 参照に出す行の範囲(1 始まり。endLine は終わりが列 1 の補正を済ませた値) */
export interface LineSpan {
  startLine: number
  endLine: number
}

/**
 * アクティブなエディタの空でない選択の行の範囲と、そのエディタのファイル(useEditorSelectionRange が追い、参照の候補の解決に使う)。
 * 列は持たない(チップの表示 `#L10-20` を決める値だけを持ち、行の中で列が変わっても値を作り直さない)
 */
export interface EditorLineSelection extends LineSpan {
  /** マウントの時点の openFile.path(エディタはファイルごとに付け替わる。EditorPanel の key) */
  filePath: string
}

/** 1 つの参照。path は開いているフォルダからの相対パス('/' 区切り)、lineRange は `#L10-20` のような行の範囲(ファイル全体なら null) */
export interface AgentReference {
  path: string
  lineRange: string | null
}

/**
 * 送る参照の一覧の入力の 1 件。path は表示・本文に出す相対パス、key は同じファイルかを比べるためのキー
 * (絶対パスを toComparablePath で正規化した値。Windows の大文字小文字・区切りの違いを吸収する)。
 * 相対パスは各入口の絶対パスの表記を引き継ぐため、文字列のままでは同じファイルでもまとまらない
 */
export interface AgentReferenceSource {
  path: string
  key: string
}

/** 比べるためのキー付きの参照(選択範囲) */
export type KeyedAgentReference = AgentReference & { key: string }

export interface AgentReferenceListInput {
  /** オンにした開いているファイル。無ければ null */
  openFile: AgentReferenceSource | null
  /** オンにした選択範囲。無ければ null */
  selection: KeyedAgentReference | null
  /** エクスプローラから足したファイル(足した順) */
  added: readonly AgentReferenceSource[]
}

/** 参照の一覧の見出しの行 */
const AGENT_REFERENCES_HEADING = '参照:'

/**
 * 開いているフォルダからの相対パス('/' 区切り)。フォルダの外・フォルダそのものなら null。
 * フォルダの中かは区切り・末尾の区切り・(Windows の)大文字小文字を吸収して判定する(isPathInside)。POSIX のルート('/')を
 * 開いたときは isPathInside が false を返すため参照にできない(既知の制約)
 */
export function toWorkspaceRelativePath(folderPath: string, filePath: string): string | null {
  if (!isPathInside(filePath, folderPath)) return null
  // 区切りの統一は Windows のパスだけ(POSIX のファイル名の '\\' は変えない)。表記が違っても長さは同じなので、
  // 正規化したフォルダの長さの位置で切り出せる(quickOpenSearch の toRelativePath と同じ)
  const normalizedFile = normalizePathSeparators(filePath)
  const normalizedFolder = stripTrailingSeparators(normalizePathSeparators(folderPath))
  return normalizedFile.slice(normalizedFolder.length + 1)
}

/** 選択の行の範囲。終わりが行頭(列 1)で開始行より後なら、その行は含めない(行を丸ごと選んだときの見た目に合わせる) */
export function toLineSpan(selection: LineSelection): LineSpan {
  const startLine = selection.startLineNumber
  const endLine =
    selection.endColumn === 1 && selection.endLineNumber > startLine
      ? selection.endLineNumber - 1
      : selection.endLineNumber
  return { startLine, endLine }
}

/** 行の範囲の表記(`#L10-20`、1 行なら `#L10`)。Claude Code の IDE 連携が選択範囲の参照に使う書式に合わせる */
export function formatLineSpan({ startLine, endLine }: LineSpan): string {
  return startLine === endLine ? `#L${startLine}` : `#L${startLine}-${endLine}`
}

/** `@src/app.ts`・`@src/app.ts#L10-20`(パスと行の範囲の間に空白を入れない。claude は空白までをパスとみなす) */
export function formatAgentReference(reference: AgentReference): string {
  return `@${reference.path}${reference.lineRange ?? ''}`
}

/**
 * 送る参照の一覧。並びは開いているファイル → 選択範囲 → エクスプローラから足した順。同じ参照(キーと行の範囲が同じ)は
 * 1 回にまとめ、先に出た表記を使う
 */
export function buildAgentReferenceList({
  openFile,
  selection,
  added
}: AgentReferenceListInput): AgentReference[] {
  const pushed: KeyedAgentReference[] = []
  const push = (reference: KeyedAgentReference): void => {
    if (pushed.some((r) => r.key === reference.key && r.lineRange === reference.lineRange)) {
      return
    }
    pushed.push(reference)
  }
  const wholeFile = (source: AgentReferenceSource): KeyedAgentReference => ({
    path: source.path,
    lineRange: null,
    key: source.key
  })
  if (openFile !== null) push(wholeFile(openFile))
  if (selection !== null) {
    // 同じファイルの全体の参照(エクスプローラから足したもの)があれば、選択範囲より先に出す(ファイル全体を先に)
    const sameFile = added.find((source) => source.key === selection.key)
    if (selection.lineRange !== null && sameFile !== undefined) push(wholeFile(sameFile))
    push(selection)
  }
  for (const source of added) push(wholeFile(source))
  return pushed.map(({ path, lineRange }) => ({ path, lineRange }))
}

/** 本文の末尾に、空行を 1 つ挟んで参照の一覧を足す。参照が無ければ本文のまま */
export function appendAgentReferences(text: string, references: readonly AgentReference[]): string {
  if (references.length === 0) return text
  const block = [
    AGENT_REFERENCES_HEADING,
    ...references.map((reference) => `- ${formatAgentReference(reference)}`)
  ].join('\n')
  // 末尾が改行の本文でも空行が 2 つ以上にならないよう、末尾の改行を落としてから挟む。本文が空なら一覧だけ
  const body = text.replace(/[\r\n]+$/, '')
  return body === '' ? block : `${body}\n\n${block}`
}
