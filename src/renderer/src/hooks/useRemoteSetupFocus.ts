import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { RemoteSetupFocusTarget } from '../lib/remoteSetupState'

// 成功の後に、次の操作のボタンへフォーカスを移す(初期化 → 「リモートを追加」、追加 → 「初回 push（upstream を設定）」、
// 初回 push → ツールバーの「プッシュ」)。移す先は rootRef の中の data-remote-setup-focus="<target>" の要素。
// 要求の state もここで持つ(UI の振る舞いで、Git 操作のフックとは変わる理由が違う。要求する部品
// (NotRepositoryView・RemoteSetupBanner)も移す先も、rootRef を持つ SourceControlPanel の配下にある)。
// 要求は、成功を受け取った部品がダイアログを閉じるのと同じ描画で出す(差分 4)ため、この useEffect が走る時点では、
// 閉じたダイアログ・消えたボタンにあったフォーカスは body に落ちている。移すのはフォーカスが body のときだけ
// (利用者が移した先を奪わない)で、移す先が無い・disabled のときは何もしない(例: 追加の後に detached で
// バナーが出ない)。どの場合も要求は 1 回だけ扱う(後から現れたボタンへ遅れて移さない。パターン 86)。
// そのため要求は呼ぶたびに新しいオブジェクトにし(同じ先を続けて要求しても effect が走る)、effect は要求が
// 変わったときだけ走る(effect の中で要求を消す setState は不要)
export function useRemoteSetupFocus(rootRef: RefObject<HTMLElement | null>): {
  /** 成功を受け取った部品が、ダイアログを閉じるのと同じ描画で呼ぶ。参照は描画をまたいで変わらない */
  requestFocus: (target: RemoteSetupFocusTarget) => void
} {
  const [focusRequest, setFocusRequest] = useState<{ target: RemoteSetupFocusTarget } | null>(null)
  // 子の部品へ props で渡すため、参照を固定する
  const requestFocus = useCallback((target: RemoteSetupFocusTarget): void => {
    setFocusRequest({ target })
  }, [])

  useEffect(() => {
    if (focusRequest === null) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const target = rootRef.current?.querySelector<HTMLButtonElement>(
      `[data-remote-setup-focus="${focusRequest.target}"]`
    )
    if (target === null || target === undefined || target.disabled) return
    target.focus()
  }, [rootRef, focusRequest])

  return { requestFocus }
}
