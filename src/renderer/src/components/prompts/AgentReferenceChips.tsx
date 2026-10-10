'use client'
import { useId } from 'react'
import type { AgentReferenceChipState, AgentReferencesPanelState } from '../../types'
import {
  AGENT_REFERENCE_CHIP_FALLBACK_LABELS,
  AGENT_REFERENCE_DISABLED_REASONS,
  AGENT_REFERENCE_GROUP_LABEL,
  AGENT_REFERENCE_TOGGLE_TITLES,
  AGENT_REFERENCE_UNSAVED_MARK,
  formatAgentReferenceRemoveLabel
} from '../../lib/agentReferenceMessages'
import { useRemovedItemFocus } from '../../hooks/useRemovedItemFocus'

// 足したファイルのチップの × (外したときのフォーカスの移し先を探す目印)
const REMOVE_BUTTON_SELECTOR = '[data-reference-remove]'

// 画面にも文字で出す押せない理由。見ただけでは分からないものだけ(開いているファイルが無い・範囲を選んでいないは見れば分かる)。
// title と読み上げの説明だけでは、タッチ・キーボードだけで使う晴眼の利用者に届かない
const VISIBLE_DISABLED_REASONS: ReadonlySet<string> = new Set([
  AGENT_REFERENCE_DISABLED_REASONS.diffTab,
  AGENT_REFERENCE_DISABLED_REASONS.outsideFolder
])

// 開いているファイル・選択範囲のチップの理由のうち、画面に出すもの(同じ理由は 1 回だけ。差分のタブでは両方が同じ理由)。
// key は表示文言ではなく、理由を最初に出したチップの種類にする
const visibleDisabledReasons = (
  chips: readonly { id: 'openFile' | 'selection'; chip: AgentReferenceChipState }[]
): { id: 'openFile' | 'selection'; reason: string }[] => {
  const items: { id: 'openFile' | 'selection'; reason: string }[] = []
  for (const { id, chip } of chips) {
    const reason = chip.disabledReason
    if (reason === null || !VISIBLE_DISABLED_REASONS.has(reason)) continue
    if (items.some((item) => item.reason === reason)) continue
    items.push({ id, reason })
  }
  return items
}

interface Props {
  state: AgentReferencesPanelState
}

interface ToggleProps {
  chip: AgentReferenceChipState
  /** 押せないときにパスの代わりに出す文言 */
  fallbackLabel: string
  /** 押せるときの title(何を添えるか) */
  title: string
}

// 参照の名前の後ろに付ける未保存の印(空白 1 つを挟む。開いているファイル・選択範囲・足したファイルのチップで共通)
function UnsavedMark(): React.JSX.Element {
  return (
    <>
      {' '}
      <span className="agent-references__unsaved">{AGENT_REFERENCE_UNSAVED_MARK}</span>
    </>
  )
}

// 開いているファイル・選択範囲のチップ(オン・オフ)。押せないときは理由を title と aria-describedby で出す(hidden の要素)。
// 見ただけでは分からない理由は、参照の行にも画面の文字として出す(AgentReferenceChips)
function ReferenceToggle({ chip, fallbackLabel, title }: ToggleProps): React.JSX.Element {
  const reasonId = useId()
  return (
    <>
      <button
        type="button"
        className={`agent-references__chip agent-references__toggle${chip.pressed ? ' agent-references__toggle--pressed' : ''}`}
        aria-pressed={chip.pressed}
        disabled={chip.disabledReason !== null}
        title={chip.disabledReason ?? title}
        aria-describedby={chip.disabledReason !== null ? reasonId : undefined}
        onClick={chip.onToggle}
      >
        {chip.label ?? fallbackLabel}
        {/* 名前に見えている文字をそのまま含める(「@src/app.ts 未保存」。L-156) */}
        {chip.unsaved && <UnsavedMark />}
      </button>
      {chip.disabledReason !== null && (
        // hidden で読み上げの順番に出さない(説明として読まれた後に、もう一度テキストとして読まれないように)。
        // aria-describedby は隠した要素の文言も説明として使える
        <span id={reasonId} className="agent-references__reason" hidden>
          {chip.disabledReason}
        </span>
      )}
    </>
  )
}

// プロンプトパネルの参照の行(設計書「プロンプトパネルのチップ」)。開いているファイル・選択範囲のチップと、エクスプローラから
// 足したファイルのチップ(× で外す)を出す
export default function AgentReferenceChips({ state }: Props): React.JSX.Element {
  const labelId = useId()
  // × で外したときのフォーカスの移し先(外した位置)。押したボタンは消えるので、描画の後に移す(body に落とさない)
  const { containerRef: groupRef, markRemoved } = useRemovedItemFocus<HTMLDivElement>(
    state.added,
    REMOVE_BUTTON_SELECTOR
  )

  return (
    <div
      ref={groupRef}
      className="agent-references"
      role="group"
      aria-labelledby={labelId}
      // 足したファイルを全部外した後のフォーカスの置き場(Tab の順には入らない)
      tabIndex={-1}
    >
      <span id={labelId} className="agent-references__label">
        {AGENT_REFERENCE_GROUP_LABEL}
      </span>
      <ReferenceToggle
        chip={state.openFile}
        fallbackLabel={AGENT_REFERENCE_CHIP_FALLBACK_LABELS.openFile}
        title={AGENT_REFERENCE_TOGGLE_TITLES.openFile}
      />
      <ReferenceToggle
        chip={state.selection}
        fallbackLabel={AGENT_REFERENCE_CHIP_FALLBACK_LABELS.selection}
        title={AGENT_REFERENCE_TOGGLE_TITLES.selection}
      />
      {state.added.map((item, index) => (
        <span key={item.path} className="agent-references__chip agent-references__chip--added">
          <span className="agent-references__chip-label">
            {item.label}
            {/* 開いているファイルのチップと同じ印(「@docs/notes.md 未保存」) */}
            {item.unsaved && <UnsavedMark />}
          </span>
          <button
            type="button"
            className="agent-references__remove"
            data-reference-remove=""
            aria-label={formatAgentReferenceRemoveLabel(item.label)}
            onClick={() => {
              markRemoved(index)
              state.onRemove(item.path)
            }}
          >
            ×
          </button>
        </span>
      ))}
      {visibleDisabledReasons([
        { id: 'openFile', chip: state.openFile },
        { id: 'selection', chip: state.selection }
      ]).map(({ id, reason }) => (
        // 読み上げはチップの説明(aria-describedby)で届くので、見える文字は読み上げの順番に出さない(二重に読まれないように)
        <p key={id} className="agent-references__visible-reason" aria-hidden="true">
          {reason}
        </p>
      ))}
    </div>
  )
}
