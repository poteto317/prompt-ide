import { toError } from './errorUtils'

// 中断の IPC(1 回目・2 回目)を呼び、結果を「今のセッションの結果か」で仕分ける(useAgentSessions の interrupt・interruptFollowUp で
// 共通)。タブの error への反映は呼び出し側が決める

/** IPC の呼び出しの結果。stale は結果が届いた時点で送った相手のセッションでなくなった(何も出さない) */
export type AgentInterruptInvocation<T> =
  | { kind: 'done'; result: T }
  | { kind: 'stale' }
  /** invoke の拒否・同期の例外(stale でないとき) */
  | { kind: 'error'; message: string }

/**
 * call を呼び、結果(拒否を含む)が届いた時点で isCurrent が偽なら stale にする(古いセッションの結果を今のタブに出さない。L-037)。
 * 同期の例外も拒否と同じ経路で扱う(L-055)。拒否しない
 */
export async function invokeForCurrentSession<T>(
  call: () => Promise<T>,
  isCurrent: () => boolean
): Promise<AgentInterruptInvocation<T>> {
  let result: T
  try {
    result = await Promise.resolve().then(call)
  } catch (err) {
    if (!isCurrent()) return { kind: 'stale' }
    return { kind: 'error', message: toError(err).message }
  }
  if (!isCurrent()) return { kind: 'stale' }
  return { kind: 'done', result }
}
