'use client'
import type { GitFileStatus } from '@shared/types'
import { splitFilePath } from '../../lib/filePathParts'
import { getGitStatusTone } from '../../lib/gitUtils'

interface Props {
  file: GitFileStatus
  /** 状態の文字。どの列(index / workingDir)を出すかはセクションごとに違うため、呼び出し元が決める */
  statusLetter: string
  /** 差分を開くボタンの aria-label */
  openLabel: string
  onOpenDiff: () => void
  /** 操作のボタン。行の hover と :focus-within のときだけ見える(main.css) */
  children?: React.ReactNode
}

// 「変更」「ステージされている変更」の 1 行(ファイル名・薄い色のフォルダ・操作のボタン・状態の文字)。
// button の入れ子はできないため、差分を開くボタンと操作の枠を兄弟として並べ、行の全体を押せる範囲は
// ボタンの ::after を li へ広げて作る(main.css)
export default function GitFileRow({
  file,
  statusLetter,
  openLabel,
  onOpenDiff,
  children
}: Props): React.JSX.Element {
  const { name, dir } = splitFilePath(file.path)
  const tone = getGitStatusTone(file, statusLetter)
  return (
    <li className="source-control-panel__file-item">
      <button
        type="button"
        className="source-control-panel__file-open"
        title={file.path}
        aria-label={openLabel}
        onClick={onOpenDiff}
      >
        <span className="source-control-panel__file-label">
          <span>{name}</span>
          {dir !== '' && <span className="source-control-panel__file-dir">{dir}</span>}
        </span>
      </button>
      <div className="source-control-panel__file-actions">{children}</div>
      <span
        className={`source-control-panel__file-state source-control-panel__file-state--${tone}`}
      >
        {statusLetter}
      </span>
    </li>
  )
}
