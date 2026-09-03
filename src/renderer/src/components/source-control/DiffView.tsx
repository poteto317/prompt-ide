import { parseDiff, buildHunkPatch } from '../../lib/diffParser'

interface Props {
  diffText: string
  staged: boolean
  onStageHunk: (patch: string) => void
  onUnstageHunk: (patch: string) => void
}

function lineClassName(line: string): string {
  if (line.startsWith('+')) return 'diff-view__line diff-view__line--added'
  if (line.startsWith('-')) return 'diff-view__line diff-view__line--removed'
  return 'diff-view__line diff-view__line--context'
}

export default function DiffView({
  diffText,
  staged,
  onStageHunk,
  onUnstageHunk
}: Props): React.JSX.Element {
  const parsed = parseDiff(diffText)
  const buttonLabel = staged ? 'このハンクをアンステージ' : 'このハンクをステージ'

  return (
    <div className="diff-view">
      {parsed.hunks.map((hunk, index) => (
        <div key={`${hunk.header}-${index}`} className="diff-view__hunk">
          <div className="diff-view__hunk-header">
            <span className="diff-view__hunk-header-text">{hunk.header}</span>
            <button
              type="button"
              className="diff-view__hunk-action-btn"
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
          </div>
          {hunk.lines.map((line, lineIndex) => (
            <div key={lineIndex} className={lineClassName(line)}>
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
