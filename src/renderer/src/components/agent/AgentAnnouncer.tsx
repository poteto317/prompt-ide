'use client'

interface Props {
  /** 読み上げの文言(まだ無ければ '') */
  message: string
}

// エージェントの状態の変化の読み上げ(通知の設計書「読み上げの領域」)。パネルの開閉に関わらず App が常に描画し、同じ要素の
// 文言を入れ替える(既存の常設の aria-live と同じ。パターン 87)。同じタブの同じ出来事が続くと文言が変わらず、読み上げが省かれうる(既知の制約)
export default function AgentAnnouncer({ message }: Props): React.JSX.Element {
  return (
    <p className="agent-announcer" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  )
}
