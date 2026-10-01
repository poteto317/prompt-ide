interface Props {
  lines: string[]
  /** 各行の diff-view__line に追加するクラス(テキスト部分の diff-view__line--context など) */
  className?: string
}

// コンフリクトの解決ビューの行の並び。ConflictResolver(テキスト部分)と ConflictBlock(各側)で共有する。
// 行の key は並びの位置(同じ内容の行が並びうるため、内容は使わない)。
// 空行は空白 1 文字を描画する(中身の無い div は高さ 0 で消え、行の有無が見えなくなる)
export default function ConflictLines({ lines, className }: Props): React.JSX.Element {
  const lineClassName = className === undefined ? 'diff-view__line' : `diff-view__line ${className}`
  return (
    <>
      {lines.map((line, lineIndex) => (
        <div key={lineIndex} className={lineClassName}>
          {line === '' ? ' ' : line}
        </div>
      ))}
    </>
  )
}
