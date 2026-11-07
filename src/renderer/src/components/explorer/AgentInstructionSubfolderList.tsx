// 指示ファイルの節の「サブフォルダ」(設計書 2026-11-07「画面」「アクセシビリティ」)。開閉は WAI-ARIA の disclosure の形。
// 開閉のボタンは 0 件でも出す(件数で出し消しすると、読み直しで 0 件になったときにフォーカスが body に落ちる)
import { useId, useState } from 'react'
import type { AgentInstructionSubfolderRow } from '../../types'
import {
  AGENT_INSTRUCTION_SUBFOLDER_EMPTY,
  agentInstructionSubfolderHiddenLabel,
  agentInstructionSubfolderToggleLabel
} from '../../lib/agentInstructionMessages'
import AgentInstructionOpenButton from './AgentInstructionOpenButton'

interface Props {
  rows: readonly AgentInstructionSubfolderRow[]
  /** 見つかった全件の数(上限で隠した分を含む) */
  total: number
  note: string | null
  isBlocked: boolean
  isCreating: boolean
  onOpen: (row: AgentInstructionSubfolderRow) => void
}

export default function AgentInstructionSubfolderList({
  rows,
  total,
  note,
  isBlocked,
  isCreating,
  onOpen
}: Props): React.JSX.Element {
  // 既定は折りたたみ。保存はせず、節が出ている間は保つ(フォルダ・CLI の切り替えや読み直しでも戻さない)
  const [expanded, setExpanded] = useState(false)
  const regionId = useId()
  const noteId = useId()
  const hiddenCount = total - rows.length
  return (
    <>
      <h4 className="agent-instructions__subtitle">
        <button
          type="button"
          className="agent-instructions__toggle"
          aria-expanded={expanded}
          // 描画していない間は指す先が無いので付けない
          aria-controls={expanded ? regionId : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
          {agentInstructionSubfolderToggleLabel(total)}
        </button>
      </h4>
      {expanded && (
        // 注・一覧・「ほか N 件」・0 件の文言をまとめて包む。0 件のときも描画し、aria-controls の先を必ず置く
        <div id={regionId} className="agent-instructions__subfolder-region">
          {total === 0 ? (
            <p className="agent-instructions__note">{AGENT_INSTRUCTION_SUBFOLDER_EMPTY}</p>
          ) : (
            <>
              {note !== null && (
                <p id={noteId} className="agent-instructions__note">
                  {note}
                </p>
              )}
              <ul
                className="agent-instructions__list"
                aria-describedby={note !== null ? noteId : undefined}
              >
                {rows.map((row) => (
                  <li key={row.node.path} className="agent-instructions__row">
                    <span className="agent-instructions__text">
                      <span className="agent-instructions__path">{row.relativePath}</span>
                      <span className="agent-instructions__description">{row.description}</span>
                    </span>
                    <AgentInstructionOpenButton
                      path={row.relativePath}
                      isBlocked={isBlocked}
                      isCreating={isCreating}
                      onOpen={() => onOpen(row)}
                    />
                  </li>
                ))}
              </ul>
              {hiddenCount > 0 && (
                <p className="agent-instructions__note">
                  {agentInstructionSubfolderHiddenLabel(hiddenCount)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}
