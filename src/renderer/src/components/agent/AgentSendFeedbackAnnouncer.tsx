'use client'
import type { AgentSendFeedback } from '../../types'
import { toAnnouncementText } from '../../lib/announcementText'

interface Props {
  /** エージェント CLI 方式の送信の失敗と成功の通知(パネルの見える文字と同じ状態) */
  feedback: AgentSendFeedback
}

/**
 * 送信の失敗(role="alert")と成功の通知(role="status")の読み上げ。Sidebar がパネルの切り替えに関わらず常に描画する 1 か所だけで、
 * 見た目には出さない(見える文字は見えているパネルの AgentSendFeedbackMessages)。成功の通知の領域は空でも DOM に残す(ライブリージョンは
 * 先に在る必要がある。パターン 87)
 */
export default function AgentSendFeedbackAnnouncer({ feedback }: Props): React.JSX.Element {
  return (
    <div className="agent-send-feedback__live">
      {feedback.error !== null && <p role="alert">{feedback.error}</p>}
      <p role="status">{toAnnouncementText(feedback.notice)}</p>
    </div>
  )
}
