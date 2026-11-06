'use client'
import { useEffect, useId, useRef } from 'react'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentSessionTabView } from '../../hooks/useAgentSessions'
import { describeAgentTabStatus } from '../../lib/agentSessionMessages'
import { isMacPlatform } from '../../lib/platform'

/** タブ列が描くのは名前と状態と閉じる途中かだけ(controller・終了・エラーは帯とターミナルが使う) */
type AgentSessionTabListItem = Pick<
  AgentSessionTabView,
  'slotId' | 'label' | 'status' | 'isClosing'
>

interface AgentSessionTabListProps {
  tabs: readonly AgentSessionTabListItem[]
  /** タブごとの活動(running のタブの印と読み上げの名前に使う。無いタブは unknown) */
  activities: ReadonlyMap<string, AgentActivity>
  selectedSlotId: string
  /** ターミナルの本体の id(aria-controls) */
  panelId: string
  /** タブのボタンの id の接頭辞(id は `${tabIdPrefix}-${slotId}`。tabpanel の aria-labelledby が参照する) */
  tabIdPrefix: string
  /** 「実行」の送信中のタブ(閉じられない。閉じる途中のタブも閉じられない) */
  sendingSlotId: string | null
  addDisabledReason: string | null
  onSelect: (slotId: string) => void
  onClose: (slotId: string) => void
  onAdd: () => void
  /** Mac か(Mac の delete キーが送る Backspace でも閉じる。Mac 以外の Backspace は誤操作になりやすいので閉じない) */
  isMac?: boolean
}

