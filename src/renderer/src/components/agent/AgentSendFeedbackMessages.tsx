'use client'
import type { AgentSendFeedback } from '../../types'

interface Props {
  /** エージェント CLI 方式の送信の失敗と成功の通知(useAgentWorkspace の送信の結果。プロンプトのパネルと履歴のパネルで同じものを使う) */
  feedback: AgentSendFeedback
}

/**
 * 送信の失敗と成功の通知の、見える文字だけ。読み上げは Sidebar の常設の AgentSendFeedbackAnnouncer が担うため、ここは role を持たず
 * aria-hidden にする(パネルの切り替えでマウントし直しても、古い失敗を読み直さない・二重に読まれない)。サイドバーでは見えているパネルの
 * 1 か所だけに置く(Sidebar が見えていないパネルへ null を渡す)
 */
export default function AgentSendFeedbackMessages({ feedback }: Props): React.JSX.Element {
  return (
    <>
      {feedback.error !== null && (
        <p className="agent-send-feedback__error" aria-hidden="true">
          {feedback.error}
        </p>
      )}
      <p className="agent-send-feedback__notice" aria-hidden="true">
        {feedback.notice?.text ?? ''}
      </p>
    </>
  )
}
