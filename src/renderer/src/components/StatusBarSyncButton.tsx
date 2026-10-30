'use client'

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { formatSyncCounts, getSyncChangesAriaLabel } from '../lib/syncChangesLabel'

interface Props {
  ahead: number
  behind: number
  isSyncing: boolean
  isSyncBlocked: boolean
  onSync: () => Promise<void>
  /** 完了の時点でこのボタンが消えている(押せない)ときのフォーカスの移し先(ブランチの項目) */
  fallbackFocusRef: RefObject<HTMLButtonElement | null>
}

// ステータスバーの変更の同期のボタン。ahead も behind も 0 の間は何も出さないが、マウントしたままにする
// (同期が終わって消えた後も、押した側として完了後のフォーカスを扱うため)
export default function StatusBarSyncButton({
  ahead,
  behind,
  isSyncing,
  isSyncBlocked,
  onSync,
  fallbackFocusRef
}: Props): React.JSX.Element | null {
  const buttonRef = useRef<HTMLButtonElement>(null)
  // このボタンから始めて完了した同期の回数。完了後の描画でだけフォーカスを扱うために、描画を起こす state で持つ
  const [finishedSyncCount, setFinishedSyncCount] = useState(0)
  const handledSyncCountRef = useRef(0)

  // 実行中はボタンが disabled になり、ブラウザはフォーカスを body へ落とす。完了して押せるようになった描画の後で、
  // ボタンが残っていれば同期のボタンへ、消えて(押せないままで)いればブランチの項目へ戻す。どちらも押せないうちは
  // 次の描画まで待つ。利用者が移した先は奪わない。依存の配列は置かず、押せるかの変化も含めて描画ごとに確かめる
  useEffect(() => {
    if (handledSyncCountRef.current === finishedSyncCount) return
    const target = [buttonRef.current, fallbackFocusRef.current].find(
      (element) => element !== null && !element.disabled
    )
    if (target === undefined || target === null) return
    handledSyncCountRef.current = finishedSyncCount
    const active = document.activeElement
    if (active === null || active === document.body) target.focus()
  })

  // コミット欄の主ボタンと同じく、ダブルクリックの続きで確認なしにプッシュしない
  const handleClick = async (event: React.MouseEvent): Promise<void> => {
    if (event.detail > 1) return
    await onSync()
    setFinishedSyncCount((count) => count + 1)
  }

  if (ahead === 0 && behind === 0) return null

  return (
    <button
      ref={buttonRef}
      type="button"
      className="status-bar__item status-bar__sync"
      disabled={isSyncing || isSyncBlocked}
      aria-label={getSyncChangesAriaLabel(ahead, behind)}
      onClick={handleClick}
      // 長押しの Enter の続きで、確認なしにプッシュしない(Space は keyup で押すので対象外)
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.repeat) e.preventDefault()
      }}
    >
      {formatSyncCounts(ahead, behind)}
    </button>
  )
}
