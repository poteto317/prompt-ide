interface Props {
  isExecuting: boolean
  result: string | null
  executionError: Error | null
  onClear: () => void
}

export default function OutputPanel({ isExecuting, result, executionError, onClear }: Props) {
  if (!isExecuting && result === null && executionError === null) {
    return null
  }

  return (
    <div className="output-panel">
      <div className="output-panel__header">
        <span className="output-panel__title">出力</span>
        {!isExecuting && (
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
      <div className="output-panel__content">
        {isExecuting && (
          <p className="output-panel__loading">実行中...</p>
        )}
        {!isExecuting && result !== null && (
          <pre className="output-panel__text">{result}</pre>
        )}
        {!isExecuting && executionError !== null && (
          <p className="output-panel__error">{executionError.message}</p>
        )}
      </div>
    </div>
  )
}
