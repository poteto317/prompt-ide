import type { QuickOpenResult } from '../../lib/quickOpenSearch'
import { toHighlightSegments } from '../../lib/highlightSegments'

interface Props {
  /** aria-activedescendant から参照される DOM id */
  id: string
  result: QuickOpenResult
  isActive: boolean
  onSelect: () => void
  onHover: () => void
}

interface HighlightedTextProps {
  text: string
  indices: number[]
}

function HighlightedText({ text, indices }: HighlightedTextProps): React.JSX.Element {
  return (
    <>
      {toHighlightSegments(text, indices).map((segment, index) =>
        segment.matched ? (
          <mark key={index} className="quick-open__match">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  )
}

export default function QuickOpenItem({
  id,
  result,
  isActive,
  onSelect,
  onHover
}: Props): React.JSX.Element {
  return (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      className={`quick-open__item${isActive ? ' quick-open__item--active' : ''}`}
      onClick={onSelect}
      // mouseenter ではなく mousemove を使う。キーボードで選択を動かすと一覧が
      // スクロールし、静止したカーソルの下に別の項目が入って mouseenter が発火するため、
      // 実際にマウスを動かしたときだけ選択を追従させる
      onMouseMove={onHover}
    >
      <span className="quick-open__name">
        <HighlightedText text={result.node.name} indices={result.nameIndices} />
      </span>
      {result.directory.length > 0 && (
        <span className="quick-open__directory" data-testid="quick-open-directory">
          <HighlightedText text={result.directory} indices={result.directoryIndices} />
        </span>
      )}
    </div>
  )
}
