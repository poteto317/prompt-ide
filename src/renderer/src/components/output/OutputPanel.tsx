import { useEffect, useId, useRef } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import ApplyButtons from './ApplyButtons'
import { toAnnouncementText } from '../../lib/announcementText'
import { getShownDisabledReason } from '../../lib/applyDisabledReason'
import type { ApplyOutputState } from '../../types'
import type { ApplyActions } from './ApplyButtons'

interface Props {
  isExecuting: boolean
  result: string | null
  streamingText: string
  executionError: Error | null
  onClear: () => void
  onCancel: () => void
  /** エディタへの反映(EditorPanel の useApplyOutputToEditor)。渡されたときだけ反映のボタンと通知を出す */
  applyOutput?: ApplyOutputState
}

export default function OutputPanel({
  isExecuting,
  result,
  streamingText,
  executionError,
  onClear,
  onCancel,
  applyOutput
}: Props): React.JSX.Element | null {
  const contentRef = useRef<HTMLDivElement>(null)
  const reasonId = useId()

  // 逐次出力に追従して自動スクロールする(実行中のみ)
  useEffect(() => {
    if (isExecuting && contentRef.current !== null) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [isExecuting, streamingText])

  if (!isExecuting && result === null && executionError === null) {
    return null
  }

  // 反映できるのは、実行が終わって Markdown として表示している結果だけ(実行中は逐次出力を等幅で出すだけ)。
  // 空の結果は反映しても何も変わらないため、ボタンを出さない
  const canShowApply = applyOutput !== undefined && !isExecuting && result !== null && result !== ''
  // 無効の理由は 1 か所に表示し、無効なボタンの aria-describedby から参照する
  const reason = canShowApply ? getShownDisabledReason(applyOutput) : null
  // ヘッダーとコードブロックの「挿入」「置換」が共有する、反映の可否と操作
  const applyActions: ApplyActions | undefined = canShowApply
    ? {
        insertDisabledReason: applyOutput.insertDisabledReason,
        replaceDisabledReason: applyOutput.replaceDisabledReason,
        apply: applyOutput.apply,
        reasonId
      }
    : undefined

  return (
    <div className="output-panel">
      <div className="output-panel__header">
        <span className="output-panel__title">出力</span>
        {applyOutput !== undefined && (
          <span className="output-panel__notice" role="status">
            {/* 同じ文言が続いても読み上げが再実行されるよう、文字列を変える */}
            {toAnnouncementText(applyOutput.notice)}
          </span>
        )}
        <span className="output-panel__actions">
          {reason !== null && (
            <span id={reasonId} className="output-panel__apply-reason">
              {reason}
            </span>
          )}
          {applyActions !== undefined && result !== null && (
            <ApplyButtons
              {...applyActions}
              text={result}
              insertHint="出力全体をカーソル位置へ"
              replaceHint="選択範囲を出力全体で"
              className="output-panel__apply-btn"
            />
          )}
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
        </span>
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
        {!isExecuting && result !== null && (
          <MarkdownRenderer content={result} codeBlockActions={applyActions} />
        )}
        {!isExecuting && executionError !== null && (
          <p className="output-panel__error">{executionError.message}</p>
        )}
      </div>
    </div>
  )
}
