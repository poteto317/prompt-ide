'use client'
import { useCallback, useId, useRef } from 'react'
import { isInsideAgentTerminal } from '../../lib/agentTerminalKeys'
import { describeAgentStatus } from '../../lib/agentSessionMessages'
import type { AgentTerminalPanelState } from '../../hooks/useAgentWorkspace'
import type { AgentChangesReviewAction } from '../../types'
import AgentTerminalView from './AgentTerminalView'

interface Props {
  state: AgentTerminalPanelState
  review?: AgentChangesReviewAction
}

// エディタの領域の下部のターミナルパネル(設計書「配置の案」A)。見出しの帯(開閉・状態・起動/終了・最大化)と xterm の表示の領域。
// 閉じても xterm とセッションは破棄せず、表示だけを隠す(出力は裏で受け取り続ける)
export default function AgentTerminalPanel({ state, review }: Props): React.JSX.Element {
  const { controller, session, layout } = state
  const bodyId = useId()
  const hintId = useId()
  const reasonId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)

  // 消える要素にフォーカスを残さない(パターン 86)
  const moveFocusOutOfTerminal = (): void => {
    if (isInsideAgentTerminal(document.activeElement)) toggleRef.current?.focus()
  }
  const focusToggle = useCallback(() => toggleRef.current?.focus(), [])

  const isActive = session.status === 'starting' || session.status === 'running'
  const startDisabled = session.startDisabledReason !== null || session.status === 'starting'

  return (
    <section
      className={[
        'agent-terminal-panel',
        layout.isOpen ? 'agent-terminal-panel--open' : 'agent-terminal-panel--closed',
        layout.isMaximized ? 'agent-terminal-panel--maximized' : ''
      ]
        .filter((name) => name !== '')
        .join(' ')}
      aria-label="エージェント"
    >
      <div className="agent-terminal-panel__header">
        <button
          ref={toggleRef}
          type="button"
          className="agent-terminal-panel__toggle"
          aria-expanded={layout.isOpen}
          aria-controls={bodyId}
          aria-describedby={hintId}
          onClick={() => {
            if (layout.isOpen) moveFocusOutOfTerminal()
            layout.toggleOpen()
          }}
        >
          <span aria-hidden="true">{layout.isOpen ? '▾' : '▸'}</span> エージェント
        </button>
        <span id={hintId} className="agent-terminal-panel__hint">
          F6 でターミナルから抜けます
        </span>
        <span className="agent-terminal-panel__status">
          {describeAgentStatus(session.status, session.exit)}
        </span>
        <span className="agent-terminal-panel__actions">
          {session.startDisabledReason !== null && !isActive && (
            <span
              id={reasonId}
              className="agent-terminal-panel__reason"
              title={session.startDisabledReason}
            >
              {session.startDisabledReason}
            </span>
          )}
          {isActive ? (
            <button
              type="button"
              className="agent-terminal-panel__button"
              aria-label="終了（エージェントを止める）"
              disabled={session.status === 'starting'}
              onClick={() => void session.stop()}
            >
              終了
            </button>
          ) : (
            <button
              type="button"
              className="agent-terminal-panel__button"
              aria-label="起動（開いているフォルダで claude を起動）"
              disabled={startDisabled}
              aria-describedby={session.startDisabledReason !== null ? reasonId : undefined}
              title={session.startDisabledReason ?? undefined}
              onClick={() => void session.start()}
            >
              起動
            </button>
          )}
          {review?.isRecording === true && (
            <button
              type="button"
              className="agent-terminal-panel__button"
              aria-label="エージェントの変更を確認（ソース管理を開く）"
              onClick={() => {
                // 最大化の間はエディタとサイドバーの操作が隠れるため、元に戻してから移る
                if (layout.isMaximized) {
                  moveFocusOutOfTerminal()
                  layout.toggleMaximized()
                }
                review.onReview()
              }}
            >
              変更を確認
            </button>
          )}
          <button
            type="button"
            className="agent-terminal-panel__button"
            aria-pressed={layout.isMaximized}
            onClick={() => {
              if (layout.isMaximized) moveFocusOutOfTerminal()
              layout.toggleMaximized()
            }}
          >
            {layout.isMaximized ? '元に戻す' : '最大化'}
          </button>
        </span>
      </div>
      {session.error !== null && (
        <p className="agent-terminal-panel__error" role="alert">
          {session.error}
        </p>
      )}
      <div id={bodyId} className="agent-terminal-panel__body" hidden={!layout.isOpen}>
        <AgentTerminalView
          controller={controller}
          isVisible={layout.isOpen}
          onFocusOut={focusToggle}
        />
      </div>
    </section>
  )
}
