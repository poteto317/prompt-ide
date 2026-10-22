import { useCallback, useEffect, useRef } from 'react'

// 中断の 2 回目を頼むまでの待ち(設計書 2026-10-21「中断の流れ」の手順 6)。待っているタイマーを控え、アンマウントで消して
// 待っている流れには false を返す(2 回目を頼ませない。main の控えは期限で無効になる。L-052)。useAgentInterrupt が使う

/** 待っているタイマー(アンマウントで消し、待っている流れには false を返す) */
interface FollowUpWait {
  timer: ReturnType<typeof setTimeout>
  resolve: (waited: boolean) => void
}

/** afterMs だけ待つ。待ち終えたら true、アンマウントで消したら(アンマウントの後に呼ばれたら待たずに)false。参照は安定 */
export type WaitForAgentInterruptFollowUp = (afterMs: number) => Promise<boolean>

export function useAgentInterruptFollowUpWait(): WaitForAgentInterruptFollowUp {
  const mountedRef = useRef(false)
  const waitsRef = useRef(new Set<FollowUpWait>())

  useEffect(() => {
    mountedRef.current = true
    const waits = waitsRef.current
    return () => {
      mountedRef.current = false
      for (const wait of waits) {
        clearTimeout(wait.timer)
        wait.resolve(false)
      }
      waits.clear()
    }
  }, [])

  return useCallback(
    (afterMs: number): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // 1 回目の結果を待つ間にアンマウントしたら、後片付けの後なのでタイマーを足さない(足すと残り、待ち終えて 2 回目を頼む。L-052)
        if (!mountedRef.current) {
          resolve(false)
          return
        }
        const waits = waitsRef.current
        const wait: FollowUpWait = {
          timer: setTimeout(() => {
            waits.delete(wait)
            resolve(true)
          }, afterMs),
          resolve
        }
        waits.add(wait)
      }),
    []
  )
}
