// 指示ファイルの節の「全体(すべてのプロジェクト)」(設計書 2026-11-07 global「画面」)。状態の文言は今の状態なので role="alert" にしない。
// 押した操作の失敗は節の失敗の文言の枠(1 か所)に出す(L-249)。パスは ~/… の形だけを出す(L-017)
import type { AgentCliKind } from '@shared/agentCliKinds'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { AgentGlobalInstructionRow } from '../../types'
import {
  AGENT_GLOBAL_INSTRUCTION_HEADING,
  AGENT_GLOBAL_INSTRUCTION_LOADING
} from '../../lib/agentInstructionMessages'
import AgentInstructionCreateButton from './AgentInstructionCreateButton'
import AgentInstructionOpenButton from './AgentInstructionOpenButton'

interface Props {
  cliKind: AgentCliKind
  row: AgentGlobalInstructionRow
  /** clone の実行中など。押す前から押せないので disabled */
  isBlocked: boolean
  /** 作成の途中。押した結果なので aria-disabled(L-157) */
  isCreating: boolean
  onOpen: () => void
  onCreate: () => void
}

export default function AgentInstructionGlobalList({
  cliKind,
  row,
  isBlocked,
  isCreating,
  onOpen,
  onCreate
}: Props): React.JSX.Element {
  const displayPath = row.kind === 'loading' ? null : row.displayPath
  const description =
    row.kind === 'loading'
      ? AGENT_GLOBAL_INSTRUCTION_LOADING
      : row.kind === 'blocked'
        ? row.message
        : row.description
  return (
    <>
      <h4 className="agent-instructions__subtitle">{AGENT_GLOBAL_INSTRUCTION_HEADING}</h4>
      <ul className="agent-instructions__list">
        {/* key は表の id(表示文言を key にしない) */}
        <li key={AGENT_GLOBAL_INSTRUCTION_FILES[cliKind].id} className="agent-instructions__row">
          <span className="agent-instructions__text">
            {displayPath !== null && (
              <span className="agent-instructions__path">{displayPath}</span>
            )}
            <span className="agent-instructions__description">{description}</span>
          </span>
          {row.kind === 'exists' && (
            <AgentInstructionOpenButton
              path={row.displayPath}
              isBlocked={isBlocked}
              isCreating={isCreating}
              onOpen={onOpen}
            />
          )}
          {row.kind === 'missing' && (
            <AgentInstructionCreateButton
              path={row.displayPath}
              isBlocked={isBlocked}
              isCreating={isCreating}
              onCreate={onCreate}
            />
          )}
        </li>
      </ul>
    </>
  )
}