// ターミナルのパネルの帯のセッションのタブ列(設計書「画面」)。WAI-ARIA の tabs のパターン(選択とフォーカスを一緒に移す)。
// 閉じるボタン(×)はタブの中に入れず(操作できる要素の入れ子を避ける)、タブの隣に置く。tablist の子を tab だけにし、
// タブ列で Tab が止まるのを選択中のタブの 1 回にするため、× は支援技術から外し(aria-hidden)Tab の順にも入れない
// (tabIndex=-1。マウスで押すためのもの)。キーボード・支援技術では、タブで Delete(Mac では delete キーの Backspace も)を
// 押して閉じる(WAI-ARIA の tabs のパターンの「削除できるタブ」)。
// タブを閉じた後のフォーカスの移し先として useAgentTabCloseFocus が探すのは、選択中のタブ(role="tab"・aria-selected="true")。
// + で作ったタブ(選択中のタブ)へは、描画の後にフォーカスを移す(4 つ目を作ると + が押せなくなり、フォーカスのある要素が
// 無効になって document.body へ落ちるため。WAI-ARIA の tabs のパターンで、追加したタブを選択するのと合わせる)。
// ローカルレビュー第 6 周の指摘 2 で追加
export default function AgentSessionTabList({
  tabs,
  activities,
  selectedSlotId,
  panelId,
  tabIdPrefix,
  sendingSlotId,
  addDisabledReason,
  onSelect,
  onClose,
  onAdd,
  isMac = isMacPlatform()
}: AgentSessionTabListProps): React.JSX.Element {
  const addReasonId = useId()
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  // + を押した時点の選択中のタブ(フォーカスを移す依頼)。再描画の後に選択が変わっていたら(タブができた)、選択中のタブへ移す。
  // 作られなかった(選択が変わらない)ときは移さない。いずれも最初の再描画で依頼を消す
  const addFocusRequestRef = useRef<string | null>(null)

  useEffect(() => {
    const requestedFrom = addFocusRequestRef.current
    if (requestedFrom === null) return
    addFocusRequestRef.current = null
    if (selectedSlotId === requestedFrom) return
    tabRefs.current.get(selectedSlotId)?.focus()
  })

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>): void => {
    // ダブルクリックの 2 回目は捨てる(狭い幅で帯の 許可・拒否 が消えるとタブ列が伸び、2 回目が + に届いて CLI を起動しない。キーボードのクリックは detail が 0)
    if (event.detail > 1) return
    addFocusRequestRef.current = selectedSlotId
    onAdd()
  }

  const moveTo = (slotId: string): void => {
    onSelect(slotId)
    tabRefs.current.get(slotId)?.focus()
  }

  // × を押せる(タブが 2 つ以上で、送信中・閉じる途中でない)タブか。Delete で閉じられるかも同じ
  const isClosable = (tab: AgentSessionTabListItem): boolean =>
    tabs.length > 1 && tab.slotId !== sendingSlotId && !tab.isClosing

  const handleKeyDown = (event: React.KeyboardEvent, index: number): void => {
    // 修飾キー付きはブラウザ・OS のショートカット(Alt+← の戻る等)なので奪わない
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key === 'Delete' || (isMac && event.key === 'Backspace')) {
      const tab = tabs[index]
      if (!isClosable(tab)) return
      event.preventDefault()
      onClose(tab.slotId)
      return
    }
    const last = tabs.length - 1
    let target: number | null = null
    if (event.key === 'ArrowRight') target = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') target = index === 0 ? last : index - 1
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = last
    if (target === null) return
    event.preventDefault()
    moveTo(tabs[target].slotId)
  }

  return (
    <div className="agent-session-tabs">
      <div
        role="tablist"
        aria-label="エージェントのセッション"
        className="agent-session-tabs__list"
      >
        {tabs.map((tab, index) => {
          const selected = tab.slotId === selectedSlotId
          const activity =
            tab.status === 'running' ? (activities.get(tab.slotId) ?? 'unknown') : 'unknown'
          return (
            <span key={tab.slotId} role="presentation" className="agent-session-tabs__item">
              <button
                ref={(element) => {
                  if (element === null) tabRefs.current.delete(tab.slotId)
                  else tabRefs.current.set(tab.slotId, element)
                }}
                type="button"
                role="tab"
                id={`${tabIdPrefix}-${tab.slotId}`}
                aria-selected={selected}
                aria-controls={panelId}
                aria-label={`${tab.label}（${describeAgentTabStatus(tab.status, activity)}）`}
                aria-keyshortcuts={
                  isClosable(tab) ? (isMac ? 'Delete Backspace' : 'Delete') : undefined
                }
                tabIndex={selected ? 0 : -1}
                className={[
                  'agent-session-tabs__tab',
                  selected ? 'agent-session-tabs__tab--selected' : ''
                ]
                  .filter((name) => name !== '')
                  .join(' ')}
                onClick={() => onSelect(tab.slotId)}
                onKeyDown={(event) => handleKeyDown(event, index)}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'agent-session-tabs__dot',
                    `agent-session-tabs__dot--${tab.status}`,
                    // 活動の印(running のときだけ。unknown も入力待ちと形で見分けられるよう class を付ける)
                    tab.status === 'running' ? `agent-session-tabs__dot--${activity}` : ''
                  ]
                    .filter((name) => name !== '')
                    .join(' ')}
                />
                {tab.label}
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="agent-session-tabs__close"
                  aria-label={`${tab.label} を閉じる`}
                  aria-hidden="true"
                  tabIndex={-1}
                  disabled={!isClosable(tab)}
                  onClick={(event) => {
                    // ダブルクリックの 2 回目は捨てる(タブ 1 つで + を押すと、描き直しの後に + のあった位置へ claude 1 の × が出る。タブ 3 つ以上で × を押すと詰まった隣のタブの × が来る。どちらも止まっているタブを確認なしに閉じない。× はマウス専用で、キーボードは Delete で閉じる)
                    if (event.detail > 1) return
                    onClose(tab.slotId)
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </span>
          )
        })}
      </div>
      <button
        type="button"
        className="agent-session-tabs__add"
        aria-label="新しいセッション"
        disabled={addDisabledReason !== null}
        title={addDisabledReason ?? undefined}
        aria-describedby={addDisabledReason !== null ? addReasonId : undefined}
        onClick={handleAdd}
      >
        <span aria-hidden="true">+</span>
      </button>
      {addDisabledReason !== null && (
        <span id={addReasonId} className="agent-session-tabs__reason">
          {addDisabledReason}
        </span>
      )}
    </div>
  )
}
