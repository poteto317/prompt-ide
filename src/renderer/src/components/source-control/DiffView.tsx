import { useMemo } from 'react'
import { parseDiff, buildHunkPatch } from '../../lib/diffParser'

interface Props {
  diffText: string
  staged: boolean
  onStageHunk: (patch: string) => void
  onUnstageHunk: (patch: string) => void
  /** true の間はハンク操作ボタンを無効化する(実行中の多重クリック防止) */
  disabled?: boolean
  /** 未追跡ファイルの diff か。useDiffOperations.ts の stageHunk は
   *  isActiveFileUntracked のとき patch の内容を使わず gitApi.stageFile(path) で
   *  ファイル全体を git add するだけなので、表示の打ち切り(見えていない行が
   *  パッチに混入する懸念)がそもそも当てはまらない */
  isUntracked?: boolean
  /** ハンクの取り消し(確認・実行は呼び出し元)。未ステージの diff でだけ使う */
  onDiscardHunk?: (patch: string, hunkHeader: string) => void
  /** 開いている diff が「取り消せるハンク操作の対象」か(追跡済みの変更ファイルで、
   *  未追跡・intent-to-add・コンフリクトでない)。判定は useDiffOperations が行う */
  canDiscardHunk?: boolean
}

// 描画する diff 行数の上限。main 側のサイズ上限
// (gitService.ts の MAX_UNTRACKED_DIFF_FILE_SIZE_BYTES)は「メインプロセスの
// メモリ/CPU スパイクを防ぐ」ためのもので、レンダラー側には上限が無かった。
// .gitignore 設定前の生成物(整形済み JSON 等)を diff タブで開くと、疑似diff は
// 全行が 1 ハンクのため数万個の DOM ノードが一度に生成され、ウィンドウが
// 数秒ハングする。1 画面に収まる量をはるかに超えた時点で打ち切る
const MAX_RENDERED_DIFF_LINES = 2000

// git diff の配管出力(ヘッダ)のうち、ユーザーに意味がある行だけ残す。
// 追跡済みバイナリファイルの diff は
//   diff --git a/f.bin b/f.bin
//   index 742c16a..19bbd83 100644
//   Binary files a/f.bin and b/f.bin differ
// の 3 行で、ハンク(@@)が無いため全行が headerLines に入る。そのまま出すと
// 内部表現が露出するため、"Binary files ... differ" のような説明行だけを見せる。
// 未追跡ファイルは main 側(buildBinaryDiffMessage 等)が既に 1 行のメッセージへ
// 置き換えており、その形式に揃える。
// ただし "old mode 100644" / "new mode 100755" は除外しない。chmod +x だけを
// 行ったファイルの diff はこの 2 行とヘッダのみでハンクを持たないため、
// 除外すると「差分はありません」と表示され、Changes 一覧には " M" で出ている
// のに何が変わったのか分からなくなる(実行権限の変更はユーザーに意味のある情報)
function isInternalDiffHeader(line: string): boolean {
  return (
    line.startsWith('diff --git ') ||
    // マージコンフリクトの combined diff ヘッダー(diff --cc / diff --combined)。
    // バイナリファイルのコンフリクトはハンクを持たず isCombined によるボタン
    // 抑止だけでは足りないため、ヘッダーとしても除外する必要がある
    // (実機で "diff --cc f.bin" がそのまま表示されることを確認済み)
    line.startsWith('diff --cc ') ||
    line.startsWith('diff --combined ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ')
    // "similarity index"/"rename from"/"rename to" は除外しない。内容変更を
    // 伴わないリネームだけの diff はこの3行(+ diff --git)のみでハンクを
    // 持たないため、除外すると「差分はありません」と表示され、実際には
    // リネームという変更があるのに何も変わっていないように見えてしまう
    // (mode 行を除外しない理由と同じ)
  )
}

// combined diff(親が2つ以上のマージコンフリクト)は、ハンクヘッダの "@" の数
// (親の数+1個)と同じ文字数のプレフィックスを各行に持つ。diff --cc(2親)の
// ハンクヘッダ "@@@ ... @@@" は "@" が3つ、プレフィックス長は親の数(2)になる。
// 通常diffのハンクヘッダ "@@ ... @@" は "@" が2つ、プレフィックス長は1
function hunkLinePrefixLength(hunkHeader: string): number {
  const match = /^@+/.exec(hunkHeader)
  return match === null ? 1 : match[0].length - 1
}

// line.startsWith('+')/('-') という1文字判定のままだと、combined diff で
// 2文字目以降に +/- が来る行(片方の親に対してのみ追加/削除された行)が
// 「変更なし」のコンテキスト行として灰色表示されてしまう。プレフィックス
// 全体に - があれば削除、無く + があれば追加とする(両方の親から見て削除
// された行は "--" のように - が複数並ぶが、1文字でも - があれば削除として
// 扱う。git 自身も combined diff の削除行をこの基準で表示する)
function lineClassName(line: string, prefixLength: number): string {
  const prefix = line.slice(0, prefixLength)
  if (prefix.includes('-')) return 'diff-view__line diff-view__line--removed'
  if (prefix.includes('+')) return 'diff-view__line diff-view__line--added'
  return 'diff-view__line diff-view__line--context'
}

