// エクスプローラーの上部の「エージェントの指示ファイル」の節(設計書 2026-11-05「画面」)
import { useEffect, useId, useRef } from 'react'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentInstructionsPanelState } from '../../types'
import {
  AGENT_INSTRUCTION_REFRESH_LABEL,
  AGENT_INSTRUCTION_REFRESH_TEXT,
  AGENT_INSTRUCTION_REFRESH_TITLE,
  AGENT_INSTRUCTION_THIS_FOLDER_HEADING
} from '../../lib/agentInstructionMessages'
import AgentInstructionOpenButton from './AgentInstructionOpenButton'
import AgentInstructionSubfolderList from './AgentInstructionSubfolderList'

interface Props {
  state: AgentInstructionsPanelState
  /** clone の実行中など、フォルダが切り替わりうる間は押させない */
  isBlocked: boolean
}

export default function AgentInstructionFilesSection({
  state,
  isBlocked
}: Props): React.JSX.Element {
  const headingId = useId()
  const messageRef = useRef<HTMLParagraphElement>(null)
  // 節が縮んで中でスクロールするほど低いウィンドウでも、文言が出たら見える位置まで節の中を動かす(フォーカスは動かさない)
  useEffect(() => {
    if (state.message !== null) messageRef.current?.scrollIntoView({ block: 'nearest' })
  }, [state.message])
  // clone 中は押す前から押せない状態なので disabled。作成の途中は押した結果として起きる状態で、disabled にするとフォーカスを持つ
  // 押したボタンが押せなくなってフォーカスが body に落ちるため、aria-disabled にして押しても何もしない(L-157。AgentCliKindSection と同じ)
  const creating = state.isCreating
  return (
    <section className="agent-instructions" aria-labelledby={headingId}>
      <div className="agent-instructions__header">
        <h3 id={headingId} className="agent-instructions__title">
          エージェントの指示ファイル({AGENT_CLI_PROFILES[state.cliKind].displayName})
        </h3>
        {/* clone 中は押す前から押せないので disabled。作成の途中(作成が自分で読み直す)と更新の途中は押した結果なので
            aria-disabled にして押しても何もしない(L-157)。フォルダの走査中は押せる(refreshTree が走査の後に読み直す) */}
        <button
          type="button"
          className="agent-instructions__button"
          aria-label={AGENT_INSTRUCTION_REFRESH_LABEL}
          title={AGENT_INSTRUCTION_REFRESH_TITLE}
          disabled={isBlocked}
          aria-disabled={creating || state.isRefreshing ? true : undefined}
          onClick={() => {
            if (!creating && !state.isRefreshing) void state.refresh()
          }}
        >
          {AGENT_INSTRUCTION_REFRESH_TEXT}
        </button>
      </div>
      <h4 className="agent-instructions__subtitle">{AGENT_INSTRUCTION_THIS_FOLDER_HEADING}</h4>
      <ul className="agent-instructions__list">
        {state.rows.map((row) => (
          <li key={row.file.id} className="agent-instructions__row">
            <span className="agent-instructions__text">
              <span className="agent-instructions__path">{row.relativePath}</span>
              <span className="agent-instructions__description">{row.file.description}</span>
            </span>
            {row.node !== null ? (
              <AgentInstructionOpenButton
                relativePath={row.relativePath}
                isBlocked={isBlocked}
                isCreating={creating}
                onOpen={() => state.open(row)}
              />
            ) : (
              <button
                type="button"
                className="agent-instructions__button"
                aria-label={`${row.relativePath} を作成`}
                disabled={isBlocked}
                aria-disabled={creating ? true : undefined}
                onClick={() => {
                  if (!creating) void state.create(row)
                }}
              >
                作成
              </button>
            )}
          </li>
        ))}
      </ul>
      {/* 節が縮んで中でスクロールするとき、下の一覧の後ろに置くと隠れる。「このフォルダ」の一覧の直後に置く */}
      {state.message !== null && (
        <p ref={messageRef} role="alert" className="agent-instructions__message">
          {state.message}
        </p>
      )}
      <AgentInstructionSubfolderList
        rows={state.subfolderRows}
        total={state.subfolderTotal}
        note={state.subfolderNote}
        isBlocked={isBlocked}
        isCreating={creating}
        onOpen={state.openSubfolderFile}
      />
    </section>
  )
}
