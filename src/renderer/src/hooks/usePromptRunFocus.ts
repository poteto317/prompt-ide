import { useCallback, useEffect, useRef, useState } from 'react'
import { findSendConfirmReturnTarget } from '../lib/promptRunButton'

// 送信前の確認からの送信が失敗したとき、確認を開いた時点の要素(履歴の詳細の再実行 など)、無ければプロンプトの一覧の「実行」へ
// フォーカスを戻す(設計書「エラーと境界の扱い」)。送信の結果が出た時点では、送信中の実行ボタン・再実行はまだ disabled で
// 描画されているため、送信中が解けた描画の後に移す。
// 移す直前にフォーカスが body 以外(利用者が移した先)にあれば移さない

export interface UsePromptRunFocusOptions {
  /** 実行ボタンが押せない間(送信中)。true の間は依頼を持ったまま待つ */
  isBlocked: boolean
}

export function usePromptRunFocus({
  isBlocked
}: UsePromptRunFocusOptions): (promptId: string | null, opener: Element | null) => void {
  // 戻すプロンプトと開いた時点の要素。依頼のたびに数を進めて描画させ(送信中がすでに解けているときも)、effect は 1 回だけ移す
  const requestRef = useRef<{ promptId: string | null; opener: Element | null } | null>(null)
  const [requestCount, setRequestCount] = useState(0)
  useEffect(() => {
    const request = requestRef.current
    if (request === null || isBlocked) return
    requestRef.current = null
    // 依頼の後、送信中が解けるまでに利用者が別の場所へ移したフォーカスは奪わない(body へ落ちたままのときだけ移す)
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    // 戻り先が無い(一覧に出ていない・隠れている)・押せない(セッションが終わった など)なら移さない
    findSendConfirmReturnTarget(request.opener, request.promptId)?.focus()
  }, [requestCount, isBlocked])

  return useCallback((promptId: string | null, opener: Element | null): void => {
    requestRef.current = { promptId, opener }
    setRequestCount((count) => count + 1)
  }, [])
}