export default function DiffView({
  diffText,
  staged,
  onStageHunk,
  onUnstageHunk,
  disabled = false,
  isUntracked = false,
  onDiscardHunk,
  canDiscardHunk = false
}: Props): React.JSX.Element {
  // disabled(実行中フラグ)の切り替えだけでも再レンダーされるため、diffText 自体が
  // 変わっていないときに毎回パースし直さないよう memo 化する
  const parsed = useMemo(() => parseDiff(diffText), [diffText])
  // ハンクが無い diff(バイナリ等)で表示する説明行。配管出力は取り除く
  const visibleHeaderLines = useMemo(
    () => parsed.headerLines.filter((line) => !isInternalDiffHeader(line)),
    [parsed]
  )
  const buttonLabel = staged ? 'このハンクをアンステージ' : 'このハンクをステージ'
  // 打ち切る場合でも「どこまで表示したか」が分かるよう、先頭から順に上限まで
  // 詰めた「各ハンクの表示行」を先に確定させる。レンダー中に変数を書き換えると
  // 再実行(StrictMode の二重呼び出し等)で結果が変わるため、useMemo 内で
  // 閉じた計算にする。ハンク単位のステージ操作は表示の有無と無関係に
  // parsed(全量)から組み立てるため、打ち切っても誤ったパッチにはならない
  const { totalLineCount, visibleLinesByHunk } = useMemo(
    () =>
      parsed.hunks.reduce<{ totalLineCount: number; visibleLinesByHunk: string[][] }>(
        (acc, hunk) => {
          const remaining = Math.max(MAX_RENDERED_DIFF_LINES - acc.totalLineCount, 0)
          return {
            totalLineCount: acc.totalLineCount + hunk.lines.length,
            visibleLinesByHunk: [...acc.visibleLinesByHunk, hunk.lines.slice(0, remaining)]
          }
        },
        { totalLineCount: 0, visibleLinesByHunk: [] }
      ),
    [parsed]
  )
  const isTruncated = totalLineCount > MAX_RENDERED_DIFF_LINES

  return (
    <div className="diff-view">
      {/* 未解決コンフリクトの combined diff は git apply --cached が必ず
          "No valid patches in input" で失敗するため、ハンク操作を出さない。
          なぜ操作できないのかが分かるよう理由を添える */}
      {parsed.isCombined && (
        <p className="diff-view__notice">
          コンフリクトが未解決のため、ハンク単位のステージ/アンステージはできません。
          エディタで解決してからステージしてください
        </p>
      )}
      {/* ハンク(@@行)が無い diff(バイナリファイルの "Binary files ... differ" 等)は、
          headerLines のみにテキストが入る。ここで表示しないと、理由が
          ユーザーに伝わらないまま空白の diff 表示になってしまう。
          「差分はありません」はハンクも headerLines も無いときだけ出す。
          mode 変更(old mode/new mode)は内容の変更と同時に行われることもあり、
          その場合ハンクと headerLines の両方を持つ。表示条件を「ハンクが
          無いとき」に限定すると、ハンクが存在するこのケースで mode 変更の
          情報が一切見えなくなってしまう */}
      {parsed.hunks.length === 0 && visibleHeaderLines.length === 0 && (
        // 未追跡ファイルの全ハンクをステージし終えた場合等、diffText 自体が
        // 空文字列になることがある。何も表示しないと空白のまま残ってしまう
        <p className="diff-view__empty">差分はありません</p>
      )}
      {visibleHeaderLines.map((line, index) => (
        <div key={index} className="diff-view__header-line">
          {line}
        </div>
      ))}
      {parsed.hunks.map((hunk, index) => {
        const prefixLength = hunkLinePrefixLength(hunk.header)
        // ステージ / アンステージと取り消しのボタンが共有する表示条件
        const canOperateHunk =
          !parsed.isCombined &&
          (isUntracked || !(isTruncated && visibleLinesByHunk[index].length < hunk.lines.length))
        return (
          <div key={`${hunk.header}-${index}`} className="diff-view__hunk">
            <div className="diff-view__hunk-header">
              <span className="diff-view__hunk-header-text">{hunk.header}</span>
              {/* 一部でも打ち切られたハンクは操作させない。「表示行数が 0」だけを
                条件にすると、2500 行中 2000 行(上限)だけ表示されている場合は
                表示行数が 0 でないためボタンが有効なままになってしまう。
                ボタンは打ち切り前の全量(parsed)からパッチを作るため、押すと
                ユーザーが一度も見ていない残り 500 行までそのまま index に入る。
                「表示行数 < 実際の行数」で一部打ち切りも含めて判定する。
                ただし isUntracked の場合、ボタンは patch を使わず
                gitApi.stageFile(path) でファイル全体を git add するだけなので、
                この懸念は当てはまらない(打ち切っていても隠さない) */}
              {canOperateHunk && (
                <span className="diff-view__hunk-actions">
                  <button
                    type="button"
                    className="diff-view__hunk-action-btn"
                    disabled={disabled}
                    onClick={() => {
                      const patch = buildHunkPatch(parsed, index)
                      if (staged) {
                        onUnstageHunk(patch)
                      } else {
                        onStageHunk(patch)
                      }
                    }}
                  >
                    {buttonLabel}
                  </button>
                  {canDiscardHunk && !staged && onDiscardHunk !== undefined && (
                    <button
                      type="button"
                      className="diff-view__hunk-action-btn diff-view__hunk-action-btn--danger"
                      aria-label="このハンクを取り消す"
                      disabled={disabled}
                      onClick={() => onDiscardHunk(buildHunkPatch(parsed, index), hunk.header)}
                    >
                      このハンクを取り消す
                    </button>
                  )}
                </span>
              )}
            </div>
            {(isTruncated ? visibleLinesByHunk[index] : hunk.lines).map((line, lineIndex) => (
              <div key={lineIndex} className={lineClassName(line, prefixLength)}>
                {line}
              </div>
            ))}
          </div>
        )
      })}
      {isTruncated && (
        <p className="diff-view__truncated">
          差分が大きすぎるため、先頭 {MAX_RENDERED_DIFF_LINES} 行のみ表示しています(全{' '}
          {totalLineCount} 行)。以降は省略されました
        </p>
      )}
    </div>
  )
}
