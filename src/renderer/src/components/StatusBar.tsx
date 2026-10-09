'use client'
import { BranchIcon } from './icons'
import type { AgentStatusBarState } from '../hooks/useAgentStatusBar'
import {
  describeAgentActivitySummary,
  formatAgentActivitySummary
} from '../lib/agentActivitySummary'

interface StatusBarProps {
  /** エージェントの活動のまとめ。null・items が空なら出さない。省略させない(App が渡し忘れると、まとめが黙って出なくなるため) */
  agent: AgentStatusBarState | null
}

export default function StatusBar({ agent }: StatusBarProps): React.JSX.Element {
  return (
    <div className="status-bar">
      <div className="status-bar__item">
        <BranchIcon />
        <span>main</span>
      </div>
      {agent !== null && agent.items.length > 0 && (
        <button
          type="button"
          className={[
            'status-bar__item',
            'status-bar__agent',
            agent.needsAttention ? 'status-bar__agent--attention' : ''
          ]
            .filter((name) => name !== '')
            .join(' ')}
          aria-label={describeAgentActivitySummary(agent.items)}
          onClick={agent.onActivate}
        >
          {formatAgentActivitySummary(agent.items)}
        </button>
      )}
      <div className="status-bar__spacer" />
      <div className="status-bar__item">TypeScript</div>
      <div className="status-bar__item">Ln 1, Col 1</div>
      <div className="status-bar__item">UTF-8</div>
    </div>
  )
}
