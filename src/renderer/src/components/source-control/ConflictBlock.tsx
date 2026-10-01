import type { ConflictChoice, ConflictSegment } from '@shared/types'
import { CHOICE_TARGET } from '../../lib/conflictChoice'
import ConflictLines from './ConflictLines'

type ConflictBlockSegment = Extract<ConflictSegment, { kind: 'conflict' }>

interface Props {
  /** 0 始まりのブロック番号(表示と aria-label は 1 始まり) */
  index: number
  segment: ConflictBlockSegment
  disabled: boolean
  onChoose: (choice: ConflictChoice) => void
}

const CHOICE_BUTTONS: { choice: ConflictChoice; label: string }[] = [
  { choice: 'ours', label: '自分を採用' },
  { choice: 'theirs', label: '相手を採用' },
  { choice: 'both', label: '両方' }
]

// 片側の行。行が無い側は「（空）」を出す(行の描画は ConflictLines)
function Side({
  title,
  lines,
  modifier
}: {
  title: string
  lines: string[]
  modifier: string
}): React.JSX.Element {
  return (
    <div className={`conflict-block__side conflict-block__side--${modifier}`}>
      <div className="conflict-block__side-title">{title}</div>
      {lines.length === 0 ? (
        <div className="diff-view__line conflict-block__empty">（空）</div>
      ) : (
        <ConflictLines lines={lines} />
      )}
    </div>
  )
}

// コンフリクトのブロック 1 つ(自分側・相手側・あれば base と、3 つの選択ボタン)。
// 解決の実行・排他は呼び出し元の責務で、実行中は disabled を受け取る
export default function ConflictBlock({
  index,
  segment,
  disabled,
  onChoose
}: Props): React.JSX.Element {
  const number = index + 1
  return (
    <div className="conflict-block">
      <div className="conflict-block__header">
        <span className="conflict-block__title">ブロック {number}</span>
        <span className="conflict-block__actions">
          {CHOICE_BUTTONS.map(({ choice, label }) => (
            <button
              key={choice}
              type="button"
              className="conflict-block__button"
              aria-label={`ブロック ${number} を${CHOICE_TARGET[choice]}する`}
              disabled={disabled}
              onClick={() => onChoose(choice)}
            >
              {label}
            </button>
          ))}
        </span>
      </div>
      <Side title={`自分（${segment.oursLabel}）`} lines={segment.ours} modifier="ours" />
      {segment.base !== undefined && (
        <Side
          title={
            segment.baseLabel !== undefined && segment.baseLabel !== ''
              ? `共通の祖先（${segment.baseLabel}）`
              : '共通の祖先'
          }
          lines={segment.base}
          modifier="base"
        />
      )}
      <Side title={`相手（${segment.theirsLabel}）`} lines={segment.theirs} modifier="theirs" />
    </div>
  )
}
