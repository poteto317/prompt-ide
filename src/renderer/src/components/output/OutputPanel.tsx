import { useEffect, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'

interface Props {
  isExecuting: boolean
  result: string | null
  streamingText: string
  executionError: Error | null
  onClear: () => void
  onCancel: () => void
}

export default function OutputPanel({
  isExecuting,
  result,
  streamingText,
  executionError,
  onClear,
  onCancel
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)

  // 逐次出力に追従して自動スクロールする(実行中のみ)
  useEffect(() => {
    if (isExecuting && contentRef.current !== null) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [isExecuting, streamingText])

  if (!isExecuting && result === null && executionError === null) {
    return null
  }

  return (
    <div className="output-panel">
      <div className="output-panel__header">
        <span className="output-panel__title">出力</span>
        {isExecuting ? (
          <button
            type="button"
            className="output-panel__cancel-btn"
            onClick={onCancel}
            aria-label="実行をキャンセル"
          >
            キャンセル
          </button>
        ) : (
          <button
            type="button"
            className="output-panel__clear-btn"
            onClick={onClear}
            aria-label="出力をクリア"
          >
            クリア
          </button>
        )}
      </div>
      <div className="output-panel__content" ref={contentRef}>
        {isExecuting &&
          (streamingText.length === 0 ? (
            <p className="output-panel__loading">実行中...</p>
          ) : (
            // ストリーミング中は閉じていないコードフェンス等で表示が暴れるため
            // Markdown レンダリングせず等幅テキストで逐次表示する
            <pre className="output-panel__streaming">{streamingText}</pre>
          ))}
        {!isExecuting && result !== null && <MarkdownRenderer content={result} />}
        {!isExecuting && executionError !== null && (
          <p className="output-panel__error">{executionError.message}</p>
        )}
      </div>
    </div>
  )
}
