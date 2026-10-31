'use client'
import { useId, useState } from 'react'
import { ChevronIcon } from '../icons'

interface Props {
  title: string
  /** 見出しの右の件数のバッジ。0 件や無いときは出さない */
  count?: number
  /** 見出しの右の操作のボタン。開閉のボタンの外に置く(button の入れ子はできない) */
  actions?: React.ReactNode
  /** 閉じても見せるもの(見出しの操作のエラー)。見出しと本体の間で、hidden の外に置く。ダイアログは section の外に置く */
  alwaysVisible?: React.ReactNode
  children: React.ReactNode
}

// ソース管理の開閉できるセクション(ステージされている変更・変更・stash・履歴)。見出しは AgentChangesSection と同じ
// h3 > button の形で、状態は aria-expanded で伝える。閉じても中身はアンマウントせず hidden にする(入力中の状態を
// 失わない)。開閉の状態は保存しない
export default function CollapsibleSection({
  title,
  count,
  actions,
  alwaysVisible,
  children
}: Props): React.JSX.Element {
  const headingId = useId()
  const bodyId = useId()
  const [isOpen, setIsOpen] = useState(true)
  return (
    <section className="source-control-panel__section" aria-labelledby={headingId}>
      <div className="collapsible-section__header">
        <h3 className="source-control-panel__section-title collapsible-section__title">
          <button
            id={headingId}
            type="button"
            className="collapsible-section__toggle"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => setIsOpen((open) => !open)}
            // Enter を押し続けると、リピートのたびに開閉が反転して、手を離した時点の状態が予測できない
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.repeat) e.preventDefault()
            }}
          >
            <ChevronIcon direction={isOpen ? 'down' : 'right'} /> {title}
          </button>
          {count !== undefined && count > 0 && (
            <span className="collapsible-section__count">{count}</span>
          )}
        </h3>
        {actions !== undefined && <div className="collapsible-section__actions">{actions}</div>}
      </div>
      {alwaysVisible}
      <div id={bodyId} hidden={!isOpen}>
        {children}
      </div>
    </section>
  )
}
