import { useCallback, useEffect, useRef, useState } from 'react'
import type { Announcement } from '../types'

export interface TransientNotice {
  /** 表示中の通知。durationMs の後に null へ戻る */
  notice: Announcement | null
  /** 通知を出す。同じ文言でも id を進め、読み上げ直させる(パターン 87) */
  announce: (text: string) => void
  /** 表示中の通知を消す(タイマーも解除される)。id は戻さない */
  clear: () => void
}

// 一定時間で消える通知(role="status" で読み上げる一時的な結果の表示)。通知ごとに id を進める。
// 次の通知が来たら、前のタイマーは解除して数え直す
export function useTransientNotice(durationMs: number): TransientNotice {
  const [notice, setNotice] = useState<Announcement | null>(null)
  const idRef = useRef(0)

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), durationMs)
    return () => clearTimeout(timer)
  }, [notice, durationMs])

  const announce = useCallback((text: string): void => {
    idRef.current += 1
    setNotice({ text, id: idRef.current })
  }, [])

  const clear = useCallback((): void => setNotice(null), [])

  return { notice, announce, clear }
}
