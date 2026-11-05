// エクスプローラーの上部の「エージェントの指示ファイル」の節(設計書 2026-11-05「画面」)
import { useId } from 'react'
import { AGENT_CLI_PROFILES } from '@shared/agentCliKinds'
import type { AgentInstructionsPanelState } from '../../types'

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
  // clone 中は押す前から押せない状態なので disabled。作成の途中は押した結果として起きる状態で、disabled にするとフォーカスを持つ
  // 押したボタンが押せなくなってフォーカスが body に落ちるため、aria-disabled にして押しても何もしない(L-157。AgentCliKindSection と同じ)
  const creating = state.isCreating
  return (
    <section className="agent-instructions" aria-labelledby={headingId}>
      <h3 id={headingId} className="agent-instructions__title">
        エージェントの指示ファイル({AGENT_CLI_PROFILES[state.cliKind].displayName})
      </h3>
      <ul className="agent-instructions__list">
        {state.rows.map((row) => (
          <li key={row.file.id} className="agent-instructions__row">
            <span className="agent-instructions__text">
              <span className="agent-instructions__path">{row.relativePath}</span>
              <span className="agent-instructions__description">{row.file.description}</span>
            </span>
            {row.node !== null ? (
              <button
                type="button"
                className="agent-instructions__button"
                aria-label={`${row.relativePath} を開く`}
                disabled={isBlocked}
                aria-disabled={creating ? true : undefined}
                onClick={() => {
                  if (!creating) state.open(row)
                }}
              >
                開く
              </button>
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
      {state.message !== null && (
        <p role="alert" className="agent-instructions__message">
          {state.message}
        </p>
      )}
    </section>
  )
}
