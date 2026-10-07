import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export interface AgentDiffFocusRestore {
  /** エディタの領域(EditorPanel の外枠)に付ける */
  panelRef: RefObject<HTMLDivElement | null>
  /** 「このハンクを実行前に戻す」の onClick の先頭で呼ぶ */
  reserveFocusRestore: () => void
}

// エージェントの変更の diff タブで、ハンクを戻した後のフォーカス(パターン 86・152)。押したボタンは実行中に disabled になり、
// 成功すると diff の取り直しで消え、最後のハンクならタブごと閉じる。どれもフォーカスが body に落ちる。
// 押したときに予約し、描画の後の effect で、フォーカスが body(またはエディタの領域の中の押せないボタン)にあるときだけ、
// アクティブなタブ(role="tab")へ戻す。タブが閉じた後は、次にアクティブになったタブへ戻す。
// 戻しても予約は下ろさない。予約は利用者の次の操作(document の capture の pointerdown・keydown)で下ろす。
// 描画の順(実行中の disabled → 一覧の取り直し → タブを閉じる)に依らず、そのたびにタブへ戻すため
// (戻す操作の完了で下ろすと、タブを閉じる描画より先に下りてしまう。PR #47 の 2 回目のレビュー)。
// 押下(pointerdown・keydown)は同じ押下の click より先に来るので、押した操作で立てた予約は消さない。
// アクティブなタブが無くなったら(非アクティブな diff タブだけが残った)予約は捨てる(Welcome に戻ったときは、その仮のタブへ戻す)。
// 利用者がエディタの領域の外へ移したフォーカスは奪わない。
// effect は依存配列を持たず、毎描画の後に走る
export function useAgentDiffFocusRestore(): AgentDiffFocusRestore {
  const panelRef = useRef<HTMLDivElement>(null)
  // 予約の間だけ document に付けるリスナーを外す関数(予約が無ければ null)
  const releaseRef = useRef<(() => void) | null>(null)
  const release = (): void => {
    releaseRef.current?.()
    releaseRef.current = null
  }
  const reserveFocusRestore = (): void => {
    if (releaseRef.current !== null) return
    const onUserAction = (): void => release()
    document.addEventListener('pointerdown', onUserAction, true)
    document.addEventListener('keydown', onUserAction, true)
    releaseRef.current = () => {
      document.removeEventListener('pointerdown', onUserAction, true)
      document.removeEventListener('keydown', onUserAction, true)
    }
  }

  useEffect(() => {
    if (releaseRef.current === null) return
    const panel = panelRef.current
    const active = document.activeElement
    const isInPanel = active !== null && panel?.contains(active) === true
    const isLost =
      active === null ||
      active === document.body ||
      (isInPanel && active instanceof HTMLButtonElement && active.disabled)
    if (isLost) {
      const tab = panel?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      if (tab == null) release()
      else tab.focus()
      return
    }
    // 利用者がエディタの領域の外へ移したフォーカスは奪わない
    if (!isInPanel) release()
  })

  // アンマウントでリスナーを外す(release は毎描画で作り直すが、ref だけを触るのでどの描画のものでもよい)
  useEffect(() => release, [])

  return { panelRef, reserveFocusRestore }
}
