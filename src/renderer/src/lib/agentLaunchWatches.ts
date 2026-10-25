import type { AgentLaunchRequest, AgentSessionExit } from '@shared/types'
import { isAgentResumeFailure } from './agentSessionTabState'

// タブごとの今の起動の控え(起動の指定と、画面の活動を一度でも見たか)。再開の失敗の見分け(isAgentResumeFailure)だけに使う
// (段階 3a の設計書「再開の失敗の見分け方と伝え方」)。持ち主は useAgentSessions で、文言の選び方(種類ごとの表)はそちらが決める。
// React に依存しない

export interface AgentLaunchWatches {
  /**
   * slotId の今の起動の控えを作り直す(前の起動で見た活動を持ち越さない)。起動の指定が分からない・依頼の指定で起動していない
   * (状態の取得での合わせ込み・already-running)ときは new として控える(再開の失敗の文言を出さない側に倒す)
   */
  begin(slotId: string, launchKind: AgentLaunchRequest['kind']): void
  /** slotId の画面の活動が unknown 以外になったことを控える。控えの無いタブでは何もしない */
  noteScreenActivity(slotId: string): void
  /** slotId の控えを消す(タブを消したとき) */
  forget(slotId: string): void
  /** slotId の今の起動が再開の失敗で終わったか(isAgentResumeFailure)。控えの無いタブは偽 */
  isResumeFailure(slotId: string, exit: Pick<AgentSessionExit, 'exitCode' | 'reason'>): boolean
}

interface AgentLaunchWatch {
  launchKind: AgentLaunchRequest['kind']
  sawScreenActivity: boolean
}

export function createAgentLaunchWatches(): AgentLaunchWatches {
  const watches = new Map<string, AgentLaunchWatch>()
  return {
    begin: (slotId, launchKind) => {
      watches.set(slotId, { launchKind, sawScreenActivity: false })
    },
    noteScreenActivity: (slotId) => {
      const watch = watches.get(slotId)
      if (watch !== undefined) watch.sawScreenActivity = true
    },
    forget: (slotId) => {
      watches.delete(slotId)
    },
    isResumeFailure: (slotId, exit) => {
      const watch = watches.get(slotId)
      return (
        watch !== undefined &&
        isAgentResumeFailure({
          launchKind: watch.launchKind,
          exit,
          sawScreenActivity: watch.sawScreenActivity
        })
      )
    }
  }
}
