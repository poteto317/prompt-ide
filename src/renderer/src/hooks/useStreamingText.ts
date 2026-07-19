import { useState, useRef, useEffect, useCallback } from 'react'
import * as promptStreamApi from '../lib/promptStreamApi'

export interface UseStreamingTextResult {
  streamingText: string
  /** 新しい実行を開始するときに呼ぶ。以降このrequestIdのチャンクのみ蓄積対象になる */
  startStreaming: (requestId: string) => void
  /** 実行が完了(成功・失敗問わず)したときに呼ぶ。蓄積内容をクリアし購読フィルタを無効化する */
  stopStreaming: () => void
}

// ストリーミングチャンクの購読・バッファリング・間引き表示のみを担う。
// 「どの実行が現在アクティブか」は startStreaming/stopStreaming を呼ぶ側(usePromptExecution)が
// 同期的に伝える設計にしている(useEffect 経由だとコミットが非同期になり、
// 実行開始直後に届く先頭チャンクの購読フィルタ反映が遅れる可能性があるため)。
export function useStreamingText(): UseStreamingTextResult {
  const [streamingText, setStreamingText] = useState('')
  const activeRequestIdRef = useRef<string | null>(null)
  const fullTextRef = useRef('')
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // requestId フィルタが遅延チャンクの最終防壁:
    // main 側がレジストリ削除後に send 済みのチャンクが届いても、旧 requestId は不一致で捨てられる
    const unsubscribe = promptStreamApi.onPromptStreamChunk((requestId, chunk) => {
      if (requestId !== activeRequestIdRef.current) return
      fullTextRef.current += chunk
      // チャンク毎の setState はレンダー負荷が高いため一定間隔に間引く。
      // rAF はウィンドウが最小化・背面のとき発火が止まり表示が凍結するため setTimeout を使う
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null
          setStreamingText(fullTextRef.current)
        }, 50)
      }
    })
    return () => {
      unsubscribe()
      if (flushTimerRef.current !== null) clearTimeout(flushTimerRef.current)
    }
  }, [])

  // 前の実行の flush タイマーが保留中のまま次の実行が始まると、チャンク受信時の
  // 「タイマーが無ければ張る」判定がすり抜けて新しいタイマーが張られず、
  // 次の実行の表示更新が古いタイマーの発火(最大50ms後)まで遅延しうるため、
  // 実行の開始・終了のどちらでも保留中のタイマーを確実にクリアする。
  const clearPendingFlush = (): void => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
  }

  const startStreaming = useCallback((requestId: string): void => {
    clearPendingFlush()
    activeRequestIdRef.current = requestId
    fullTextRef.current = ''
    setStreamingText('')
  }, [])

  const stopStreaming = useCallback((): void => {
    clearPendingFlush()
    activeRequestIdRef.current = null
    fullTextRef.current = ''
    setStreamingText('')
  }, [])

  return { streamingText, startStreaming, stopStreaming }
}
