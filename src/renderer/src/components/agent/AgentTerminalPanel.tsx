'use client'
import { useCallback, useId, useRef } from 'react'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import { isInsideAgentTerminal } from '../../lib/agentTerminalKeys'
import {
  AGENT_RESUME_LAST_LABEL,
  agentStartAriaLabel,
  agentResumeLastAriaLabel,
  describeAgentStatus
} from '../../lib/agentSessionMessages'
import { AGENT_INTERRUPT_LABEL, agentInterruptAriaLabel } from '../../lib/agentInterruptMessages'
import { toAnnouncementText } from '../../lib/announcementText'
import { isActiveAgentSessionStatus } from '../../lib/agentSessionTabState'
import { useAgentTabCloseFocus } from '../../hooks/useAgentTabCloseFocus'
import { useAgentInterruptFocus } from '../../hooks/useAgentInterruptFocus'
import type { AgentTerminalPanelState } from '../../hooks/useAgentWorkspace'
import type { AgentChangesReviewAction } from '../../types'
import AgentSessionTabList from './AgentSessionTabList'
import AgentTerminalView from './AgentTerminalView'

interface Props {
  state: AgentTerminalPanelState
  review?: AgentChangesReviewAction
}

// エディタの領域の下部のターミナルパネル(設計書「配置の案」A)。見出しの帯(開閉・セッションのタブ・状態・中断・起動/終了・変更を確認・最大化)と xterm の表示の領域。
// 閉じても xterm とセッションは破棄せず、表示だけを隠す(出力は裏で受け取り続ける)。帯の状態・起動・終了・エラーと
// ターミナルは選択中のタブのもの
export default function AgentTerminalPanel({ state, review }: Props): React.JSX.Element {
  const { sessions, layout, sendingSlotId, activities, resumeLast, interrupt, appCliKind } = state
  const session = sessions.selected
  const { startDisabledReason } = sessions
  const bodyId = useId()
  const tabIdPrefix = useId()
  const hintId = useId()
  const reasonId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const interruptRef = useRef<HTMLButtonElement>(null)
  const interruptReasonId = useId()
  // セッションが終わって 中断 が消えたときのフォーカスの移し先(主ボタン、押せなければ開閉のボタン)
  const handlePanelFocus = useAgentInterruptFocus(interrupt.visible, {
    interruptRef,
    primaryButtonRef,
    toggleRef
  })

  // 消える要素にフォーカスを残さない(パターン 86)
  const moveFocusOutOfTerminal = (): void => {
    if (isInsideAgentTerminal(document.activeElement)) toggleRef.current?.focus()
  }
  const focusToggle = useCallback(() => toggleRef.current?.focus(), [])
  // closeTab は × を押した時点で sessions から読む
  const handleCloseTab = useAgentTabCloseFocus(
    sectionRef,
    (slotId) => sessions.closeTab(slotId),
    moveFocusOutOfTerminal
  )

  const isActive = isActiveAgentSessionStatus(session.status)
  // 閉じる途中のタブは起動しない(useAgentSessions も弾く。直後の削除で controller が捨てられるため)
  const startDisabled =
    startDisabledReason !== null || session.status === 'starting' || session.isClosing
  // 帯の理由は 1 か所(L-057)。起動の理由を優先し、無ければ 前回の続きから の理由を出す。どちらのボタンも同じ領域を参照する
  const visibleReason = startDisabledReason ?? resumeLast.disabledReason
  const resumeDisabled = resumeLast.disabledReason !== null || session.isClosing

  return (
    <section
      ref={sectionRef}
      className={[
        'agent-terminal-panel',
        layout.isOpen ? 'agent-terminal-panel--open' : 'agent-terminal-panel--closed',
        layout.isMaximized ? 'agent-terminal-panel--maximized' : ''
      ]
        .filter((name) => name !== '')
        .join(' ')}
      aria-label="エージェント"
      onFocus={handlePanelFocus}
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
        <AgentSessionTabList
          tabs={sessions.tabs}
          activities={activities}
          selectedSlotId={session.slotId}
          panelId={bodyId}
          tabIdPrefix={tabIdPrefix}
          sendingSlotId={sendingSlotId}
          addDisabledReason={sessions.addDisabledReason}
          onSelect={sessions.selectTab}
          onClose={(slotId) => void handleCloseTab(slotId)}
          onAdd={() => void sessions.addTab()}
        />
        <span className="agent-terminal-panel__status">
          {describeAgentStatus(session.status, session.exit, activities.get(session.slotId))}
        </span>
        <span className="agent-terminal-panel__actions">
          {visibleReason !== null && !isActive && (
            <>
              {/* 読み上げはボタンの説明(aria-describedby)で届くので、見える文字は読み上げの順番に出さない(二重に読まれないように) */}
              <span
                className="agent-terminal-panel__reason"
                title={visibleReason}
                aria-hidden="true"
              >
                {visibleReason}
              </span>
              {/* 説明の参照先。hidden で読み上げの順番に出さない。aria-describedby は隠した要素の文言も説明として使える */}
              <span id={reasonId} hidden>
                {visibleReason}
              </span>
            </>
          )}
          {interrupt.visible && (
            <>
              {/* 押せない理由は見える文字にしない(title と説明だけ。狭い帯で状態の文言・タブ列を押し出さないため。既知の制約) */}
              {interrupt.disabledReason !== null && (
                <span id={interruptReasonId} hidden>
                  {interrupt.disabledReason}
                </span>
              )}
              {/* disabled ではなく aria-disabled: 押して作業が止まるとすぐ押せなくなるが、disabled だとフォーカスが body に落ち、
                  キーリピートが隣の 終了 などへ届いて会話を失う。押せない状態で押したときは hook が理由を読み上げて送らない。
                  1,000ms の待ち・同期の再入の防止(useAgentInterrupt・useAgentInterruptCooldown)と、ダブルクリック・キーリピートの無視(ここ)は組で働く(L-408) */}
              <button
                ref={interruptRef}
                type="button"
                className="agent-terminal-panel__button"
                aria-label={agentInterruptAriaLabel(session.cliKind)}
                aria-disabled={interrupt.disabledReason !== null ? true : undefined}
                aria-describedby={interrupt.disabledReason !== null ? interruptReasonId : undefined}
                title={interrupt.disabledReason ?? undefined}
                onClick={(event) => {
                  // ダブルクリックの 2 回目は捨てる(キーボードのクリックは detail が 0 で影響しない)
                  if (event.detail > 1) return
                  interrupt.onInterrupt()
                }}
                onKeyDown={(event) => {
                  // 押し続けた Enter・Space のリピートで、1,000ms ごとに Esc を送らない(単発の打鍵は止めない)
                  if (event.repeat && (event.key === 'Enter' || event.key === ' '))
                    event.preventDefault()
                }}
              >
                {AGENT_INTERRUPT_LABEL}
              </button>
            </>
          )}
          {/* 起動 と 終了 は同じ位置の 1 つの button として描く(押すと同じ要素が使い回され、フォーカスが 終了 に残る) */}
          {isActive ? (
            <button
              ref={primaryButtonRef}
              type="button"
              className="agent-terminal-panel__button"
              aria-label="終了（エージェントを止める）"
              disabled={session.status === 'starting' || session.isClosing}
              onClick={() => void sessions.stop(session.slotId)}
            >
              終了
            </button>
          ) : (
            <button
              ref={primaryButtonRef}
              type="button"
              className="agent-terminal-panel__button"
              aria-label={agentStartAriaLabel(AGENT_CLI_PROFILES[appCliKind].commandName)}
              disabled={startDisabled}
              aria-describedby={startDisabledReason !== null ? reasonId : undefined}
              title={startDisabledReason ?? undefined}
              onClick={() => void sessions.start(session.slotId, { kind: 'new' })}
            >
              起動
            </button>
          )}
          {!isActive && (
            <button
              type="button"
              className="agent-terminal-panel__button agent-terminal-panel__button--resume"
              aria-label={agentResumeLastAriaLabel(AGENT_CLI_PROFILES[appCliKind].commandName)}
              disabled={resumeDisabled}
              aria-describedby={resumeLast.disabledReason !== null ? reasonId : undefined}
              title={resumeLast.disabledReason ?? undefined}
              onClick={() => {
                // 押すとこのボタンは消える。先に 起動 へ移し、同じ要素が 終了 に替わってフォーカスが残るようにする(body に落とさない)。
                // 押せるときは 起動 も押せる(起動の理由があれば 前回の続きから も押せない)
                primaryButtonRef.current?.focus()
                resumeLast.onResume(session.slotId)
              }}
            >
              {/* 理由が無いときは、ラベルの文字にマウスを載せると全文が出る(狭い幅で省略されても分かる)。
                  ボタンの title にすると説明になり、名前の後に重ねて読まれるため、子の要素に付ける */}
              <span
                title={resumeLast.disabledReason === null ? AGENT_RESUME_LAST_LABEL : undefined}
              >
                {AGENT_RESUME_LAST_LABEL}
              </span>
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
      <div
        id={bodyId}
        role="tabpanel"
        aria-labelledby={`${tabIdPrefix}-${session.slotId}`}
        className="agent-terminal-panel__body"
        hidden={!layout.isOpen}
      >
        <AgentTerminalView
          controller={session.controller}
          isVisible={layout.isOpen}
          onFocusOut={focusToggle}
        />
      </div>
      {/* 中断の読み上げ(送れたとき・押せない状態で押したとき・2 回目を頼まなかったとき)。ライブリージョンは先に在る必要があるため常に描く(パターン 87) */}
      <p className="agent-terminal-panel__live" role="status">
        {toAnnouncementText(interrupt.notice)}
      </p>
    </section>
  )
}
